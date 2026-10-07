/**
 * A fake Cisco switch that speaks real SNMP, for testing the collector without hardware.
 *
 *   node scripts/fake-switch.mjs [port] [community]
 *
 * Defaults to udp/11611 with community "public" — an unprivileged port, so it needs no
 * administrator rights. Register it in NetMonitor as 127.0.0.1 with SNMP port 11611.
 *
 * It serves the OIDs the collector actually reads: the system group, ifTable/ifXTable,
 * EtherLike, ENTITY-MIB, the Cisco CPU/memory/temperature/VLAN tables, and a port that
 * is deliberately accumulating CRC errors so the red "faulty port" state can be seen.
 * Counters advance on every poll, which is what makes the traffic deltas non-zero.
 */
import snmp from 'net-snmp';

const port = Number(process.argv[2]) || 11611;
const community = process.argv[3] || 'public';

const O = snmp.ObjectType;
const MA = snmp.MaxAccess;

const agent = snmp.createAgent({ port, disableAuthorization: false }, (error) => {
  if (error) console.error('[fake-switch]', error);
});

// net-snmp checks the community against its authorizer
const authorizer = agent.getAuthorizer();
authorizer.addCommunity(community);

const mib = agent.getMib();
const startedAt = Date.now();

// ---------------------------------------------------------------- helpers

const scalar = (name, oid, scalarType, value) => {
  mib.registerProvider({ name, type: snmp.MibProviderType.Scalar, oid, scalarType, maxAccess: MA['read-only'] });
  mib.setScalarValue(name, value);
};

const table = (name, oid, columns, indexColumns, rows) => {
  mib.registerProvider({
    name,
    type: snmp.MibProviderType.Table,
    oid,
    maxAccess: MA['not-accessible'],
    tableColumns: columns.map(c => ({
      number: c.number,
      name: c.name,
      type: c.type,
      maxAccess: c.writable ? MA['read-write'] : MA['read-only'],
    })),
    tableIndex: indexColumns.map(columnName => ({ columnName })),
  });
  for (const row of rows) mib.addTableRow(name, row);
};

// ---------------------------------------------------------------- system group

scalar(
  'sysDescr',
  '1.3.6.1.2.1.1.1',
  O.OctetString,
  'Cisco IOS Software [Cupertino], Catalyst L3 Switch Software (CAT9K_IOSXE), Version 17.09.03a, ' +
    'RELEASE SOFTWARE (fc1), Copyright (c) 1986-2023 by Cisco Systems, Inc.'
);
// 1.3.6.1.4.1.9.1.2494 = Cisco C9300-48P, so the collector picks the Cisco MIBs
scalar('sysObjectID', '1.3.6.1.2.1.1.2', O.OID, '1.3.6.1.4.1.9.1.2494');
scalar('sysName', '1.3.6.1.2.1.1.5', O.OctetString, 'Lab-Core-SW-01');
scalar('sysLocation', '1.3.6.1.2.1.1.6', O.OctetString, 'Building A - Lab Rack 2');

// sysUpTime has to move, so the uptime string is not frozen
mib.registerProvider({
  name: 'sysUpTime',
  type: snmp.MibProviderType.Scalar,
  oid: '1.3.6.1.2.1.1.3',
  scalarType: O.TimeTicks,
  maxAccess: MA['read-only'],
  handler: (request) => {
    // 148 days of base uptime plus however long this process has been running
    request.instanceNode.value = 148 * 86400 * 100 + Math.floor((Date.now() - startedAt) / 10);
    request.done();
  },
});
mib.setScalarValue('sysUpTime', 148 * 86400 * 100);

// ---------------------------------------------------------------- interfaces

const PORT_COUNT = 8;
const macFor = (i) => Buffer.from([0x00, 0x1a, 0x2b, 0x3c, 0x4d, i]);

/** Port 1 is a 10G uplink; 2-6 are access ports; 7 is unplugged; 8 has a failing cable. */
const describe = (i) => {
  if (i === 1) return { name: `TenGigabitEthernet1/0/${i}`, speedMbps: 10000, up: true, vlan: 1 };
  if (i === 7) return { name: `GigabitEthernet1/0/${i}`, speedMbps: 0, up: false, vlan: 20 };
  return { name: `GigabitEthernet1/0/${i}`, speedMbps: 1000, up: true, vlan: i === 8 ? 20 : 10 + i };
};

const ports = Array.from({ length: PORT_COUNT }, (_, index) => {
  const i = index + 1;
  const info = describe(i);
  return {
    ifIndex: i,
    ...info,
    // Traffic per second, so the deltas between polls are realistic
    inBytesPerSecond: info.up ? (i === 1 ? 180_000_000 : 1_200_000 * i) : 0,
    outBytesPerSecond: info.up ? (i === 1 ? 95_000_000 : 700_000 * i) : 0,
    inOctets: 10_000_000_000 + i * 1_000_000,
    outOctets: 6_000_000_000 + i * 700_000,
    // Port 8 keeps collecting CRC errors: a bad patch cable
    fcsPerSecond: i === 8 ? 3 : 0,
    fcsErrors: i === 8 ? 1204 : 0,
    inErrors: i === 8 ? 980 : 0,
    lastTick: Date.now(),
  };
});

/** Advance the counters to "now" before any column is read. */
const advance = () => {
  const now = Date.now();
  for (const port of ports) {
    const elapsed = (now - port.lastTick) / 1000;
    if (elapsed <= 0) continue;
    port.lastTick = now;
    port.inOctets += Math.round(port.inBytesPerSecond * elapsed);
    port.outOctets += Math.round(port.outBytesPerSecond * elapsed);
    port.fcsErrors += Math.round(port.fcsPerSecond * elapsed);
    port.inErrors += Math.round(port.fcsPerSecond * elapsed);
  }
};
setInterval(advance, 1000).unref?.();

table(
  'ifTable',
  '1.3.6.1.2.1.2.2.1',
  [
    { number: 1, name: 'ifIndex', type: O.Integer },
    { number: 2, name: 'ifDescr', type: O.OctetString },
    { number: 3, name: 'ifType', type: O.Integer },
    { number: 5, name: 'ifSpeed', type: O.Gauge },
    { number: 6, name: 'ifPhysAddress', type: O.OctetString },
    { number: 7, name: 'ifAdminStatus', type: O.Integer, writable: true },
    { number: 8, name: 'ifOperStatus', type: O.Integer },
    { number: 13, name: 'ifInDiscards', type: O.Counter },
    { number: 14, name: 'ifInErrors', type: O.Counter },
    { number: 19, name: 'ifOutDiscards', type: O.Counter },
    { number: 20, name: 'ifOutErrors', type: O.Counter },
  ],
  ['ifIndex'],
  ports.map(p => [
    p.ifIndex,
    p.name,
    6, // ethernetCsmacd
    // ifSpeed saturates at 4.29 Gbps, which is why the collector prefers ifHighSpeed
    Math.min(4_294_967_295, p.speedMbps * 1_000_000),
    macFor(p.ifIndex),
    1, // ifAdminStatus up
    p.up ? 1 : 2,
    0,
    p.inErrors,
    0,
    0,
  ])
);

table(
  'ifXTable',
  '1.3.6.1.2.1.31.1.1.1',
  [
    { number: 1, name: 'ifName', type: O.OctetString },
    { number: 6, name: 'ifHCInOctets', type: O.Counter64 },
    { number: 10, name: 'ifHCOutOctets', type: O.Counter64 },
    { number: 15, name: 'ifHighSpeed', type: O.Gauge },
    { number: 18, name: 'ifAlias', type: O.OctetString },
  ],
  [],
  []
);
// ifXTable augments ifTable, so rows are indexed by ifIndex; set them through the MIB tree
mib.unregisterProvider('ifXTable');
mib.registerProvider({
  name: 'ifXTable',
  type: snmp.MibProviderType.Table,
  oid: '1.3.6.1.2.1.31.1.1.1',
  maxAccess: MA['not-accessible'],
  tableColumns: [
    { number: 1, name: 'ifName', type: O.OctetString, maxAccess: MA['read-only'] },
    { number: 6, name: 'ifHCInOctets', type: O.Counter64, maxAccess: MA['read-only'] },
    { number: 10, name: 'ifHCOutOctets', type: O.Counter64, maxAccess: MA['read-only'] },
    { number: 15, name: 'ifHighSpeed', type: O.Gauge, maxAccess: MA['read-only'] },
    { number: 18, name: 'ifAlias', type: O.OctetString, maxAccess: MA['read-only'] },
  ],
  tableAugments: 'ifTable',
  handler: (request) => {
    advance();
    const oid = request.instanceNode.oid ?? '';
    const parts = String(oid).split('.');
    const ifIndex = Number(parts[parts.length - 1]);
    const column = Number(parts[parts.length - 2]);
    const port = ports.find(p => p.ifIndex === ifIndex);
    if (port) {
      if (column === 6) request.instanceNode.value = toCounter64(port.inOctets);
      if (column === 10) request.instanceNode.value = toCounter64(port.outOctets);
    }
    request.done();
  },
});

/** Counter64 goes on the wire as 8 bytes. */
function toCounter64(value) {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(Math.round(value)));
  return buffer;
}

for (const p of ports) {
  mib.addTableRow('ifXTable', [
    p.ifIndex,
    p.name,
    toCounter64(p.inOctets),
    toCounter64(p.outOctets),
    p.speedMbps,
    p.ifIndex === 1 ? 'Uplink to Dist-SW' : `Access port ${p.ifIndex}`,
  ]);
}

// The FCS column has to keep climbing: the collector judges a port faulty on the
// DELTA since the last poll, so a frozen counter would read as a healthy port.
mib.registerProvider({
  name: 'dot3StatsTable',
  type: snmp.MibProviderType.Table,
  oid: '1.3.6.1.2.1.10.7.2.1',
  maxAccess: MA['not-accessible'],
  tableColumns: [
    { number: 1, name: 'dot3StatsIndex', type: O.Integer, maxAccess: MA['read-only'] },
    { number: 3, name: 'dot3StatsFCSErrors', type: O.Counter, maxAccess: MA['read-only'] },
    { number: 19, name: 'dot3StatsDuplexStatus', type: O.Integer, maxAccess: MA['read-only'] },
  ],
  tableIndex: [{ columnName: 'dot3StatsIndex' }],
  handler: (request) => {
    advance();
    const parts = String(request.instanceNode.oid ?? '').split('.');
    const ifIndex = Number(parts[parts.length - 1]);
    const column = Number(parts[parts.length - 2]);
    const port = ports.find(p => p.ifIndex === ifIndex);
    if (port && column === 3) request.instanceNode.value = port.fcsErrors;
    request.done();
  },
});
for (const p of ports) mib.addTableRow('dot3StatsTable', [p.ifIndex, p.fcsErrors, p.up ? 3 : 1]);

// ---------------------------------------------------------------- Cisco resource MIBs

table(
  'cpmCPUTotalTable',
  '1.3.6.1.4.1.9.9.109.1.1.1.1',
  [
    { number: 1, name: 'cpmCPUTotalIndex', type: O.Integer },
    { number: 7, name: 'cpmCPUTotal1minRev', type: O.Gauge },
    { number: 8, name: 'cpmCPUTotal5minRev', type: O.Gauge },
  ],
  ['cpmCPUTotalIndex'],
  // Deliberately above the 85% alert threshold, so the resource alert path is exercised
  [[1, 90, 88], [2, 94, 92]]
);

table(
  'ciscoMemoryPoolTable',
  '1.3.6.1.4.1.9.9.48.1.1.1',
  [
    { number: 1, name: 'ciscoMemoryPoolType', type: O.Integer },
    { number: 5, name: 'ciscoMemoryPoolUsed', type: O.Gauge },
    { number: 6, name: 'ciscoMemoryPoolFree', type: O.Gauge },
  ],
  ['ciscoMemoryPoolType'],
  // 2.6 GB used of 4 GB = 65%
  [[1, 2_684_354_560, 1_610_612_736]]
);

table(
  'ciscoEnvMonTemperatureStatusTable',
  '1.3.6.1.4.1.9.9.13.1.3.1',
  [
    { number: 1, name: 'ciscoEnvMonTemperatureStatusIndex', type: O.Integer },
    { number: 3, name: 'ciscoEnvMonTemperatureStatusValue', type: O.Gauge },
  ],
  ['ciscoEnvMonTemperatureStatusIndex'],
  [[1, 38], [2, 44]]
);

// ---------------------------------------------------------------- VLANs

table(
  'vmMembershipTable',
  '1.3.6.1.4.1.9.9.68.1.2.2.1',
  [
    { number: 1, name: 'vmMembershipIndex', type: O.Integer },
    { number: 2, name: 'vmVlan', type: O.Integer },
  ],
  ['vmMembershipIndex'],
  ports.map(p => [p.ifIndex, p.vlan])
);

table(
  'vtpVlanTable',
  '1.3.6.1.4.1.9.9.46.1.3.1.1',
  [
    { number: 1, name: 'vtpVlanIndex', type: O.Integer },
    { number: 2, name: 'vtpVlanState', type: O.Integer },
    { number: 4, name: 'vtpVlanName', type: O.OctetString },
  ],
  ['vtpVlanIndex'],
  [
    [1, 1, 'default'],
    [10, 1, 'MGMT-CORP'],
    [11, 1, 'DATA-FLOOR1'],
    [12, 1, 'DATA-FLOOR2'],
    [13, 1, 'DATA-FLOOR3'],
    [14, 1, 'DATA-FLOOR4'],
    [15, 1, 'DATA-FLOOR5'],
    [20, 1, 'VOICE-IP'],
  ]
);

// ---------------------------------------------------------------- ENTITY-MIB

table(
  'entPhysicalTable',
  '1.3.6.1.2.1.47.1.1.1.1',
  [
    { number: 1, name: 'entPhysicalIndex', type: O.Integer },
    { number: 5, name: 'entPhysicalClass', type: O.Integer },
    { number: 10, name: 'entPhysicalSoftwareRev', type: O.OctetString },
    { number: 11, name: 'entPhysicalSerialNum', type: O.OctetString },
    { number: 13, name: 'entPhysicalModelName', type: O.OctetString },
  ],
  ['entPhysicalIndex'],
  // class 3 = chassis, which is the row the collector reads for model and firmware
  [[1, 3, '17.09.03a', 'FOC2448L0AB', 'C9300-48P-A']]
);

console.log(`[fake-switch] Lab-Core-SW-01 answering SNMP v2c on udp/${port}, community "${community}"`);
console.log(`[fake-switch] ${PORT_COUNT} ports: 1 is a 10G uplink, 7 is unplugged, 8 is failing CRC`);
console.log('[fake-switch] register it as IP 127.0.0.1 with SNMP port', port);
