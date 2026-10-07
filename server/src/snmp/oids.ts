/**
 * OIDs used by the collector, grouped by what they tell us.
 *
 * Vendor MIBs differ for CPU, memory and temperature, so the collector tries the
 * vendor table that matches sysObjectID/sysDescr first and falls back to the
 * standard HOST-RESOURCES-MIB and ENTITY-SENSOR-MIB, which most modern NOS support.
 */

// ---------------------------------------------------------------- system (RFC 1213)

export const SYSTEM = {
  sysDescr: '1.3.6.1.2.1.1.1.0',
  sysObjectID: '1.3.6.1.2.1.1.2.0',
  sysUpTime: '1.3.6.1.2.1.1.3.0',
  sysContact: '1.3.6.1.2.1.1.4.0',
  sysName: '1.3.6.1.2.1.1.5.0',
  sysLocation: '1.3.6.1.2.1.1.6.0',
} as const;

// ---------------------------------------------------------------- IF-MIB (RFC 2863)

export const IF_MIB = {
  ifDescr: '1.3.6.1.2.1.2.2.1.2',
  ifType: '1.3.6.1.2.1.2.2.1.3',
  ifSpeed: '1.3.6.1.2.1.2.2.1.5',
  ifPhysAddress: '1.3.6.1.2.1.2.2.1.6',
  ifAdminStatus: '1.3.6.1.2.1.2.2.1.7',
  ifOperStatus: '1.3.6.1.2.1.2.2.1.8',
  ifInDiscards: '1.3.6.1.2.1.2.2.1.13',
  ifInErrors: '1.3.6.1.2.1.2.2.1.14',
  ifOutDiscards: '1.3.6.1.2.1.2.2.1.19',
  ifOutErrors: '1.3.6.1.2.1.2.2.1.20',
  // 64-bit counters — required on anything above 100 Mbps or the counter wraps too fast
  ifName: '1.3.6.1.2.1.31.1.1.1.1',
  ifHCInOctets: '1.3.6.1.2.1.31.1.1.1.6',
  ifHCOutOctets: '1.3.6.1.2.1.31.1.1.1.10',
  ifHighSpeed: '1.3.6.1.2.1.31.1.1.1.15',
  ifAlias: '1.3.6.1.2.1.31.1.1.1.18',
} as const;

/** ifType values the collector treats as a physical switch/router port. */
export const PHYSICAL_IF_TYPES = new Set([
  6, // ethernetCsmacd
  117, // gigabitEthernet (legacy)
  62, // fastEther
  69, // fastEtherFX
]);

export const IF_ADMIN_STATUS = { up: 1, down: 2, testing: 3 } as const;
export const IF_OPER_STATUS = {
  up: 1,
  down: 2,
  testing: 3,
  unknown: 4,
  dormant: 5,
  notPresent: 6,
  lowerLayerDown: 7,
} as const;

// ---------------------------------------------------------------- EtherLike-MIB (RFC 3635)

export const ETHERLIKE = {
  // Frame check sequence errors — a bad cable or SFP. Drives the red "CRC" port state.
  dot3StatsFCSErrors: '1.3.6.1.2.1.10.7.2.1.3',
  dot3StatsDuplexStatus: '1.3.6.1.2.1.10.7.2.1.19', // 1 unknown, 2 halfDuplex, 3 fullDuplex
} as const;

// ---------------------------------------------------------------- ENTITY-MIB (RFC 4133)

export const ENTITY_MIB = {
  entPhysicalDescr: '1.3.6.1.2.1.47.1.1.1.1.2',
  entPhysicalClass: '1.3.6.1.2.1.47.1.1.1.1.5', // 3 = chassis
  entPhysicalName: '1.3.6.1.2.1.47.1.1.1.1.7',
  entPhysicalSoftwareRev: '1.3.6.1.2.1.47.1.1.1.1.10',
  entPhysicalSerialNum: '1.3.6.1.2.1.47.1.1.1.1.11',
  entPhysicalModelName: '1.3.6.1.2.1.47.1.1.1.1.13',
  classChassis: 3,
} as const;

// ---------------------------------------------------------------- Q-BRIDGE-MIB (RFC 4363)

export const Q_BRIDGE = {
  dot1qVlanStaticName: '1.3.6.1.2.1.17.7.1.4.3.1.1',
  dot1qPvid: '1.3.6.1.2.1.17.7.1.4.5.1.1',
  dot1qTpFdbPort: '1.3.6.1.2.1.17.7.1.2.2.1.2',
  // Classic bridge MIB, still the only one some access switches answer
  dot1dTpFdbPort: '1.3.6.1.2.1.17.4.3.1.2',
  dot1dBasePortIfIndex: '1.3.6.1.2.1.17.1.4.1.2',
} as const;

// ---------------------------------------------------------------- POWER-ETHERNET-MIB + Cisco PoE

export const POE = {
  pethPsePortAdminEnable: '1.3.6.1.2.1.105.1.1.1.3',
  // Cisco CISCO-POWER-ETHERNET-EXT-MIB: milliwatts actually drawn
  cpeExtPsePortPwrConsumption: '1.3.6.1.4.1.9.9.402.1.2.1.9',
} as const;

// ---------------------------------------------------------------- HOST-RESOURCES-MIB (RFC 2790)

export const HOST_RESOURCES = {
  hrProcessorLoad: '1.3.6.1.2.1.25.3.3.1.2',
  hrStorageType: '1.3.6.1.2.1.25.2.3.1.2',
  hrStorageDescr: '1.3.6.1.2.1.25.2.3.1.3',
  hrStorageAllocationUnits: '1.3.6.1.2.1.25.2.3.1.4',
  hrStorageSize: '1.3.6.1.2.1.25.2.3.1.5',
  hrStorageUsed: '1.3.6.1.2.1.25.2.3.1.6',
  // hrStorageTypes we read as RAM
  typeRam: '1.3.6.1.2.1.25.2.1.2',
} as const;

// ---------------------------------------------------------------- ENTITY-SENSOR-MIB (RFC 3433)

export const ENTITY_SENSOR = {
  entPhySensorType: '1.3.6.1.2.1.99.1.1.1.1', // 8 = celsius
  entPhySensorScale: '1.3.6.1.2.1.99.1.1.1.2',
  entPhySensorPrecision: '1.3.6.1.2.1.99.1.1.1.3',
  entPhySensorValue: '1.3.6.1.2.1.99.1.1.1.4',
  celsius: 8,
} as const;

// ---------------------------------------------------------------- vendor MIBs

export const CISCO = {
  // CISCO-PROCESS-MIB, 5-minute average. Preferred over the deprecated avgBusy5.
  cpmCPUTotal5minRev: '1.3.6.1.4.1.9.9.109.1.1.1.1.8',
  cpmCPUTotal1minRev: '1.3.6.1.4.1.9.9.109.1.1.1.1.7',
  avgBusy5: '1.3.6.1.4.1.9.2.1.58.0', // OLD-CISCO-CPU-MIB, scalar
  // CISCO-MEMORY-POOL-MIB, bytes
  ciscoMemoryPoolUsed: '1.3.6.1.4.1.9.9.48.1.1.1.5',
  ciscoMemoryPoolFree: '1.3.6.1.4.1.9.9.48.1.1.1.6',
  // CISCO-ENVMON-MIB, degrees celsius
  ciscoEnvMonTemperatureValue: '1.3.6.1.4.1.9.9.13.1.3.1.3',
  // CISCO-VLAN-MEMBERSHIP-MIB: access VLAN per ifIndex
  vmVlan: '1.3.6.1.4.1.9.9.68.1.2.2.1.2',
  // CISCO-VTP-MIB: VLAN names
  vtpVlanName: '1.3.6.1.4.1.9.9.46.1.3.1.1.4',
  vtpVlanState: '1.3.6.1.4.1.9.9.46.1.3.1.1.2',
  // CISCO-ERR-DISABLE-MIB: present for every port the switch has err-disabled
  cErrDisableIfStatusCause: '1.3.6.1.4.1.9.9.548.1.3.1.1.2',
} as const;

export const ARUBA = {
  // ArubaOS-Switch / ProCurve
  hpSwitchCpuStat: '1.3.6.1.4.1.11.2.14.11.5.1.9.6.1.0',
  hpLocalMemTotalBytes: '1.3.6.1.4.1.11.2.14.11.5.1.1.2.1.1.1.5',
  hpLocalMemAllocBytes: '1.3.6.1.4.1.11.2.14.11.5.1.1.2.1.1.1.7',
  // ArubaOS-CX exposes CPU/memory through its own MIB
  arubaWiredCpuUtil: '1.3.6.1.4.1.47196.4.1.1.3.8.1.1.1.4',
  arubaWiredMemUtil: '1.3.6.1.4.1.47196.4.1.1.3.8.1.1.1.6',
} as const;

export const FORTINET = {
  fgSysCpuUsage: '1.3.6.1.4.1.12356.101.4.1.3.0',
  fgSysMemUsage: '1.3.6.1.4.1.12356.101.4.1.4.0',
  fgSysVersion: '1.3.6.1.4.1.12356.101.4.1.1.0',
  fgHwSensorEntValue: '1.3.6.1.4.1.12356.101.4.3.2.1.3',
  fgHwSensorEntName: '1.3.6.1.4.1.12356.101.4.3.2.1.2',
} as const;

export const JUNIPER = {
  jnxOperatingCPU: '1.3.6.1.4.1.2636.3.1.13.1.8',
  jnxOperatingBuffer: '1.3.6.1.4.1.2636.3.1.13.1.11',
  jnxOperatingTemp: '1.3.6.1.4.1.2636.3.1.13.1.7',
} as const;

export const HUAWEI = {
  hwCpuDevTable: '1.3.6.1.4.1.2011.6.3.4.1.2',
  hwMemoryDevTable: '1.3.6.1.4.1.2011.6.3.5.1.1.2',
} as const;

export type Vendor = 'cisco' | 'aruba' | 'fortinet' | 'juniper' | 'huawei' | 'generic';

/** Private-enterprise number prefixes, matched against sysObjectID. */
const ENTERPRISE_PREFIX: Array<[string, Vendor]> = [
  ['1.3.6.1.4.1.9.', 'cisco'],
  ['1.3.6.1.4.1.11.', 'aruba'],
  ['1.3.6.1.4.1.47196.', 'aruba'],
  ['1.3.6.1.4.1.14823.', 'aruba'],
  ['1.3.6.1.4.1.12356.', 'fortinet'],
  ['1.3.6.1.4.1.2636.', 'juniper'],
  ['1.3.6.1.4.1.2011.', 'huawei'],
];

/** Fallback when sysObjectID is missing or unknown: read the vendor out of sysDescr. */
const DESCR_KEYWORD: Array<[RegExp, Vendor]> = [
  [/cisco|ios[- ]xe|nx-os/i, 'cisco'],
  [/aruba|procurve|hewlett|hpe|aos-cx/i, 'aruba'],
  [/fortigate|fortios|fortinet/i, 'fortinet'],
  [/juniper|junos/i, 'juniper'],
  [/huawei|vrp/i, 'huawei'],
];

export const detectVendor = (sysObjectID: string, sysDescr: string): Vendor => {
  const oid = sysObjectID.startsWith('.') ? sysObjectID.slice(1) : sysObjectID;
  for (const [prefix, vendor] of ENTERPRISE_PREFIX) {
    if (oid.startsWith(prefix)) return vendor;
  }
  for (const [pattern, vendor] of DESCR_KEYWORD) {
    if (pattern.test(sysDescr)) return vendor;
  }
  return 'generic';
};

/** Human-readable vendor name for the inventory table. */
export const VENDOR_LABEL: Record<Vendor, string> = {
  cisco: 'Cisco Systems',
  aruba: 'Aruba Networks',
  fortinet: 'Fortinet',
  juniper: 'Juniper Networks',
  huawei: 'Huawei',
  generic: 'Unknown',
};
