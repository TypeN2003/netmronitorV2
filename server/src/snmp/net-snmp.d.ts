/**
 * Minimal ambient types for `net-snmp`, which ships as plain JavaScript.
 * Only the surface the collector uses is declared.
 */
declare module 'net-snmp' {
  export interface Varbind {
    oid: string;
    type: number;
    value: number | string | Buffer | bigint;
  }

  export interface SessionOptions {
    port?: number;
    retries?: number;
    timeout?: number;
    transport?: 'udp4' | 'udp6';
    trapPort?: number;
    version?: number;
    backwardsGetNexts?: boolean;
    idBitsSize?: number;
    context?: string;
  }

  export interface V3User {
    name: string;
    level: number;
    authProtocol?: string;
    authKey?: string;
    privProtocol?: string;
    privKey?: string;
  }

  export interface Session {
    get(oids: string[], callback: (error: Error | null, varbinds: Varbind[]) => void): void;
    getNext(oids: string[], callback: (error: Error | null, varbinds: Varbind[]) => void): void;
    getBulk(
      oids: string[],
      nonRepeaters: number,
      maxRepetitions: number,
      callback: (error: Error | null, varbinds: Varbind[][] | Varbind[]) => void
    ): void;
    set(varbinds: Varbind[], callback: (error: Error | null, varbinds: Varbind[]) => void): void;
    subtree(
      oid: string,
      maxRepetitions: number,
      feedCallback: (varbinds: Varbind[]) => void,
      doneCallback: (error: Error | null) => void
    ): void;
    walk(
      oid: string,
      maxRepetitions: number,
      feedCallback: (varbinds: Varbind[]) => void,
      doneCallback: (error: Error | null) => void
    ): void;
    close(): void;
    on(event: string, listener: (...args: unknown[]) => void): void;
  }

  export const Version1: number;
  export const Version2c: number;
  export const Version3: number;

  export const ObjectType: {
    Boolean: number;
    Integer: number;
    OctetString: number;
    Null: number;
    OID: number;
    IpAddress: number;
    Counter: number;
    Counter32: number;
    Gauge: number;
    Gauge32: number;
    TimeTicks: number;
    Opaque: number;
    Counter64: number;
    NoSuchObject: number;
    NoSuchInstance: number;
    EndOfMibView: number;
  };

  export const SecurityLevel: {
    noAuthNoPriv: number;
    authNoPriv: number;
    authPriv: number;
  };

  export const AuthProtocols: {
    none: string;
    md5: string;
    sha: string;
    sha224: string;
    sha256: string;
    sha384: string;
    sha512: string;
  };

  export const PrivProtocols: {
    none: string;
    des: string;
    aes: string;
    aes256b: string;
    aes256r: string;
  };

  export function createSession(target: string, community: string, options?: SessionOptions): Session;
  export function createV3Session(target: string, user: V3User, options?: SessionOptions): Session;
  export function isVarbindError(varbind: Varbind): boolean;
  export function varbindError(varbind: Varbind): string;
}
