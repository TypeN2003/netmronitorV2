import snmp, { type Session, type Varbind } from 'net-snmp';
import { env } from '../env.js';

/** Everything needed to talk to one agent. Built from a Device row. */
export interface SnmpTarget {
  host: string;
  port: number;
  version: '2c' | '3';
  community: string;
  v3?: {
    user: string;
    securityLevel: 'noAuthNoPriv' | 'authNoPriv' | 'authPriv';
    authProtocol: 'md5' | 'sha' | 'sha224' | 'sha256' | 'sha384' | 'sha512';
    authKey: string;
    privProtocol: 'des' | 'aes' | 'aes256b' | 'aes256r';
    privKey: string;
    context?: string;
  };
  timeoutMs?: number;
  retries?: number;
  /** Hard cap for one table walk. Defaults to 8x the request timeout, at least 15 s. */
  walkDeadlineMs?: number;
}

export class SnmpError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'SnmpError';
  }
}

const AUTH_PROTOCOL: Record<string, string> = {
  md5: snmp.AuthProtocols.md5,
  sha: snmp.AuthProtocols.sha,
  sha224: snmp.AuthProtocols.sha224,
  sha256: snmp.AuthProtocols.sha256,
  sha384: snmp.AuthProtocols.sha384,
  sha512: snmp.AuthProtocols.sha512,
};

const PRIV_PROTOCOL: Record<string, string> = {
  des: snmp.PrivProtocols.des,
  aes: snmp.PrivProtocols.aes,
  aes256b: snmp.PrivProtocols.aes256b,
  aes256r: snmp.PrivProtocols.aes256r,
};

const SECURITY_LEVEL: Record<string, number> = {
  noAuthNoPriv: snmp.SecurityLevel.noAuthNoPriv,
  authNoPriv: snmp.SecurityLevel.authNoPriv,
  authPriv: snmp.SecurityLevel.authPriv,
};

// ---------------------------------------------------------------- value coercion

export type SnmpValue = number | bigint | string | Buffer;

/** NUL, written without a string escape so the source file stays plain ASCII. */
const NUL = String.fromCharCode(0);

/** Counter64 arrives as an 8-byte Buffer; everything else is already a JS primitive. */
const normalise = (vb: Varbind): SnmpValue => {
  if (vb.type === snmp.ObjectType.Counter64 && Buffer.isBuffer(vb.value)) {
    return vb.value.length === 0 ? 0n : BigInt(`0x${vb.value.toString('hex')}`);
  }
  return vb.value as SnmpValue;
};

export const asInt = (value: SnmpValue | undefined | null, fallback = 0): number => {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  if (typeof value === 'bigint') return Number(value);
  if (Buffer.isBuffer(value)) {
    const text = value.toString('utf8').trim();
    const parsed = Number(text);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  const parsed = Number(String(value).trim());
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const asBigInt = (value: SnmpValue | undefined | null): bigint | null => {
  if (value === undefined || value === null) return null;
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? BigInt(Math.trunc(value)) : null;
  if (Buffer.isBuffer(value)) return value.length === 0 ? null : BigInt(`0x${value.toString('hex')}`);
  try {
    return BigInt(String(value).trim());
  } catch {
    return null;
  }
};

export const asString = (value: SnmpValue | undefined | null, fallback = ''): string => {
  if (value === undefined || value === null) return fallback;
  if (Buffer.isBuffer(value)) {
    // Some agents pad OctetStrings with NULs; strip them before comparing or displaying
    return value.toString('utf8').split(NUL).join('').trim() || fallback;
  }
  if (typeof value === 'bigint') return value.toString();
  const text = String(value).trim();
  return text || fallback;
};

/** `00:1A:2B:3C:4D:01` from an ifPhysAddress OctetString. */
export const asMac = (value: SnmpValue | undefined | null): string => {
  if (!Buffer.isBuffer(value) || value.length !== 6) return '';
  const mac = [...value].map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(':');
  return mac === '00:00:00:00:00:00' ? '' : mac;
};

// ---------------------------------------------------------------- OID ordering

/** `1.3.6.1.2.1.2.2.1.2` -> [1,3,6,1,2,1,2,2,1,2], so OIDs compare numerically. */
const toPath = (oid: string): number[] => oid.split('.').map(Number);

/** Lexicographic OID order — the order an SNMP agent is required to walk in. */
const comparePath = (a: number[], b: number[]): number => {
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return a.length === b.length ? 0 : a.length < b.length ? -1 : 1;
};

/** True when `path` sits strictly below `base`. */
const isWithin = (path: number[], base: number[]): boolean => {
  if (path.length <= base.length) return false;
  for (let i = 0; i < base.length; i += 1) {
    if (path[i] !== base[i]) return false;
  }
  return true;
};

export interface WalkOptions {
  /** Give up after this long and return whatever was collected. */
  deadlineMs?: number;
  /** Stop after this many rows — an FDB table on a busy switch can be enormous. */
  maxRows?: number;
}

// ---------------------------------------------------------------- session

/**
 * A promise-friendly wrapper around one net-snmp session.
 *
 * Always close it: net-snmp keeps a UDP socket open per session and the poller
 * creates one per device per cycle.
 */
export class SnmpSession {
  private readonly session: Session;
  private closed = false;
  /** Upper bound for one whole table walk, independent of the per-request timeout. */
  private readonly walkDeadlineMs: number;

  private constructor(session: Session, walkDeadlineMs: number) {
    this.session = session;
    this.walkDeadlineMs = walkDeadlineMs;
    // net-snmp emits on the underlying socket; without a listener an ICMP
    // port-unreachable during a walk takes the whole process down.
    this.session.on('error', () => undefined);
    this.session.on('close', () => {
      this.closed = true;
    });
  }

  static open(target: SnmpTarget): SnmpSession {
    const requestTimeout = target.timeoutMs ?? env.snmp.timeoutMs;
    // A large table needs many round trips, so allow several request timeouts per walk
    const walkDeadlineMs = target.walkDeadlineMs ?? Math.max(15000, requestTimeout * 8);
    const options = {
      port: target.port || 161,
      retries: target.retries ?? env.snmp.retries,
      timeout: target.timeoutMs ?? env.snmp.timeoutMs,
      transport: 'udp4' as const,
      version: target.version === '3' ? snmp.Version3 : snmp.Version2c,
      ...(target.v3?.context ? { context: target.v3.context } : {}),
    };

    if (target.version === '3') {
      const v3 = target.v3;
      if (!v3 || !v3.user) throw new SnmpError('SNMPv3 is selected but no username is configured');
      const level = SECURITY_LEVEL[v3.securityLevel] ?? snmp.SecurityLevel.authPriv;
      const user = {
        name: v3.user,
        level,
        ...(level !== snmp.SecurityLevel.noAuthNoPriv
          ? {
              authProtocol: AUTH_PROTOCOL[v3.authProtocol] ?? snmp.AuthProtocols.sha,
              authKey: v3.authKey,
            }
          : {}),
        ...(level === snmp.SecurityLevel.authPriv
          ? {
              privProtocol: PRIV_PROTOCOL[v3.privProtocol] ?? snmp.PrivProtocols.aes,
              privKey: v3.privKey,
            }
          : {}),
      };
      return new SnmpSession(snmp.createV3Session(target.host, user, options), walkDeadlineMs);
    }

    return new SnmpSession(snmp.createSession(target.host, target.community || 'public', options), walkDeadlineMs);
  }

  /**
   * GET several scalar OIDs at once.
   *
   * OIDs the agent does not implement are simply absent from the result instead of
   * failing the whole request, so callers can probe vendor MIBs speculatively.
   */
  get(oids: string[]): Promise<Map<string, SnmpValue>> {
    return new Promise((resolve, reject) => {
      if (oids.length === 0) return resolve(new Map());
      this.session.get(oids, (error, varbinds) => {
        if (error) return reject(new SnmpError(error.message, error));
        const out = new Map<string, SnmpValue>();
        for (const vb of varbinds ?? []) {
          if (!vb || snmp.isVarbindError(vb)) continue;
          out.set(vb.oid.replace(/^\./, ''), normalise(vb));
        }
        resolve(out);
      });
    });
  }

  /** GET a single OID. Returns null when the agent does not implement it. */
  async getOne(oid: string): Promise<SnmpValue | null> {
    const result = await this.get([oid]);
    return result.get(oid.replace(/^\./, '')) ?? null;
  }

  /**
   * Walk a table column and return `{ index -> value }`, where the index is the OID
   * remainder below `baseOid` (the ifIndex for IF-MIB columns, the dotted-decimal MAC
   * for an FDB table).
   *
   * Implemented as an explicit GETBULK loop rather than net-snmp's `subtree()`, which
   * never calls back when an agent answers an unimplemented column with NoSuchObject
   * at the same OID — so probing an optional vendor column would hang the poll forever.
   * This loop stops on any of:
   *   - an OID outside the subtree (the table ended normally)
   *   - a NoSuchObject / NoSuchInstance / EndOfMibView varbind
   *   - an OID that does not advance (a broken or looping agent)
   *   - `maxRows` rows, or the deadline
   */
  async walk(baseOid: string, maxRepetitions = 20, options: WalkOptions = {}): Promise<Map<string, SnmpValue>> {
    const base = baseOid.replace(/^\./, '');
    const basePath = toPath(base);
    const maxRows = options.maxRows ?? 10000;
    const deadlineMs = options.deadlineMs ?? this.walkDeadlineMs;
    const deadline = Date.now() + deadlineMs;

    const out = new Map<string, SnmpValue>();
    let cursor = base;
    let cursorPath = basePath;

    while (out.size < maxRows) {
      if (Date.now() > deadline) {
        // Partial data beats no data; an empty result is reported as a failure instead
        if (out.size > 0) break;
        throw new SnmpError(`Walk of ${base} did not finish within ${deadlineMs} ms`);
      }

      const varbinds = await this.bulk(cursor, maxRepetitions);
      if (varbinds.length === 0) break;

      let advanced = false;
      let finished = false;

      for (const vb of varbinds) {
        if (!vb) continue;
        // 128/129/130: the agent has nothing at or after this OID
        if (snmp.isVarbindError(vb)) {
          finished = true;
          break;
        }

        const oid = vb.oid.replace(/^\./, '');
        const path = toPath(oid);

        if (!isWithin(path, basePath)) {
          finished = true;
          break;
        }
        if (comparePath(path, cursorPath) <= 0) {
          // The agent repeated an OID or went backwards. Walking on would loop forever.
          finished = true;
          break;
        }

        out.set(oid.slice(base.length + 1), normalise(vb));
        cursor = oid;
        cursorPath = path;
        advanced = true;
      }

      if (finished || !advanced) break;
    }

    return out;
  }

  /** One GETBULK, flattened. Falls back to a single GETNEXT if the agent refuses GETBULK. */
  private bulk(fromOid: string, maxRepetitions: number): Promise<Varbind[]> {
    return new Promise((resolve, reject) => {
      this.session.getBulk([fromOid], 0, Math.max(1, maxRepetitions), (error, result) => {
        if (error) {
          // Some agents answer GETBULK with a generic error; one GETNEXT still makes progress
          this.session.getNext([fromOid], (nextError, varbinds) => {
            if (nextError) return reject(new SnmpError(nextError.message, nextError));
            resolve(varbinds ?? []);
          });
          return;
        }
        // getBulk hands back one array of repetitions per requested OID
        const flat: Varbind[] = Array.isArray(result)
          ? (result as unknown[]).flatMap(entry => (Array.isArray(entry) ? (entry as Varbind[]) : [entry as Varbind]))
          : [];
        resolve(flat);
      });
    });
  }

  /** Walk that resolves to an empty map instead of throwing — for optional columns. */
  async tryWalk(baseOid: string, maxRepetitions = 20, options: WalkOptions = {}): Promise<Map<string, SnmpValue>> {
    try {
      return await this.walk(baseOid, maxRepetitions, options);
    } catch {
      return new Map();
    }
  }

  /** SET one integer-valued OID. Used to shut / no-shut a port via ifAdminStatus. */
  setInt(oid: string, value: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.session.set(
        [{ oid: oid.replace(/^\./, ''), type: snmp.ObjectType.Integer, value }],
        (error, varbinds) => {
          if (error) return reject(new SnmpError(error.message, error));
          const bad = (varbinds ?? []).find(vb => vb && snmp.isVarbindError(vb));
          if (bad) return reject(new SnmpError(snmp.varbindError(bad)));
          resolve();
        }
      );
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.session.close();
    } catch {
      // already torn down
    }
  }
}

/** Open a session, run `fn`, and always close the socket. */
export const withSnmp = async <T>(target: SnmpTarget, fn: (session: SnmpSession) => Promise<T>): Promise<T> => {
  const session = SnmpSession.open(target);
  try {
    return await fn(session);
  } finally {
    session.close();
  }
};
