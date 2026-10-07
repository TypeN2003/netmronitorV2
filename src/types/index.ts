export type Role = 'Admin' | 'Engineer' | 'Viewer';

export interface UserPermissions {
  canEditDevices: boolean;
  canManageUsers: boolean;
  canEditTopology: boolean;
  canImportConfig: boolean;
  canAcknowledgeAlerts: boolean;
  canModifySettings: boolean;
  canRebootDevices: boolean;
}

export interface User {
  id: string;
  name: string;
  email: string;
  password?: string;
  role: Role;
  avatar?: string;
  department: string;
  status: 'Active' | 'Suspended';
  createdAt: string;
  lastLogin: string;
  permissions: UserPermissions;
}

export type DeviceType = 
  | 'Router' 
  | 'Core Switch' 
  | 'Distribution Switch' 
  | 'Edge Switch' 
  | 'Firewall' 
  | 'Server';

export interface NetworkDevice {
  id: string;
  name: string;
  ip: string;
  mac: string;
  type: DeviceType;
  vendor: string;
  model: string;
  location: string;
  rack: string;
  status: 'online' | 'warning' | 'offline';
  uptime: string;
  cpu: number;
  ram: number;
  temp: number;
  portsTotal: number;
  portsUp: number;
  pingMs: number;
  trafficInMbps?: number;
  trafficOutMbps?: number;
  lastSeen: string;
  firmware: string;
  config?: string;
  /**
   * Never sent by the API: community strings are credentials and stay on the server.
   * Present only on a device object being submitted for create/update.
   */
  snmpCommunity?: string;

  // ---- Collector fields (set by the backend; absent in a device being created) ----
  /** SNMP transport the collector uses for this device. */
  snmpVersion?: '2c' | '3';
  snmpPort?: number;
  snmpV3User?: string;
  snmpV3SecurityLevel?: 'noAuthNoPriv' | 'authNoPriv' | 'authPriv';
  snmpV3AuthProtocol?: 'md5' | 'sha' | 'sha224' | 'sha256' | 'sha384' | 'sha512';
  snmpV3PrivProtocol?: 'des' | 'aes' | 'aes256b' | 'aes256r';
  snmpV3Context?: string;
  /** False pauses polling without deleting the device. */
  pollEnabled?: boolean;
  /** True when a write credential exists, so ports can be shut from NetMonitor. */
  canWriteSnmp?: boolean;
  /** Why the last poll failed, or which metrics the agent did not answer. */
  lastError?: string;
  lastPolledAt?: string;
}

export interface PortInfo {
  /** 1-based position in the port grid. Stable across polls. */
  id: number;
  /** The port's real SNMP identity. Absent only for ports from before the backend existed. */
  ifIndex?: number;
  name: string;
  status: 'up' | 'down' | 'warning' | 'error';
  // Why an 'error' (faulty) port is broken
  fault?: 'crc' | 'errdisable';
  speed: string;
  duplex: 'Full' | 'Half' | 'Auto';
  vlan: number;
  vlanName: string;
  poeWatts: number;
  inTrafficMbps: number;
  outTrafficMbps: number;
  errorDiscards: number;
  connectedDevice?: string;
  connectedMac?: string;
  adminUp: boolean;
  portType: 'RJ45' | 'SFP+' | 'QSFP';
}

export interface VlanInfo {
  id: number;
  name: string;
  subnet: string;
  gateway: string;
  activePorts: number;
  dhcpTotal: number;
  dhcpUsed: number;
  trafficRateMbps: number;
  status: 'active' | 'degraded';
  description: string;
  /** True when the collector learned this VLAN from a switch rather than a human adding it. */
  discovered?: boolean;
}

export interface AccessPoint {
  id: string;
  name: string;
  ip: string;
  mac: string;
  location: string;
  building: string;
  floor: string;
  ssidList: string[];
  channels: {
    band24: number;
    band5: number;
    band6?: number;
  };
  txPowerDbm: number;
  channelWidthMhz: number;
  rssiAvg: number;
  connectedClients: number;
  cpu: number;
  ram: number;
  retryRate: number;
  status: 'online' | 'warning' | 'offline';
  model: string;
  uptime: string;
}

export interface ClientSession {
  id: string;
  hostname: string;
  ip: string;
  mac: string;
  connectedNode: string;
  nodeType: 'AP' | 'Switch';
  vlanId: number;
  ssid?: string;
  band?: '2.4 GHz' | '5 GHz' | '6 GHz' | 'Ethernet';
  rssi: number;
  rxRateMbps: number;
  txRateMbps: number;
  duration: string;
  osVendor: string;
  osType: 'Apple' | 'Android' | 'Windows' | 'Linux' | 'IoT';
  status: 'active' | 'idle';
}

export interface TopologyNode {
  id: string;
  label: string;
  ip: string;
  tier: 1 | 2 | 3 | 4 | 5;
  type: 'wan' | 'router' | 'firewall' | 'core_switch' | 'dist_switch' | 'edge_ap' | 'host_group' | 'server';
  status: 'online' | 'warning' | 'offline';
  x: number;
  y: number;
  groupCount?: number;
  isCollapsed?: boolean;
  subClients?: string[];
  model?: string;
  /** Set when this node mirrors a monitored device's live status. */
  deviceId?: string;
}

export interface TopologyLink {
  id: string;
  source: string;
  target: string;
  speed: string;
  linkType: 'fiber_10g' | 'copper_1g' | 'fiber_40g' | 'trunk';
  status: 'up' | 'degraded' | 'down';
}

export interface AlertNote {
  id: string;
  author: string;
  role: Role;
  timestamp: string;
  text: string;
}

export interface IncidentAlert {
  id: string;
  timestamp: string;
  deviceName: string;
  deviceIp: string;
  severity: 'critical' | 'warning' | 'info';
  category: string;
  message: string;
  categoryTh?: string;
  messageTh?: string;
  status: 'active' | 'acknowledged' | 'resolved';
  acknowledgedBy?: string;
  acknowledgedAt?: string;
  notes: AlertNote[];
}

export interface SyslogEntry {
  id: string;
  timestamp: string;
  facility: string;
  severity: 'Emergency' | 'Alert' | 'Critical' | 'Error' | 'Warning' | 'Notice' | 'Info';
  host: string;
  ip: string;
  tag: string;
  message: string;
}

export interface ConfigBackup {
  id: string;
  deviceId: string;
  deviceName: string;
  deviceIp: string;
  deviceType: DeviceType;
  versionTag: string;
  timestamp: string;
  sizeKb: number;
  checksumSha256: string;
  triggeredBy: string;
  triggerType: 'scheduled' | 'manual' | 'pre-change';
  configContent: string;
  format: 'cisco_ios' | 'fortios' | 'json' | 'generic';
  notes?: string;
}

export interface BackupPolicy {
  lastGlobalBackup?: string;
}

export interface SystemSettings {
  snmpInterval: number;
  pingTimeoutMs: number;
  packetLossThreshold: number;
  /**
   * Write-only. The API never returns the bot token (it is a credential), so this
   * is only ever set on a settings object being submitted. Send it empty to keep
   * whatever the server already has.
   */
  telegramBotToken?: string;
  /** True when a bot token is stored on the server. */
  telegramBotTokenSet?: boolean;
  telegramChatId: string;
  telegramEnabled?: boolean;
  telegramNotifyRecovery?: boolean;
  telegramMinSeverity?: 'info' | 'warning' | 'critical';
  telegramCooldownMinutes?: number;
  /** Where alert emails are sent. */
  emailNotification: string;
  emailEnabled?: boolean;
  emailNotifyRecovery?: boolean;
  emailMinSeverity?: 'info' | 'warning' | 'critical';
  emailCooldownMinutes?: number;
  smtpHost?: string;
  smtpPort?: number;
  smtpUser?: string;
  emailFrom?: string;
  /**
   * Write-only, like the Telegram token. The API never returns the App Password;
   * send it empty to keep whatever the server already has.
   */
  smtpPassword?: string;
  /** True when an App Password is stored on the server. */
  smtpPasswordSet?: boolean;
  sessionTimeoutMinutes: number;
  backupPolicy: BackupPolicy;
  // Web console of the faculty's cloud-managed RUCKUS One Wi-Fi (opened from the Access Points page)
  ruckusOneUrl?: string;
}

// ---------------------------------------------------------------- collector API shapes

/** Result of POST /api/devices/test-snmp — what an address answered, before saving it. */
export type SnmpProbeResult =
  | { reachable: false; error: string; responseMs: number }
  | {
      reachable: true;
      responseMs: number;
      /** Inventory fields read off the device, used to pre-fill the form. */
      suggested: {
        name?: string;
        vendor?: string;
        model?: string;
        firmware?: string;
        location?: string;
        mac?: string;
      };
      metrics: { cpu: number; ram: number; temp: number; uptime: string };
      sysDescr: string;
      serial?: string;
      interfaceCount: number;
      physicalPortCount: number;
      portsUp: number;
      vlans: Array<{ id: number; name: string }>;
      /** Metrics the agent did not answer, so the UI can explain a 0% reading. */
      missing: string[];
    };

/** Collector health, for the Settings page and the header's last-sync line. */
export interface TelemetryStatus {
  pollerEnabled: boolean;
  intervalSeconds: number;
  timeoutMs: number;
  concurrency: number;
  cpuThreshold: number;
  ramThreshold: number;
  deviceCount: number;
  pollableCount: number;
  sampleCount: number;
  lastCycle: {
    startedAt: string;
    finishedAt: string;
    durationMs: number;
    polled: number;
    reachable: number;
    failed: number;
    skipped: number;
    devices: Array<{ id: string; name: string; ip: string; ok: boolean; error?: string; responseMs: number }>;
  } | null;
  serverTime: string;
}

export interface TrafficPoint {
  time: string;
  inbound: number;
  outbound: number;
}

export interface ResourcePoint {
  time: string;
  cpu: number;
  ram: number;
  temp: number;
  pingMs: number;
}

/** Stored telemetry bucketed for the Dashboard and Statistics charts. */
export interface TelemetryHistory {
  unit: 'Mbps';
  hours: number;
  points: number;
  sampleCount: number;
  traffic: TrafficPoint[];
  resource: ResourcePoint[];
}

/** Busiest ports network-wide — the Statistics page's top talkers. */
export interface TopPortRow {
  deviceName: string;
  deviceIp: string;
  portName: string;
  vlan: number;
  vlanName: string;
  inMbps: number;
  outMbps: number;
  totalMbps: number;
  connectedMac?: string;
}
