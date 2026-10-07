import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import {
  NetworkDevice,
  PortInfo,
  VlanInfo,
  AccessPoint,
  ClientSession,
  TopologyNode,
  TopologyLink,
  IncidentAlert,
  SyslogEntry,
  SystemSettings,
  ConfigBackup,
  Role,
  TelemetryStatus,
} from '../types';
import {
  ApiError,
  api,
  getAuthToken,
  subscribeToEvents,
  type DeviceInput,
  type PollCycleSummary,
  type TopologyPlacement,
} from '../services/api';
import { useAuth } from './AuthContext';

/**
 * Live network state, served by the collector.
 *
 * Nothing here is generated in the browser any more: every device, port, VLAN and
 * alert came from a device that answered SNMP. The provider loads one `/api/bootstrap`
 * snapshot, then keeps it current from the server's event stream, with an interval
 * refresh as a fallback if the stream drops.
 *
 * Mutations go to the server first and only then update local state, so the screen
 * never shows a change the collector rejected.
 */

// Alert thresholds. The collector applies the same numbers server-side (CPU_ALERT_THRESHOLD
// and RAM_ALERT_THRESHOLD in server/.env); these are for the Dashboard's own counters.
export const CPU_THRESHOLD = 85;
export const RAM_THRESHOLD = 90;

export const DEFAULT_RUCKUS_ONE_URL = 'https://asia.ruckus.cloud';

/** Category and message in the viewer's language (falls back to English). */
export const alertText = (a: IncidentAlert, lang: 'th' | 'en') => ({
  category: lang === 'th' ? a.categoryTh ?? a.category : a.category,
  message: lang === 'th' ? a.messageTh ?? a.message : a.message,
});

/** Local wall-clock time (the app runs in Thailand, UTC+7), formatted YYYY-MM-DD HH:mm:ss. */
export const nowTimestamp = (): string => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

const EMPTY_SETTINGS: SystemSettings = {
  snmpInterval: 300,
  pingTimeoutMs: 2000,
  packetLossThreshold: 5,
  telegramChatId: '',
  telegramEnabled: true,
  telegramNotifyRecovery: true,
  telegramMinSeverity: 'info',
  telegramCooldownMinutes: 5,
  emailNotification: '',
  emailEnabled: false,
  emailNotifyRecovery: true,
  emailMinSeverity: 'warning',
  emailCooldownMinutes: 5,
  smtpHost: 'smtp.gmail.com',
  smtpPort: 587,
  smtpUser: '',
  emailFrom: '',
  sessionTimeoutMinutes: 30,
  backupPolicy: {},
  ruckusOneUrl: DEFAULT_RUCKUS_ONE_URL,
};

/** Outcome shape for the actions a page needs to report on. */
export interface ActionResult {
  success: boolean;
  error?: string;
}

const describe = (error: unknown): string => {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Unexpected error';
};

interface NetworkDataContextType {
  devices: NetworkDevice[];
  portsByDevice: Record<string, PortInfo[]>;
  vlans: VlanInfo[];
  accessPoints: AccessPoint[];
  clients: ClientSession[];
  topologyNodes: TopologyNode[];
  topologyLinks: TopologyLink[];
  alerts: IncidentAlert[];
  syslogs: SyslogEntry[];
  settings: SystemSettings;
  backups: ConfigBackup[];
  isBackingUp: boolean;

  /** True during the first load, so pages can show a skeleton instead of "0 devices". */
  isLoading: boolean;
  /** Set when the collector is unreachable; pages show this instead of empty tables. */
  connectionError: string | null;
  /** Collector health: interval, thresholds, and what the last poll cycle did. */
  telemetryStatus: TelemetryStatus | null;
  reload: () => Promise<void>;

  addDevice: (device: DeviceInput) => Promise<ActionResult>;
  updateDevice: (id: string, updates: Partial<DeviceInput>) => Promise<ActionResult>;
  deleteDevice: (id: string) => Promise<ActionResult>;
  provisionDeviceFromConfig: (
    device: DeviceInput,
    topology: { parentNodeId: string | null; linkType: TopologyLink['linkType'] }
  ) => Promise<ActionResult & { device?: NetworkDevice }>;
  pollDeviceNow: (id: string) => Promise<ActionResult>;

  createBackup: (
    deviceId: string,
    versionTag: string,
    triggerType: 'manual' | 'scheduled' | 'pre-change',
    notes?: string,
    configContent?: string
  ) => Promise<ActionResult & { backup?: ConfigBackup }>;
  deleteBackup: (backupId: string) => Promise<ActionResult>;
  restoreBackup: (backupId: string) => Promise<ActionResult & { message?: string }>;
  runGlobalBackup: (onProgress?: (percent: number, currentDevice: string) => void) => Promise<ActionResult>;

  togglePortState: (deviceId: string, portId: number) => Promise<ActionResult>;
  addVlan: (vlan: Omit<VlanInfo, 'activePorts' | 'trafficRateMbps'>) => Promise<ActionResult>;
  deleteVlan: (vlanId: number) => Promise<ActionResult>;
  rebootAccessPoint: (apId: string) => Promise<ActionResult>;

  updateTopologyNodePosition: (id: string, x: number, y: number) => void;
  addTopologyNode: (node: Omit<TopologyNode, 'id'>) => Promise<ActionResult>;
  deleteTopologyNode: (id: string) => Promise<ActionResult>;
  toggleSubtreeCollapse: (nodeId: string) => Promise<ActionResult>;
  connectTopologyLink: (
    source: string,
    target: string,
    linkType: TopologyLink['linkType']
  ) => Promise<boolean>;
  updateTopologyLinkType: (linkId: string, linkType: TopologyLink['linkType']) => Promise<ActionResult>;
  deleteTopologyLink: (linkId: string) => Promise<ActionResult>;
  saveTopologyLayout: () => Promise<ActionResult>;

  acknowledgeAlert: (alertId: string, noteText: string) => Promise<ActionResult>;
  resolveAlert: (alertId: string) => Promise<ActionResult>;
  updateSettings: (newSettings: Partial<SystemSettings>) => Promise<ActionResult>;

  refreshTelemetry: () => Promise<void>;
  isTelemetrySyncing: boolean;
  lastSyncAt: string;
  lastCycle: PollCycleSummary | null;
}

const NetworkDataContext = createContext<NetworkDataContextType | undefined>(undefined);

export const NetworkDataProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { currentUser, isRestoringSession } = useAuth();

  const [devices, setDevices] = useState<NetworkDevice[]>([]);
  const [portsByDevice, setPortsByDevice] = useState<Record<string, PortInfo[]>>({});
  const [vlans, setVlans] = useState<VlanInfo[]>([]);
  const [accessPoints, setAccessPoints] = useState<AccessPoint[]>([]);
  const [clients, setClients] = useState<ClientSession[]>([]);
  const [topologyNodes, setTopologyNodes] = useState<TopologyNode[]>([]);
  const [topologyLinks, setTopologyLinks] = useState<TopologyLink[]>([]);
  const [alerts, setAlerts] = useState<IncidentAlert[]>([]);
  const [syslogs, setSyslogs] = useState<SyslogEntry[]>([]);
  const [backups, setBackups] = useState<ConfigBackup[]>([]);
  const [settings, setSettings] = useState<SystemSettings>(EMPTY_SETTINGS);

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [isBackingUp, setIsBackingUp] = useState<boolean>(false);
  const [isTelemetrySyncing, setIsTelemetrySyncing] = useState<boolean>(false);
  const [lastSyncAt, setLastSyncAt] = useState<string>(nowTimestamp());
  const [lastCycle, setLastCycle] = useState<PollCycleSummary | null>(null);
  const [telemetryStatus, setTelemetryStatus] = useState<TelemetryStatus | null>(null);

  const isAuthenticated = Boolean(currentUser);
  const isOperator = currentUser?.role === 'Admin' || currentUser?.role === 'Engineer';

  // ---------------------------------------------------------------- loading

  const applyBootstrap = useCallback((snapshot: Awaited<ReturnType<typeof api.bootstrap>>): void => {
    setDevices(snapshot.devices);
    setPortsByDevice(snapshot.portsByDevice);
    setVlans(snapshot.vlans);
    setAccessPoints(snapshot.accessPoints);
    setClients(snapshot.clients);
    setTopologyNodes(snapshot.topologyNodes);
    setTopologyLinks(snapshot.topologyLinks);
    setAlerts(snapshot.alerts);
    setSyslogs(snapshot.syslogs);
    setBackups(snapshot.backups);
    setSettings(snapshot.settings);
    setLastSyncAt(snapshot.serverTime);
  }, []);

  const reload = useCallback(async (): Promise<void> => {
    if (!getAuthToken()) return;
    try {
      applyBootstrap(await api.bootstrap());
      setConnectionError(null);
    } catch (error) {
      // A 401 is handled by AuthContext, which drops to the Login screen
      if (!(error instanceof ApiError && error.isAuthFailure)) {
        setConnectionError(describe(error));
      }
    } finally {
      setIsLoading(false);
    }
  }, [applyBootstrap]);

  /** Refetch only what an event touched, instead of the whole snapshot. */
  const refetchDevices = useCallback(async (): Promise<void> => {
    try {
      const [nextDevices, topology] = await Promise.all([api.devices.list(), api.topology.get()]);
      setDevices(nextDevices);
      setTopologyNodes(topology.nodes);
      setTopologyLinks(topology.links);
      if (isOperator) {
        const [nextPorts, nextVlans] = await Promise.all([api.ports.all(), api.vlans.list()]);
        setPortsByDevice(nextPorts);
        setVlans(nextVlans);
      }
      setConnectionError(null);
    } catch (error) {
      if (!(error instanceof ApiError && error.isAuthFailure)) setConnectionError(describe(error));
    }
  }, [isOperator]);

  const refetchAlerts = useCallback(async (): Promise<void> => {
    if (!isOperator) return;
    try {
      const [nextAlerts, nextLogs] = await Promise.all([api.alerts.list(), api.syslogs.list({ limit: 500 })]);
      setAlerts(nextAlerts);
      setSyslogs(nextLogs);
    } catch {
      // A failed background refetch is not worth a banner; the next one will try again
    }
  }, [isOperator]);

  const refetchStatus = useCallback(async (): Promise<void> => {
    try {
      const status = await api.telemetry.status();
      setTelemetryStatus(status);
      setLastCycle(status.lastCycle);
      if (status.lastCycle) setLastSyncAt(status.lastCycle.finishedAt);
    } catch {
      // status is advisory only
    }
  }, []);

  // First load, once the session has been restored and we know who is signed in
  useEffect(() => {
    if (isRestoringSession) return;
    if (!isAuthenticated) {
      setIsLoading(false);
      setConnectionError(null);
      return;
    }
    setIsLoading(true);
    void reload().then(() => refetchStatus());
  }, [isAuthenticated, isRestoringSession, reload, refetchStatus]);

  // ---------------------------------------------------------------- live updates

  /** Server-sent events: the UI reacts the moment a poll cycle or an alert lands. */
  useEffect(() => {
    if (!isAuthenticated) return;
    const token = getAuthToken();
    if (!token) return;

    const unsubscribe = subscribeToEvents(
      token,
      event => {
        switch (event.type) {
          case 'telemetry':
            void refetchDevices();
            void refetchAlerts();
            void refetchStatus();
            setLastSyncAt(event.at);
            break;
          case 'alert':
          case 'syslog':
            void refetchAlerts();
            break;
          case 'device':
            void refetchDevices();
            break;
          case 'settings':
            void api.settings.get().then(setSettings).catch(() => undefined);
            break;
          default:
            break;
        }
      },
      () => {
        // EventSource reconnects on its own; the interval below covers the gap
      }
    );

    return unsubscribe;
  }, [isAuthenticated, refetchDevices, refetchAlerts, refetchStatus]);

  /**
   * Fallback refresh.
   *
   * The event stream is the primary path; this interval covers a dropped stream or a
   * proxy that buffers SSE. It only reads, so a duplicate refresh is harmless.
   */
  useEffect(() => {
    if (!isAuthenticated) return;
    const seconds = Math.max(20, settings.snmpInterval || 300);
    const timer = setInterval(() => {
      void refetchDevices();
      void refetchAlerts();
      void refetchStatus();
    }, seconds * 1000);
    return () => clearInterval(timer);
  }, [isAuthenticated, settings.snmpInterval, refetchDevices, refetchAlerts, refetchStatus]);

  // ---------------------------------------------------------------- devices

  const addDevice = async (device: DeviceInput): Promise<ActionResult> => {
    try {
      const created = await api.devices.create(device);
      setDevices(prev => [created, ...prev]);
      await refetchDevices();
      return { success: true };
    } catch (error) {
      return { success: false, error: describe(error) };
    }
  };

  const updateDevice = async (id: string, updates: Partial<DeviceInput>): Promise<ActionResult> => {
    try {
      const updated = await api.devices.update(id, updates);
      setDevices(prev => prev.map(d => (d.id === id ? updated : d)));
      return { success: true };
    } catch (error) {
      return { success: false, error: describe(error) };
    }
  };

  const deleteDevice = async (id: string): Promise<ActionResult> => {
    try {
      await api.devices.remove(id);
      setDevices(prev => prev.filter(d => d.id !== id));
      setPortsByDevice(prev => {
        const { [id]: _removed, ...rest } = prev;
        return rest;
      });
      await refetchDevices();
      return { success: true };
    } catch (error) {
      return { success: false, error: describe(error) };
    }
  };

  /**
   * Register a device and place it on the topology map.
   *
   * The server does the whole job in one request: inventory row, topology node, link
   * to the chosen parent, a baseline backup of the config and a syslog entry.
   */
  const provisionDeviceFromConfig = async (
    device: DeviceInput,
    topology: { parentNodeId: string | null; linkType: TopologyLink['linkType'] }
  ): Promise<ActionResult & { device?: NetworkDevice }> => {
    try {
      const created = await api.devices.create({ ...device, topology: topology as TopologyPlacement });
      await reload();
      return { success: true, device: created };
    } catch (error) {
      return { success: false, error: describe(error) };
    }
  };

  const pollDeviceNow = async (id: string): Promise<ActionResult> => {
    try {
      const { device } = await api.devices.poll(id);
      if (device) setDevices(prev => prev.map(d => (d.id === id ? device : d)));
      await refetchDevices();
      return { success: true };
    } catch (error) {
      return { success: false, error: describe(error) };
    }
  };

  // ---------------------------------------------------------------- backups

  const createBackup = async (
    deviceId: string,
    versionTag: string,
    triggerType: 'manual' | 'scheduled' | 'pre-change',
    notes?: string,
    configContent?: string
  ): Promise<ActionResult & { backup?: ConfigBackup }> => {
    try {
      const backup = await api.backups.create({ deviceId, versionTag, triggerType, notes, configContent });
      setBackups(prev => [backup, ...prev]);
      void refetchAlerts();
      return { success: true, backup };
    } catch (error) {
      return { success: false, error: describe(error) };
    }
  };

  const deleteBackup = async (backupId: string): Promise<ActionResult> => {
    try {
      await api.backups.remove(backupId);
      setBackups(prev => prev.filter(b => b.id !== backupId));
      return { success: true };
    } catch (error) {
      return { success: false, error: describe(error) };
    }
  };

  const restoreBackup = async (backupId: string): Promise<ActionResult & { message?: string }> => {
    try {
      const result = await api.backups.restore(backupId);
      await refetchDevices();
      void refetchAlerts();
      return { success: true, message: result.message };
    } catch (error) {
      return { success: false, error: describe(error) };
    }
  };

  /**
   * Archive every device that has a stored config.
   *
   * Runs one request per device so the progress bar reflects real work. Devices with
   * nothing stored are skipped rather than archiving an empty file.
   */
  const runGlobalBackup = async (
    onProgress?: (percent: number, currentDevice: string) => void
  ): Promise<ActionResult> => {
    setIsBackingUp(true);
    const stamp = nowTimestamp();
    const versionTag = `vAuto-${stamp.slice(0, 10).replace(/-/g, '')}-${stamp.slice(11, 16).replace(':', '')}`;
    const created: ConfigBackup[] = [];
    const skipped: string[] = [];

    try {
      for (let i = 0; i < devices.length; i += 1) {
        const device = devices[i];
        onProgress?.(Math.round(((i + 1) / devices.length) * 100), device.name);
        try {
          created.push(
            await api.backups.create({
              deviceId: device.id,
              versionTag,
              triggerType: 'scheduled',
              notes: 'Global backup run',
            })
          );
        } catch (error) {
          // NO_CONFIG just means nothing has been archived for that device yet
          if (error instanceof ApiError && error.code === 'NO_CONFIG') skipped.push(device.name);
          else throw error;
        }
      }

      if (created.length > 0) setBackups(prev => [...created, ...prev]);
      await api.settings.update({ lastGlobalBackup: stamp }).then(setSettings).catch(() => undefined);
      void refetchAlerts();

      return {
        success: true,
        ...(skipped.length > 0
          ? {
              error:
                `Archived ${created.length} device(s). Skipped with no stored config: ${skipped.join(', ')}.`,
            }
          : {}),
      };
    } catch (error) {
      return { success: false, error: describe(error) };
    } finally {
      setIsBackingUp(false);
    }
  };

  // ---------------------------------------------------------------- ports and VLANs

  /**
   * Shut / no-shut a port, for real, over SNMP.
   *
   * Fails with a readable message when the device has no write credential, instead of
   * flipping the colour in the browser and letting the port stay up.
   */
  const togglePortState = async (deviceId: string, portId: number): Promise<ActionResult> => {
    const port = portsByDevice[deviceId]?.find(p => p.id === portId);
    if (!port) return { success: false, error: 'Port not found' };

    try {
      const updated = await api.ports.setAdmin(deviceId, portId, !port.adminUp);
      setPortsByDevice(prev => ({
        ...prev,
        [deviceId]: (prev[deviceId] ?? []).map(p => (p.id === portId ? updated : p)),
      }));
      void refetchAlerts();
      return { success: true };
    } catch (error) {
      return { success: false, error: describe(error) };
    }
  };

  const addVlan = async (vlan: Omit<VlanInfo, 'activePorts' | 'trafficRateMbps'>): Promise<ActionResult> => {
    try {
      const created = await api.vlans.create({
        id: vlan.id,
        name: vlan.name,
        subnet: vlan.subnet,
        gateway: vlan.gateway,
        dhcpTotal: vlan.dhcpTotal,
        dhcpUsed: vlan.dhcpUsed,
        description: vlan.description,
      });
      setVlans(prev => [...prev, created].sort((a, b) => a.id - b.id));
      return { success: true };
    } catch (error) {
      return { success: false, error: describe(error) };
    }
  };

  const deleteVlan = async (vlanId: number): Promise<ActionResult> => {
    try {
      await api.vlans.remove(vlanId);
      setVlans(prev => prev.filter(v => v.id !== vlanId));
      return { success: true };
    } catch (error) {
      return { success: false, error: describe(error) };
    }
  };

  const rebootAccessPoint = async (apId: string): Promise<ActionResult> => {
    try {
      await api.wireless.reboot(apId);
      setAccessPoints(await api.wireless.accessPoints());
      return { success: true };
    } catch (error) {
      return { success: false, error: describe(error) };
    }
  };

  // ---------------------------------------------------------------- topology

  /**
   * Move a node on the canvas.
   *
   * Local-only and synchronous, because this fires on every mouse move while dragging.
   * `saveTopologyLayout()` is what writes the positions to the server.
   */
  const updateTopologyNodePosition = (id: string, x: number, y: number): void => {
    setTopologyNodes(prev => prev.map(n => (n.id === id ? { ...n, x, y } : n)));
  };

  const addTopologyNode = async (node: Omit<TopologyNode, 'id'>): Promise<ActionResult> => {
    try {
      const created = await api.topology.addNode(node);
      setTopologyNodes(prev => [...prev, created]);
      return { success: true };
    } catch (error) {
      return { success: false, error: describe(error) };
    }
  };

  const deleteTopologyNode = async (id: string): Promise<ActionResult> => {
    try {
      await api.topology.removeNode(id);
      setTopologyNodes(prev => prev.filter(n => n.id !== id));
      setTopologyLinks(prev => prev.filter(l => l.source !== id && l.target !== id));
      return { success: true };
    } catch (error) {
      return { success: false, error: describe(error) };
    }
  };

  const toggleSubtreeCollapse = async (nodeId: string): Promise<ActionResult> => {
    const node = topologyNodes.find(n => n.id === nodeId);
    if (!node) return { success: false, error: 'Node not found' };
    const isCollapsed = !node.isCollapsed;
    // Collapsing is a view preference, so flip it immediately and persist in the background
    setTopologyNodes(prev => prev.map(n => (n.id === nodeId ? { ...n, isCollapsed } : n)));
    try {
      await api.topology.updateNode(nodeId, { isCollapsed });
      return { success: true };
    } catch (error) {
      setTopologyNodes(prev => prev.map(n => (n.id === nodeId ? { ...n, isCollapsed: !isCollapsed } : n)));
      return { success: false, error: describe(error) };
    }
  };

  /** Returns false when the nodes are the same or already linked. */
  const connectTopologyLink = async (
    source: string,
    target: string,
    linkType: TopologyLink['linkType']
  ): Promise<boolean> => {
    try {
      const link = await api.topology.addLink(source, target, linkType);
      setTopologyLinks(prev => [...prev, link]);
      return true;
    } catch {
      return false;
    }
  };

  const updateTopologyLinkType = async (
    linkId: string,
    linkType: TopologyLink['linkType']
  ): Promise<ActionResult> => {
    try {
      const updated = await api.topology.updateLink(linkId, linkType);
      setTopologyLinks(prev => prev.map(l => (l.id === linkId ? updated : l)));
      return { success: true };
    } catch (error) {
      return { success: false, error: describe(error) };
    }
  };

  const deleteTopologyLink = async (linkId: string): Promise<ActionResult> => {
    try {
      await api.topology.removeLink(linkId);
      setTopologyLinks(prev => prev.filter(l => l.id !== linkId));
      return { success: true };
    } catch (error) {
      return { success: false, error: describe(error) };
    }
  };

  const saveTopologyLayout = async (): Promise<ActionResult> => {
    try {
      const { nodes } = await api.topology.saveLayout(
        topologyNodes.map(n => ({ id: n.id, x: n.x, y: n.y, isCollapsed: n.isCollapsed }))
      );
      setTopologyNodes(nodes);
      return { success: true };
    } catch (error) {
      return { success: false, error: describe(error) };
    }
  };

  // ---------------------------------------------------------------- alerts and settings

  const acknowledgeAlert = async (alertId: string, noteText: string): Promise<ActionResult> => {
    const note = noteText.trim();
    if (!note) return { success: false, error: 'An acknowledgement note is required' };
    try {
      const updated = await api.alerts.acknowledge(alertId, note);
      setAlerts(prev => prev.map(a => (a.id === alertId ? updated : a)));
      void refetchAlerts();
      return { success: true };
    } catch (error) {
      return { success: false, error: describe(error) };
    }
  };

  const resolveAlert = async (alertId: string): Promise<ActionResult> => {
    try {
      const updated = await api.alerts.resolve(alertId);
      setAlerts(prev => prev.map(a => (a.id === alertId ? updated : a)));
      void refetchAlerts();
      return { success: true };
    } catch (error) {
      return { success: false, error: describe(error) };
    }
  };

  const updateSettings = async (newSettings: Partial<SystemSettings>): Promise<ActionResult> => {
    // backupPolicy is derived server-side from the last global backup run
    const { backupPolicy: _ignored, ...payload } = newSettings;
    try {
      const saved = await api.settings.update(payload);
      setSettings(saved);
      void refetchStatus();
      return { success: true };
    } catch (error) {
      return { success: false, error: describe(error) };
    }
  };

  // ---------------------------------------------------------------- manual refresh

  const syncingRef = useRef(false);

  /** What the Refresh button calls: poll every device now, then reload what changed. */
  const refreshTelemetry = async (): Promise<void> => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    setIsTelemetrySyncing(true);
    try {
      const summary = await api.telemetry.refresh();
      setLastCycle(summary);
      setLastSyncAt(summary.finishedAt);
      await refetchDevices();
      await refetchAlerts();
      await refetchStatus();
      setConnectionError(null);
    } catch (error) {
      if (!(error instanceof ApiError && error.isAuthFailure)) setConnectionError(describe(error));
    } finally {
      syncingRef.current = false;
      setIsTelemetrySyncing(false);
    }
  };

  return (
    <NetworkDataContext.Provider
      value={{
        devices,
        portsByDevice,
        vlans,
        accessPoints,
        clients,
        topologyNodes,
        topologyLinks,
        alerts,
        syslogs,
        settings,
        backups,
        isBackingUp,
        isLoading,
        connectionError,
        telemetryStatus,
        reload,
        addDevice,
        updateDevice,
        deleteDevice,
        provisionDeviceFromConfig,
        pollDeviceNow,
        createBackup,
        deleteBackup,
        restoreBackup,
        runGlobalBackup,
        togglePortState,
        addVlan,
        deleteVlan,
        rebootAccessPoint,
        updateTopologyNodePosition,
        addTopologyNode,
        deleteTopologyNode,
        toggleSubtreeCollapse,
        connectTopologyLink,
        updateTopologyLinkType,
        deleteTopologyLink,
        saveTopologyLayout,
        acknowledgeAlert,
        resolveAlert,
        updateSettings,
        refreshTelemetry,
        isTelemetrySyncing,
        lastSyncAt,
        lastCycle,
      }}
    >
      {children}
    </NetworkDataContext.Provider>
  );
};

export const useNetworkData = (): NetworkDataContextType => {
  const context = useContext(NetworkDataContext);
  if (!context) {
    throw new Error('useNetworkData must be used within a NetworkDataProvider');
  }
  return context;
};

export type { Role };
