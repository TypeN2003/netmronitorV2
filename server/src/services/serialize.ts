import type {
  AccessPoint,
  Alert,
  AlertNote,
  Backup,
  ClientSession,
  Device,
  Port,
  Settings,
  Syslog,
  TopologyLink,
  TopologyNode,
  User,
  Vlan,
} from '@prisma/client';

/**
 * Row -> JSON shaping.
 *
 * Every function here produces exactly the shape declared in the frontend's
 * src/types/index.ts, so pages can consume API responses without a mapping layer.
 * BigInt columns never leave this module: JSON.stringify throws on them.
 */

export const serializeUser = (user: User) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  role: user.role,
  avatar: user.avatar ?? undefined,
  department: user.department,
  status: user.status,
  createdAt: user.createdAt,
  lastLogin: user.lastLogin,
  permissions: {
    canEditDevices: user.canEditDevices,
    canManageUsers: user.canManageUsers,
    canEditTopology: user.canEditTopology,
    canImportConfig: user.canImportConfig,
    canAcknowledgeAlerts: user.canAcknowledgeAlerts,
    canModifySettings: user.canModifySettings,
    canRebootDevices: user.canRebootDevices,
  },
  // password is never serialized, not even for Admins
});

export const serializeDevice = (device: Device) => ({
  id: device.id,
  name: device.name,
  ip: device.ip,
  mac: device.mac,
  type: device.type,
  vendor: device.vendor,
  model: device.model,
  location: device.location,
  rack: device.rack,
  status: device.status,
  uptime: device.uptime,
  cpu: device.cpu,
  ram: device.ram,
  temp: device.temp,
  portsTotal: device.portsTotal,
  portsUp: device.portsUp,
  pingMs: device.pingMs,
  trafficInMbps: device.trafficInMbps,
  trafficOutMbps: device.trafficOutMbps,
  lastSeen: device.lastSeen,
  firmware: device.firmware,
  config: device.config ?? undefined,
  // Collector configuration and diagnostics
  snmpVersion: device.snmpVersion,
  snmpPort: device.snmpPort,
  snmpV3User: device.snmpV3User ?? undefined,
  snmpV3SecurityLevel: device.snmpV3SecurityLevel ?? undefined,
  snmpV3AuthProtocol: device.snmpV3AuthProtocol ?? undefined,
  snmpV3PrivProtocol: device.snmpV3PrivProtocol ?? undefined,
  snmpV3Context: device.snmpV3Context ?? undefined,
  pollEnabled: device.pollEnabled,
  // Whether a write credential exists, never the credential itself
  canWriteSnmp: device.snmpVersion === '3' || Boolean(device.snmpWriteCommunity),
  lastError: device.lastError ?? undefined,
  lastPolledAt: device.lastPolledAt ?? undefined,
  // Community strings and the v3 auth/priv keys are credentials: never serialized
});

export const serializePort = (port: Port) => ({
  id: port.portId,
  ifIndex: port.ifIndex,
  name: port.name,
  status: port.status,
  fault: port.fault ?? undefined,
  speed: port.speed,
  duplex: port.duplex,
  vlan: port.vlan,
  vlanName: port.vlanName,
  poeWatts: port.poeWatts,
  inTrafficMbps: port.inTrafficMbps,
  outTrafficMbps: port.outTrafficMbps,
  errorDiscards: port.errorDiscards,
  connectedDevice: port.connectedDevice ?? undefined,
  connectedMac: port.connectedMac ?? undefined,
  adminUp: port.adminUp,
  portType: port.portType,
});

export const serializeVlan = (vlan: Vlan) => ({
  id: vlan.id,
  name: vlan.name,
  subnet: vlan.subnet,
  gateway: vlan.gateway,
  activePorts: vlan.activePorts,
  dhcpTotal: vlan.dhcpTotal,
  dhcpUsed: vlan.dhcpUsed,
  trafficRateMbps: vlan.trafficRateMbps,
  status: vlan.status,
  description: vlan.description,
  discovered: vlan.discovered,
});

export const serializeAccessPoint = (ap: AccessPoint) => {
  let ssidList: string[] = [];
  try {
    const parsed = JSON.parse(ap.ssidList);
    if (Array.isArray(parsed)) ssidList = parsed.map(String);
  } catch {
    ssidList = [];
  }
  return {
    id: ap.id,
    name: ap.name,
    ip: ap.ip,
    mac: ap.mac,
    location: ap.location,
    building: ap.building,
    floor: ap.floor,
    ssidList,
    channels: { band24: ap.channel24, band5: ap.channel5, band6: ap.channel6 ?? undefined },
    txPowerDbm: ap.txPowerDbm,
    channelWidthMhz: ap.channelWidthMhz,
    rssiAvg: ap.rssiAvg,
    connectedClients: ap.connectedClients,
    cpu: ap.cpu,
    ram: ap.ram,
    retryRate: ap.retryRate,
    status: ap.status,
    model: ap.model,
    uptime: ap.uptime,
  };
};

export const serializeClient = (client: ClientSession) => ({
  id: client.id,
  hostname: client.hostname,
  ip: client.ip,
  mac: client.mac,
  connectedNode: client.connectedNode,
  nodeType: client.nodeType,
  vlanId: client.vlanId,
  ssid: client.ssid ?? undefined,
  band: client.band ?? undefined,
  rssi: client.rssi,
  rxRateMbps: client.rxRateMbps,
  txRateMbps: client.txRateMbps,
  duration: client.duration,
  osVendor: client.osVendor,
  osType: client.osType,
  status: client.status,
});

export const serializeTopologyNode = (node: TopologyNode) => ({
  id: node.id,
  label: node.label,
  ip: node.ip,
  tier: node.tier,
  type: node.type,
  status: node.status,
  x: node.x,
  y: node.y,
  groupCount: node.groupCount ?? undefined,
  isCollapsed: node.isCollapsed,
  model: node.model ?? undefined,
  deviceId: node.deviceId ?? undefined,
});

export const serializeTopologyLink = (link: TopologyLink) => ({
  id: link.id,
  source: link.source,
  target: link.target,
  speed: link.speed,
  linkType: link.linkType,
  status: link.status,
});

export const serializeAlert = (alert: Alert & { notes?: AlertNote[] }) => ({
  id: alert.id,
  timestamp: alert.timestamp,
  deviceName: alert.deviceName,
  deviceIp: alert.deviceIp,
  severity: alert.severity,
  category: alert.category,
  message: alert.message,
  categoryTh: alert.categoryTh ?? undefined,
  messageTh: alert.messageTh ?? undefined,
  status: alert.status,
  acknowledgedBy: alert.acknowledgedBy ?? undefined,
  acknowledgedAt: alert.acknowledgedAt ?? undefined,
  notes: (alert.notes ?? []).map(note => ({
    id: note.id,
    author: note.author,
    role: note.role,
    timestamp: note.timestamp,
    text: note.text,
  })),
});

export const serializeSyslog = (log: Syslog) => ({
  id: log.id,
  timestamp: log.timestamp,
  facility: log.facility,
  severity: log.severity,
  host: log.host,
  ip: log.ip,
  tag: log.tag,
  message: log.message,
});

export const serializeBackup = (backup: Backup) => ({
  id: backup.id,
  deviceId: backup.deviceId ?? '',
  deviceName: backup.deviceName,
  deviceIp: backup.deviceIp,
  deviceType: backup.deviceType,
  versionTag: backup.versionTag,
  timestamp: backup.timestamp,
  sizeKb: backup.sizeKb,
  checksumSha256: backup.checksumSha256,
  triggeredBy: backup.triggeredBy,
  triggerType: backup.triggerType,
  configContent: backup.configContent,
  format: backup.format,
  notes: backup.notes ?? undefined,
});

export const serializeSettings = (settings: Settings) => ({
  snmpInterval: settings.snmpInterval,
  pingTimeoutMs: settings.pingTimeoutMs,
  packetLossThreshold: settings.packetLossThreshold,
  // The bot token is a credential: whoever holds it controls the bot, so it stays
  // on the server. The UI shows whether one is stored and sends a new one to replace it.
  telegramBotTokenSet: Boolean(settings.telegramBotToken.trim()),
  telegramChatId: settings.telegramChatId,
  telegramEnabled: settings.telegramEnabled,
  telegramNotifyRecovery: settings.telegramNotifyRecovery,
  telegramMinSeverity: settings.telegramMinSeverity,
  telegramCooldownMinutes: settings.telegramCooldownMinutes,
  emailNotification: settings.emailNotification,
  emailEnabled: settings.emailEnabled,
  emailNotifyRecovery: settings.emailNotifyRecovery,
  emailMinSeverity: settings.emailMinSeverity,
  emailCooldownMinutes: settings.emailCooldownMinutes,
  smtpHost: settings.smtpHost,
  smtpPort: settings.smtpPort,
  smtpUser: settings.smtpUser,
  emailFrom: settings.emailFrom,
  // The Gmail App Password is a credential: the UI only learns whether one is stored
  smtpPasswordSet: Boolean(settings.smtpPassword.trim()),
  sessionTimeoutMinutes: settings.sessionTimeoutMinutes,
  backupPolicy: { lastGlobalBackup: settings.lastGlobalBackup ?? undefined },
  ruckusOneUrl: settings.ruckusOneUrl,
});
