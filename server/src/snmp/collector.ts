import {
  SnmpSession,
  SnmpError,
  withSnmp,
  asInt,
  asBigInt,
  asString,
  asMac,
  type SnmpTarget,
  type SnmpValue,
} from './client.js';
import {
  SYSTEM,
  IF_MIB,
  IF_ADMIN_STATUS,
  IF_OPER_STATUS,
  PHYSICAL_IF_TYPES,
  ETHERLIKE,
  ENTITY_MIB,
  ENTITY_SENSOR,
  HOST_RESOURCES,
  Q_BRIDGE,
  POE,
  CISCO,
  ARUBA,
  FORTINET,
  JUNIPER,
  detectVendor,
  VENDOR_LABEL,
  type Vendor,
} from './oids.js';
import { formatUptimeFromTimeticks } from '../utils/time.js';
import { env } from '../env.js';

// ---------------------------------------------------------------- result shapes

export interface PolledInterface {
  ifIndex: number;
  /** ifName when the agent supports it, else ifDescr — the name shown on the Ports page. */
  name: string;
  description: string;
  ifType: number;
  isPhysical: boolean;
  adminUp: boolean;
  operUp: boolean;
  speedMbps: number;
  speedLabel: string;
  portType: 'RJ45' | 'SFP+' | 'QSFP';
  duplex: 'Full' | 'Half' | 'Auto';
  inOctets: bigint | null;
  outOctets: bigint | null;
  errorTotal: bigint;
  fcsErrors: bigint;
  errDisabled: boolean;
  vlan: number;
  poeWatts: number;
  connectedMac: string | null;
  mac: string;
}

export interface PolledVlan {
  id: number;
  name: string;
}

export interface PollSuccess {
  reachable: true;
  /** SNMP round-trip time for the system GET, used in place of an ICMP ping. */
  responseMs: number;
  sysName: string;
  sysDescr: string;
  sysObjectID: string;
  sysLocation: string;
  uptimeTicks: number;
  uptime: string;
  vendor: Vendor;
  vendorLabel: string;
  model: string;
  firmware: string;
  serial: string;
  mac: string;
  cpu: number;
  ram: number;
  temp: number;
  interfaces: PolledInterface[];
  vlans: PolledVlan[];
  /** OIDs the agent did not answer. Surfaced so the UI can explain a 0% CPU reading. */
  missing: string[];
}

export interface PollFailure {
  reachable: false;
  error: string;
  responseMs: number;
}

export type PollResult = PollSuccess | PollFailure;

// ---------------------------------------------------------------- helpers

const clampPercent = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
};

const average = (values: number[]): number =>
  values.length === 0 ? 0 : values.reduce((sum, v) => sum + v, 0) / values.length;

const numbersFrom = (table: Map<string, SnmpValue>): number[] =>
  [...table.values()].map(v => asInt(v, Number.NaN)).filter(n => Number.isFinite(n));

/** `10 Gbps` / `1 Gbps` / `100 Mbps` — matches the labels already used on the Ports page. */
const speedLabelFor = (mbps: number, operUp: boolean): string => {
  if (!operUp || mbps <= 0) return '-';
  if (mbps >= 1000 && mbps % 1000 === 0) return `${mbps / 1000} Gbps`;
  if (mbps >= 1000) return `${(mbps / 1000).toFixed(1)} Gbps`;
  return `${mbps} Mbps`;
};

/**
 * Port media, inferred from the interface name first and the negotiated speed second.
 * Agents do not report connector type, and a 10G port that is currently down still has
 * an SFP+ cage, so the name wins when it says so.
 */
const portTypeFor = (name: string, speedMbps: number): 'RJ45' | 'SFP+' | 'QSFP' => {
  const n = name.toLowerCase();
  if (/hundredgig|fortygig|^fo|^hu|qsfp/.test(n)) return 'QSFP';
  if (/twentyfivegig|tengig|^te\d|^xe-|sfp\+/.test(n)) return 'SFP+';
  if (speedMbps >= 40000) return 'QSFP';
  if (speedMbps >= 10000) return 'SFP+';
  return 'RJ45';
};

const DUPLEX_BY_CODE: Record<number, 'Full' | 'Half' | 'Auto'> = {
  1: 'Auto', // unknown
  2: 'Half',
  3: 'Full',
};

/**
 * Cisco reports PoE draw indexed by `group.port`, not by ifIndex, so the port number
 * is read out of the interface name (GigabitEthernet1/0/7 -> group 1, port 7).
 * Best effort: anything we cannot map stays at 0 W.
 */
const poeKeyFor = (name: string): string | null => {
  const match = /(\d+)\/\d+\/(\d+)$/.exec(name) ?? /(\d+)\/(\d+)$/.exec(name);
  if (!match) return null;
  return `${match[1]}.${match[2]}`;
};

/** `1.0.26.182.25.101` (dotted-decimal MAC used as an FDB index) -> `00:1A:B6:19:65:xx`. */
const macFromFdbIndex = (index: string): string | null => {
  const parts = index.split('.').map(Number);
  // Q-BRIDGE prefixes the index with the VLAN id; the classic bridge MIB does not.
  const macBytes = parts.length === 7 ? parts.slice(1) : parts.length === 6 ? parts : null;
  if (!macBytes || macBytes.some(b => !Number.isFinite(b) || b < 0 || b > 255)) return null;
  return macBytes.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(':');
};

// ---------------------------------------------------------------- resource metrics

const readCpu = async (session: SnmpSession, vendor: Vendor, missing: string[]): Promise<number> => {
  if (vendor === 'cisco') {
    const table = await session.tryWalk(CISCO.cpmCPUTotal5minRev);
    const loads = numbersFrom(table);
    if (loads.length > 0) return clampPercent(average(loads));
    const legacy = await session.getOne(CISCO.avgBusy5).catch(() => null);
    if (legacy !== null) return clampPercent(asInt(legacy));
  }

  if (vendor === 'aruba') {
    const procurve = await session.getOne(ARUBA.hpSwitchCpuStat).catch(() => null);
    if (procurve !== null) return clampPercent(asInt(procurve));
    const cx = numbersFrom(await session.tryWalk(ARUBA.arubaWiredCpuUtil));
    if (cx.length > 0) return clampPercent(average(cx));
  }

  if (vendor === 'fortinet') {
    const value = await session.getOne(FORTINET.fgSysCpuUsage).catch(() => null);
    if (value !== null) return clampPercent(asInt(value));
  }

  if (vendor === 'juniper') {
    const loads = numbersFrom(await session.tryWalk(JUNIPER.jnxOperatingCPU));
    // Routing engines report 0 for line cards; take the busiest real value
    const busy = loads.filter(n => n > 0);
    if (busy.length > 0) return clampPercent(Math.max(...busy));
  }

  // HOST-RESOURCES-MIB works on most Linux-based NOS and on servers
  const hrLoads = numbersFrom(await session.tryWalk(HOST_RESOURCES.hrProcessorLoad));
  if (hrLoads.length > 0) return clampPercent(average(hrLoads));

  missing.push('cpu');
  return 0;
};

const readRam = async (session: SnmpSession, vendor: Vendor, missing: string[]): Promise<number> => {
  if (vendor === 'cisco') {
    const [used, free] = await Promise.all([
      session.tryWalk(CISCO.ciscoMemoryPoolUsed),
      session.tryWalk(CISCO.ciscoMemoryPoolFree),
    ]);
    // Pool 1 is the processor pool; sum every pool the device exposes
    let usedBytes = 0;
    let totalBytes = 0;
    for (const [index, usedValue] of used) {
      const u = asInt(usedValue);
      const f = asInt(free.get(index));
      usedBytes += u;
      totalBytes += u + f;
    }
    if (totalBytes > 0) return clampPercent((usedBytes / totalBytes) * 100);
  }

  if (vendor === 'aruba') {
    const [total, alloc] = await Promise.all([
      session.tryWalk(ARUBA.hpLocalMemTotalBytes),
      session.tryWalk(ARUBA.hpLocalMemAllocBytes),
    ]);
    let totalBytes = 0;
    let allocBytes = 0;
    for (const [index, totalValue] of total) {
      totalBytes += asInt(totalValue);
      allocBytes += asInt(alloc.get(index));
    }
    if (totalBytes > 0) return clampPercent((allocBytes / totalBytes) * 100);
    const cx = numbersFrom(await session.tryWalk(ARUBA.arubaWiredMemUtil));
    if (cx.length > 0) return clampPercent(average(cx));
  }

  if (vendor === 'fortinet') {
    const value = await session.getOne(FORTINET.fgSysMemUsage).catch(() => null);
    if (value !== null) return clampPercent(asInt(value));
  }

  if (vendor === 'juniper') {
    const buffers = numbersFrom(await session.tryWalk(JUNIPER.jnxOperatingBuffer)).filter(n => n > 0);
    if (buffers.length > 0) return clampPercent(Math.max(...buffers));
  }

  // HOST-RESOURCES-MIB: find the storage row typed as physical RAM
  const [types, sizes, useds] = await Promise.all([
    session.tryWalk(HOST_RESOURCES.hrStorageType),
    session.tryWalk(HOST_RESOURCES.hrStorageSize),
    session.tryWalk(HOST_RESOURCES.hrStorageUsed),
  ]);
  for (const [index, type] of types) {
    if (asString(type).replace(/^\./, '') !== HOST_RESOURCES.typeRam) continue;
    const size = asInt(sizes.get(index));
    const used = asInt(useds.get(index));
    if (size > 0) return clampPercent((used / size) * 100);
  }

  missing.push('ram');
  return 0;
};

const readTemperature = async (session: SnmpSession, vendor: Vendor, missing: string[]): Promise<number> => {
  const plausible = (values: number[]): number[] => values.filter(n => n > 0 && n < 120);

  if (vendor === 'cisco') {
    const temps = plausible(numbersFrom(await session.tryWalk(CISCO.ciscoEnvMonTemperatureValue)));
    if (temps.length > 0) return Math.round(Math.max(...temps));
  }

  if (vendor === 'fortinet') {
    const temps = plausible(numbersFrom(await session.tryWalk(FORTINET.fgHwSensorEntValue)));
    if (temps.length > 0) return Math.round(Math.max(...temps));
  }

  if (vendor === 'juniper') {
    const temps = plausible(numbersFrom(await session.tryWalk(JUNIPER.jnxOperatingTemp)));
    if (temps.length > 0) return Math.round(Math.max(...temps));
  }

  // ENTITY-SENSOR-MIB: celsius sensors, scaled by entPhySensorPrecision
  const [sensorTypes, values, precisions] = await Promise.all([
    session.tryWalk(ENTITY_SENSOR.entPhySensorType),
    session.tryWalk(ENTITY_SENSOR.entPhySensorValue),
    session.tryWalk(ENTITY_SENSOR.entPhySensorPrecision),
  ]);
  const celsius: number[] = [];
  for (const [index, type] of sensorTypes) {
    if (asInt(type) !== ENTITY_SENSOR.celsius) continue;
    const precision = asInt(precisions.get(index), 0);
    const raw = asInt(values.get(index), Number.NaN);
    if (!Number.isFinite(raw)) continue;
    celsius.push(precision > 0 ? raw / 10 ** precision : raw);
  }
  const temps = plausible(celsius);
  if (temps.length > 0) return Math.round(Math.max(...temps));

  missing.push('temp');
  return 0;
};

// ---------------------------------------------------------------- identity

/** Model and firmware: ENTITY-MIB chassis row first, then whatever sysDescr admits. */
const readIdentity = async (
  session: SnmpSession,
  vendor: Vendor,
  sysDescr: string
): Promise<{ model: string; firmware: string; serial: string }> => {
  let model = '';
  let firmware = '';
  let serial = '';

  const [classes, models, softwareRevs, serials] = await Promise.all([
    session.tryWalk(ENTITY_MIB.entPhysicalClass),
    session.tryWalk(ENTITY_MIB.entPhysicalModelName),
    session.tryWalk(ENTITY_MIB.entPhysicalSoftwareRev),
    session.tryWalk(ENTITY_MIB.entPhysicalSerialNum),
  ]);

  const chassisIndex = [...classes.entries()].find(([, c]) => asInt(c) === ENTITY_MIB.classChassis)?.[0];
  const pickFrom = (table: Map<string, SnmpValue>): string => {
    if (chassisIndex) {
      const value = asString(table.get(chassisIndex));
      if (value) return value;
    }
    for (const value of table.values()) {
      const text = asString(value);
      if (text) return text;
    }
    return '';
  };

  model = pickFrom(models);
  firmware = pickFrom(softwareRevs);
  serial = pickFrom(serials);

  if (vendor === 'fortinet' && !firmware) {
    firmware = asString(await session.getOne(FORTINET.fgSysVersion).catch(() => null));
  }

  if (!firmware) {
    // "Cisco IOS Software, ..., Version 17.09.03a, RELEASE SOFTWARE" -> "17.09.03a"
    const version = /Version\s+([\w.()-]+)/i.exec(sysDescr)?.[1];
    firmware = version ?? sysDescr.split(/[,\n]/)[0]?.trim() ?? '-';
  }

  if (!model) {
    // ArubaOS/ProCurve put the model at the start of sysDescr
    const guess = /^([A-Za-z0-9-]+(?:\s+[A-Za-z0-9-]+){0,3})/.exec(sysDescr.trim())?.[1];
    model = guess ?? '';
  }

  return { model: model.slice(0, 120), firmware: firmware.slice(0, 120), serial: serial.slice(0, 80) };
};

// ---------------------------------------------------------------- interfaces

const readInterfaces = async (session: SnmpSession, vendor: Vendor): Promise<PolledInterface[]> => {
  const [descrs, names, aliases, types, highSpeeds, speeds, adminStatuses, operStatuses, physAddresses] =
    await Promise.all([
      session.tryWalk(IF_MIB.ifDescr),
      session.tryWalk(IF_MIB.ifName),
      session.tryWalk(IF_MIB.ifAlias),
      session.tryWalk(IF_MIB.ifType),
      session.tryWalk(IF_MIB.ifHighSpeed),
      session.tryWalk(IF_MIB.ifSpeed),
      session.tryWalk(IF_MIB.ifAdminStatus),
      session.tryWalk(IF_MIB.ifOperStatus),
      session.tryWalk(IF_MIB.ifPhysAddress),
    ]);

  if (types.size === 0 && descrs.size === 0) return [];

  const [inOctets, outOctets, inErrors, outErrors, inDiscards, outDiscards] = await Promise.all([
    session.tryWalk(IF_MIB.ifHCInOctets),
    session.tryWalk(IF_MIB.ifHCOutOctets),
    session.tryWalk(IF_MIB.ifInErrors),
    session.tryWalk(IF_MIB.ifOutErrors),
    session.tryWalk(IF_MIB.ifInDiscards),
    session.tryWalk(IF_MIB.ifOutDiscards),
  ]);

  const [fcsErrors, duplexes] = await Promise.all([
    session.tryWalk(ETHERLIKE.dot3StatsFCSErrors),
    session.tryWalk(ETHERLIKE.dot3StatsDuplexStatus),
  ]);

  // Access VLAN per port: Cisco has its own table, everyone else uses dot1qPvid
  const vlanByIf =
    vendor === 'cisco'
      ? await session.tryWalk(CISCO.vmVlan).then(async table =>
          table.size > 0 ? table : session.tryWalk(Q_BRIDGE.dot1qPvid)
        )
      : await session.tryWalk(Q_BRIDGE.dot1qPvid);

  const errDisabled = vendor === 'cisco' ? await session.tryWalk(CISCO.cErrDisableIfStatusCause) : new Map();
  const poeDraw = vendor === 'cisco' ? await session.tryWalk(POE.cpeExtPsePortPwrConsumption) : new Map();

  const connectedMacByIf = env.snmp.collectFdb ? await readForwardingTable(session) : new Map<number, string>();

  // cErrDisableIfStatusCause is indexed by ifIndex.vlanIndex — collapse to the ifIndex
  const errDisabledIfIndexes = new Set<number>();
  for (const key of errDisabled.keys()) {
    const ifIndex = Number(key.split('.')[0]);
    if (Number.isFinite(ifIndex)) errDisabledIfIndexes.add(ifIndex);
  }

  const indexes = new Set<string>([...types.keys(), ...descrs.keys(), ...names.keys()]);
  const result: PolledInterface[] = [];

  for (const index of indexes) {
    const ifIndex = Number(index);
    if (!Number.isFinite(ifIndex)) continue;

    const ifType = asInt(types.get(index), 0);
    const descr = asString(descrs.get(index));
    const name = asString(names.get(index)) || descr || `if${ifIndex}`;
    const alias = asString(aliases.get(index));

    const adminUp = asInt(adminStatuses.get(index), IF_ADMIN_STATUS.up) === IF_ADMIN_STATUS.up;
    const operUp = asInt(operStatuses.get(index), IF_OPER_STATUS.down) === IF_OPER_STATUS.up;

    // ifHighSpeed is in Mbps; ifSpeed is bits/s and saturates at 4.29 Gbps
    const highSpeed = asInt(highSpeeds.get(index), 0);
    const speedMbps = highSpeed > 0 ? highSpeed : Math.round(asInt(speeds.get(index), 0) / 1_000_000);

    const errorTotal =
      BigInt(asInt(inErrors.get(index))) +
      BigInt(asInt(outErrors.get(index))) +
      BigInt(asInt(inDiscards.get(index))) +
      BigInt(asInt(outDiscards.get(index)));

    const poeKey = poeKeyFor(name);
    const poeMilliwatts = poeKey ? asInt(poeDraw.get(poeKey), 0) : 0;

    result.push({
      ifIndex,
      name,
      description: alias || descr,
      ifType,
      isPhysical: PHYSICAL_IF_TYPES.has(ifType),
      adminUp,
      operUp,
      speedMbps,
      speedLabel: speedLabelFor(speedMbps, operUp),
      portType: portTypeFor(name, speedMbps),
      duplex: DUPLEX_BY_CODE[asInt(duplexes.get(index), 1)] ?? 'Auto',
      inOctets: asBigInt(inOctets.get(index)),
      outOctets: asBigInt(outOctets.get(index)),
      errorTotal,
      fcsErrors: asBigInt(fcsErrors.get(index)) ?? 0n,
      errDisabled: errDisabledIfIndexes.has(ifIndex),
      vlan: asInt(vlanByIf.get(index), 1) || 1,
      poeWatts: poeMilliwatts > 0 ? Math.round((poeMilliwatts / 1000) * 10) / 10 : 0,
      connectedMac: connectedMacByIf.get(ifIndex) ?? null,
      mac: asMac(physAddresses.get(index)),
    });
  }

  return result.sort((a, b) => a.ifIndex - b.ifIndex);
};

/**
 * Bridge forwarding table -> one learned MAC per port, so the Ports page can show
 * what is plugged in. Access ports normally have exactly one; uplinks have hundreds,
 * so a port with many MACs is left blank rather than showing an arbitrary one.
 */
const readForwardingTable = async (session: SnmpSession): Promise<Map<number, string>> => {
  const qBridge = await session.tryWalk(Q_BRIDGE.dot1qTpFdbPort, 40);
  const table = qBridge.size > 0 ? qBridge : await session.tryWalk(Q_BRIDGE.dot1dTpFdbPort, 40);
  if (table.size === 0) return new Map();

  // FDB entries point at a bridge port number, which is not the ifIndex
  const bridgePortToIfIndex = await session.tryWalk(Q_BRIDGE.dot1dBasePortIfIndex);

  const macsByIfIndex = new Map<number, string[]>();
  for (const [index, portValue] of table) {
    const bridgePort = asInt(portValue, 0);
    if (bridgePort <= 0) continue;
    const ifIndex = asInt(bridgePortToIfIndex.get(String(bridgePort)), bridgePort);
    const mac = macFromFdbIndex(index);
    if (!mac) continue;
    const list = macsByIfIndex.get(ifIndex) ?? [];
    if (list.length < 5) list.push(mac);
    macsByIfIndex.set(ifIndex, list);
  }

  const result = new Map<number, string>();
  for (const [ifIndex, macs] of macsByIfIndex) {
    if (macs.length === 1) result.set(ifIndex, macs[0]);
  }
  return result;
};

// ---------------------------------------------------------------- VLANs

const readVlans = async (session: SnmpSession, vendor: Vendor): Promise<PolledVlan[]> => {
  const vlans = new Map<number, string>();

  if (vendor === 'cisco') {
    const [names, states] = await Promise.all([
      session.tryWalk(CISCO.vtpVlanName),
      session.tryWalk(CISCO.vtpVlanState),
    ]);
    for (const [index, nameValue] of names) {
      // index is managementDomainIndex.vlanId
      const vlanId = Number(index.split('.').pop());
      if (!Number.isFinite(vlanId) || vlanId <= 0 || vlanId > 4094) continue;
      const operational = states.size === 0 || asInt(states.get(index), 1) === 1;
      if (!operational) continue;
      vlans.set(vlanId, asString(nameValue, `VLAN${vlanId}`));
    }
  }

  if (vlans.size === 0) {
    const names = await session.tryWalk(Q_BRIDGE.dot1qVlanStaticName);
    for (const [index, nameValue] of names) {
      const vlanId = Number(index);
      if (!Number.isFinite(vlanId) || vlanId <= 0 || vlanId > 4094) continue;
      vlans.set(vlanId, asString(nameValue, `VLAN${vlanId}`));
    }
  }

  return [...vlans.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.id - b.id);
};

// ---------------------------------------------------------------- public API

/**
 * Read everything the dashboard needs from one device in a single SNMP session.
 *
 * Never throws: an unreachable or misconfigured device comes back as
 * `{ reachable: false, error }` so the poller can mark it offline and move on.
 */
export const pollDevice = async (target: SnmpTarget, options: { withPorts?: boolean } = {}): Promise<PollResult> => {
  const started = Date.now();
  try {
    return await withSnmp(target, async session => {
      // The system group doubles as the reachability probe: if this times out the
      // device is down (or the community/credentials are wrong) and nothing else matters.
      const system = await session.get([
        SYSTEM.sysDescr,
        SYSTEM.sysObjectID,
        SYSTEM.sysUpTime,
        SYSTEM.sysName,
        SYSTEM.sysLocation,
      ]);
      const responseMs = Date.now() - started;

      if (system.size === 0) {
        throw new SnmpError('Device answered but returned no values for the SNMP system group');
      }

      const sysDescr = asString(system.get(SYSTEM.sysDescr));
      const sysObjectID = asString(system.get(SYSTEM.sysObjectID));
      const uptimeTicks = asInt(system.get(SYSTEM.sysUpTime), 0);
      const vendor = detectVendor(sysObjectID, sysDescr);
      const missing: string[] = [];

      const [identity, cpu, ram, temp] = await Promise.all([
        readIdentity(session, vendor, sysDescr),
        readCpu(session, vendor, missing),
        readRam(session, vendor, missing),
        readTemperature(session, vendor, missing),
      ]);

      const interfaces = options.withPorts === false ? [] : await readInterfaces(session, vendor);
      const vlans = options.withPorts === false ? [] : await readVlans(session, vendor);

      // Device MAC: the first physical interface that reports one
      const mac = interfaces.find(i => i.isPhysical && i.mac)?.mac ?? '';

      return {
        reachable: true,
        responseMs,
        sysName: asString(system.get(SYSTEM.sysName)),
        sysDescr,
        sysObjectID,
        sysLocation: asString(system.get(SYSTEM.sysLocation)),
        uptimeTicks,
        uptime: formatUptimeFromTimeticks(uptimeTicks),
        vendor,
        vendorLabel: VENDOR_LABEL[vendor],
        model: identity.model,
        firmware: identity.firmware,
        serial: identity.serial,
        mac,
        cpu,
        ram,
        temp,
        interfaces,
        vlans,
        missing,
      } satisfies PollSuccess;
    });
  } catch (error) {
    const message =
      error instanceof SnmpError || error instanceof Error ? error.message : 'Unknown SNMP failure';
    return {
      reachable: false,
      // Translate net-snmp's bare "Request timed out" into something actionable
      error: /timed out/i.test(message)
        ? `No SNMP reply from ${target.host}:${target.port} within ${target.timeoutMs ?? env.snmp.timeoutMs} ms ` +
          '(device down, UDP blocked, or wrong community/credentials)'
        : message,
      responseMs: Date.now() - started,
    };
  }
};
