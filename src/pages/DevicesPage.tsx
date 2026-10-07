import React, { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useLanguage } from '../context/LanguageContext';
import { useNetworkData } from '../context/NetworkDataContext';
import { useAuth } from '../context/AuthContext';
import { ConfigImportModal } from '../components/devices/ConfigImportModal';
import {
  Server,
  Search,
  Filter,
  FileCode2,
  Network,
  Trash2,
  Edit,
  CheckCircle2,
  AlertTriangle,
  X,
  HardDrive,
  Terminal,
  RefreshCw,
  Radio,
  XCircle,
  PauseCircle,
  PlayCircle,
} from 'lucide-react';
import { NetworkDevice, SnmpProbeResult } from '../types';
import { api } from '../services/api';
import {
  EMPTY_SNMP_FORM,
  SnmpFields,
  SnmpTestPanel,
  toSnmpPayload,
  type SnmpFormValues,
} from '../components/devices/snmp-fields';

export const DevicesPage: React.FC = () => {
  const { t } = useLanguage();
  const {
    devices,
    portsByDevice,
    updateDevice,
    deleteDevice,
    createBackup,
    pollDeviceNow,
    isLoading,
    connectionError,
  } = useNetworkData();

  // Switches with port data show the live count from the Ports page; others keep their inventory figures
  const portCounts = (device: NetworkDevice) => {
    const ports = portsByDevice[device.id];
    if (!ports?.length) return { up: device.portsUp, total: device.portsTotal };
    return { up: ports.filter(p => p.adminUp && (p.status === 'up' || p.status === 'warning')).length, total: ports.length };
  };
  const { isAdmin, isEngineer, isViewer } = useAuth();
  const navigate = useNavigate();

  const [search, setSearch] = useState('');
  const [selectedType, setSelectedType] = useState<string>('all');
  // ?status=online|warning|offline (from the Dashboard status cards) presets the status filter
  const [searchParams] = useSearchParams();
  const requestedStatus = searchParams.get('status');
  const [selectedStatus, setSelectedStatus] = useState<string>(
    requestedStatus === 'online' || requestedStatus === 'warning' || requestedStatus === 'offline' ? requestedStatus : 'all'
  );
  const [selectedLocation, setSelectedLocation] = useState<string>('all');

  const locations = Array.from(new Set(devices.map(d => d.location))).sort();

  // Modal States
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [quickBackupMessage, setQuickBackupMessage] = useState<string | null>(null);
  const [editingLocation, setEditingLocation] = useState<{ device: NetworkDevice; location: string; rack: string } | null>(null);
  // The SNMP half of the device dialog, kept separate so it can be reused as-is
  const [editSnmp, setEditSnmp] = useState<SnmpFormValues>(EMPTY_SNMP_FORM);
  const [editProbe, setEditProbe] = useState<SnmpProbeResult | null>(null);
  const [isTestingEdit, setIsTestingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  // Device ids currently being polled, so each row can show its own spinner
  const [pollingIds, setPollingIds] = useState<Set<string>>(new Set());

  const filteredDevices = devices.filter(d => {
    const q = search.toLowerCase();
    const matchesSearch =
      d.name.toLowerCase().includes(q) ||
      d.ip.includes(search) ||
      d.model.toLowerCase().includes(q) ||
      d.vendor.toLowerCase().includes(q) ||
      d.location.toLowerCase().includes(q) ||
      d.rack.toLowerCase().includes(q);
    const matchesType = selectedType === 'all' || d.type === selectedType;
    const matchesStatus = selectedStatus === 'all' || d.status === selectedStatus;
    const matchesLocation = selectedLocation === 'all' || d.location === selectedLocation;
    return matchesSearch && matchesType && matchesStatus && matchesLocation;
  });

  const formatMbps = (mbps?: number) =>
    mbps === undefined ? '—' : mbps >= 1000 ? `${(mbps / 1000).toFixed(2)} Gbps` : `${mbps} Mbps`;

  const handleQuickBackup = async (device: NetworkDevice) => {
    const tag = `Manual Quick-Snapshot (${new Date().toLocaleTimeString('en-US', { hour12: false })})`;
    const res = await createBackup(device.id, tag, 'manual', 'Quick snapshot taken from the device inventory row');
    // A device with no stored config cannot be archived; say so instead of claiming success
    setQuickBackupMessage(
      res.success ? `${t('snapshotArchivedFor')} ${device.name} [${device.ip}]` : res.error ?? t('backupFailed')
    );
    setTimeout(() => setQuickBackupMessage(null), 4000);
  };

  /**
   * Open the device dialog.
   *
   * Secrets are never sent to the browser, so the key fields start blank: leaving them
   * blank keeps whatever the server already has, and typing a value replaces it.
   */
  const openDeviceDialog = (device: NetworkDevice) => {
    setEditingLocation({ device, location: device.location, rack: device.rack });
    setEditSnmp({
      ...EMPTY_SNMP_FORM,
      snmpVersion: device.snmpVersion ?? '2c',
      snmpPort: String(device.snmpPort ?? 161),
      snmpCommunity: '',
      snmpWriteCommunity: '',
      snmpV3User: device.snmpV3User ?? '',
      snmpV3SecurityLevel: device.snmpV3SecurityLevel ?? 'authPriv',
      snmpV3AuthProtocol: device.snmpV3AuthProtocol ?? 'sha',
      snmpV3PrivProtocol: device.snmpV3PrivProtocol ?? 'aes',
    });
    setEditProbe(null);
    setEditError(null);
  };

  /** Probe with whatever is in the dialog right now, before committing it. */
  const handleTestEditSnmp = async () => {
    if (!editingLocation) return;
    setIsTestingEdit(true);
    setEditProbe(null);
    try {
      const payload = toSnmpPayload(editSnmp);
      // Blank fields mean "keep the stored secret", which the probe endpoint cannot
      // read, so a test needs the value typed in.
      setEditProbe(await api.devices.testSnmp({ ip: editingLocation.device.ip, ...payload }));
    } catch (error) {
      setEditProbe({
        reachable: false,
        error: error instanceof Error ? error.message : 'SNMP test failed',
        responseMs: 0,
      });
    } finally {
      setIsTestingEdit(false);
    }
  };

  const handleSaveLocation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingLocation) return;
    setEditError(null);
    setIsSavingEdit(true);

    const payload = toSnmpPayload(editSnmp);
    // Drop the blank secrets so the stored ones survive an edit that only moved a rack
    const snmpUpdates: Record<string, unknown> = { snmpVersion: payload.snmpVersion, snmpPort: payload.snmpPort };
    if (editSnmp.snmpVersion === '2c') {
      if (editSnmp.snmpCommunity.trim()) snmpUpdates.snmpCommunity = editSnmp.snmpCommunity.trim();
      if (editSnmp.snmpWriteCommunity.trim()) snmpUpdates.snmpWriteCommunity = editSnmp.snmpWriteCommunity.trim();
    } else {
      snmpUpdates.snmpV3User = editSnmp.snmpV3User.trim();
      snmpUpdates.snmpV3SecurityLevel = editSnmp.snmpV3SecurityLevel;
      snmpUpdates.snmpV3AuthProtocol = editSnmp.snmpV3AuthProtocol;
      snmpUpdates.snmpV3PrivProtocol = editSnmp.snmpV3PrivProtocol;
      if (editSnmp.snmpV3AuthKey) snmpUpdates.snmpV3AuthKey = editSnmp.snmpV3AuthKey;
      if (editSnmp.snmpV3PrivKey) snmpUpdates.snmpV3PrivKey = editSnmp.snmpV3PrivKey;
    }

    const res = await updateDevice(editingLocation.device.id, {
      location: editingLocation.location.trim(),
      rack: editingLocation.rack.trim(),
      ...snmpUpdates,
    });

    setIsSavingEdit(false);
    if (!res.success) {
      setEditError(res.error ?? t('deviceSaveFailed'));
      return;
    }
    setEditingLocation(null);
  };

  /** Poll one device now, instead of waiting for the next cycle. */
  const handlePollNow = async (device: NetworkDevice) => {
    setPollingIds(prev => new Set(prev).add(device.id));
    const res = await pollDeviceNow(device.id);
    setPollingIds(prev => {
      const next = new Set(prev);
      next.delete(device.id);
      return next;
    });
    if (!res.success) {
      setQuickBackupMessage(res.error ?? t('pollFailed'));
      setTimeout(() => setQuickBackupMessage(null), 4000);
    }
  };

  const togglePolling = async (device: NetworkDevice) => {
    await updateDevice(device.id, { pollEnabled: !(device.pollEnabled ?? true) });
  };

  const getStatusBadge = (device: NetworkDevice) => {
    // Polling paused: the stored status is stale, so say that rather than imply it is live
    if (device.pollEnabled === false) {
      return (
        <span
          className="inline-flex items-center gap-1 text-[11px] font-mono font-semibold text-slate-500 dark:text-slate-400"
          title={t('pollingPausedHint')}
        >
          <PauseCircle className="w-3 h-3" />
          {t('paused')}
        </span>
      );
    }
    switch (device.status) {
      case 'online':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-mono font-semibold text-emerald-600 dark:text-emerald-400">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
            Online
          </span>
        );
      case 'warning':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-mono font-semibold text-amber-600 dark:text-amber-400">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
            Warning
          </span>
        );
      case 'offline':
      default:
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-mono font-semibold text-rose-600 dark:text-rose-400">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
            Offline
          </span>
        );
    }
  };

  return (
    <div className="space-y-6">
      {connectionError && (
        <div className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-800 text-rose-800 dark:text-rose-300 text-xs flex items-start gap-2">
          <XCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-500" />
          <div>
            <span className="font-semibold block">{t('collectorUnreachable')}</span>
            <span className="text-[11px] opacity-90">{connectionError}</span>
          </div>
        </div>
      )}
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-2.5">
            <Server className="w-6 h-6 text-cyan-500" />
            {t('devicesInventory')}
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Enterprise hardware nodes inventory (Routers, Core/Dist/Edge Switches, Firewalls & Server Clusters)
          </p>
        </div>

        {/* Action Buttons: Import Config & Add Device */}
        <div className="flex items-center gap-2">
          {!isViewer && (
            <button
              onClick={() => {
                setShowConfigModal(true);
              }}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-semibold border border-slate-200 dark:border-slate-700 shadow-xs transition-all"
            >
              <FileCode2 className="w-4 h-4 text-cyan-500" />
              <span>{t('configImportTitle')}</span>
            </button>
          )}

          {/* Shortcut to the config backup archive (Settings > Backups) */}
          {(isAdmin || isEngineer) && (
            <button
              onClick={() => navigate('/settings?tab=backups')}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white text-xs font-semibold shadow-xs transition-all"
            >
              <HardDrive className="w-4 h-4" />
              <span>{t('backupManagerTitle')}</span>
            </button>
          )}
        </div>
      </div>

      {/* Quick Backup Toast Banner */}
      {quickBackupMessage && (
        <div className="p-3.5 rounded-xl bg-emerald-950/80 border border-emerald-700 text-emerald-200 text-xs flex items-center justify-between shadow-lg animate-fadeIn">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span className="font-semibold">{quickBackupMessage}</span>
          </div>
          <span className="text-[11px] text-emerald-400">View in Settings &gt; Automated Backup Manager</span>
        </div>
      )}

      {/* Role notice for Viewer */}
      {isViewer && (
        <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 text-amber-800 dark:text-amber-300 text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 text-amber-500" />
          <span>{t('readOnlyNotice')}</span>
        </div>
      )}

      {/* Filters Bar */}
      <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col md:flex-row items-center justify-between gap-3 text-xs">
        <div className="relative w-full md:w-80">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Filter device name, IP, model, location..."
            className="w-full bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-lg pl-9 pr-3 py-1.5 text-xs text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-cyan-500"
          />
        </div>

        <div className="flex items-center gap-3 w-full md:w-auto">
          {/* Category Filter */}
          <div className="flex items-center gap-2 w-full md:w-auto">
            <span className="text-slate-500 text-[11px] whitespace-nowrap">{t('deviceTypeFilter')}:</span>
            <select
              value={selectedType}
              onChange={e => setSelectedType(e.target.value)}
              className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-800 dark:text-slate-200 focus:outline-none"
            >
              <option value="all">{t('allTypes')}</option>
              <option value="Router">Router</option>
              <option value="Core Switch">Core Switch</option>
              <option value="Distribution Switch">Distribution Switch</option>
              <option value="Edge Switch">Edge Switch</option>
              <option value="Firewall">Firewall</option>
              <option value="Server">Server</option>
            </select>
          </div>

          {/* Status Filter */}
          <div className="flex items-center gap-2 w-full md:w-auto">
            <span className="text-slate-500 text-[11px] whitespace-nowrap">{t('statusFilter')}:</span>
            <select
              value={selectedStatus}
              onChange={e => setSelectedStatus(e.target.value)}
              className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-800 dark:text-slate-200 focus:outline-none"
            >
              <option value="all">{t('allStatuses')}</option>
              <option value="online">Online</option>
              <option value="warning">Warning</option>
              <option value="offline">Offline</option>
            </select>
          </div>

          {/* Location Filter */}
          <div className="flex items-center gap-2 w-full md:w-auto">
            <span className="text-slate-500 text-[11px] whitespace-nowrap">{t('locationFilter')}:</span>
            <select
              value={selectedLocation}
              onChange={e => setSelectedLocation(e.target.value)}
              className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-800 dark:text-slate-200 focus:outline-none max-w-[200px]"
            >
              <option value="all">{t('allLocations')}</option>
              {locations.map(loc => (
                <option key={loc} value={loc}>
                  {loc}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Hardware Devices Table */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400 uppercase tracking-wider font-semibold">
              <tr>
                <th className="py-3 px-4">{t('deviceName')}</th>
                <th className="py-3 px-4">{t('ipAddress')}</th>
                <th className="py-3 px-4">{t('type')}</th>
                <th className="py-3 px-4">{t('modelVendor')}</th>
                <th className="py-3 px-4">{t('locationRack')}</th>
                <th className="py-3 px-4 text-center">{t('statusFilter')}</th>
                <th className="py-3 px-4 text-right">{t('uptime')}</th>
                {!isViewer && (
                  <>
                    <th className="py-3 px-4 text-right">{t('cpuRam')}</th>
                    <th className="py-3 px-4 text-right">{t('trafficInOut')}</th>
                    <th className="py-3 px-4 text-right">{t('portsUp')}</th>
                  </>
                )}
                <th className="py-3 px-4 text-center">{t('actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-sans">
              {filteredDevices.length === 0 ? (
                <tr>
                  <td colSpan={isViewer ? 8 : 11} className="py-8 text-center text-slate-400">
                    {t('devicesEmpty')}
                  </td>
                </tr>
              ) : (
                filteredDevices.map(device => (
                  <tr
                    key={device.id}
                    className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors group"
                  >
                    {/* Device Name */}
                    <td className="py-3 px-4">
                      <div className="font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                        {device.name}
                      </div>
                      <div className="text-[10px] text-slate-400 font-mono">{device.mac}</div>
                    </td>

                    {/* IP */}
                    <td className="py-3 px-4 font-mono text-cyan-600 dark:text-cyan-400 font-medium">
                      {device.ip}
                    </td>

                    {/* Category Type */}
                    <td className="py-3 px-4">
                      <span className="text-[11px] font-medium text-slate-700 dark:text-slate-300">
                        {device.type}
                      </span>
                    </td>

                    {/* Model & Vendor */}
                    <td className="py-3 px-4 text-slate-600 dark:text-slate-300">
                      <div>{device.model}</div>
                      <div className="text-[10px] text-slate-400">{device.vendor}</div>
                    </td>

                    {/* Location */}
                    <td className="py-3 px-4 text-slate-500 dark:text-slate-400">
                      <div>{device.location}</div>
                      <div className="text-[10px] font-mono text-slate-400">{device.rack}</div>
                    </td>

                    {/* Status */}
                    <td
                      className="py-3 px-4 text-center"
                      title={device.status === 'offline' && device.lastError ? device.lastError : undefined}
                    >
                      {getStatusBadge(device)}
                    </td>

                    {/* Uptime */}
                    <td className="py-3 px-4 text-right font-mono text-slate-600 dark:text-slate-400 tabular-nums">
                      {device.uptime}
                    </td>

                    {/* Device details (CPU/RAM, traffic, ports): Admin & Engineer only, per scope 2.3.6.2.3 Viewer sees status only */}
                    {!isViewer && (
                      <>
                    <td className="py-3 px-4 text-right font-mono tabular-nums">
                      <div className={device.cpu > 80 ? 'text-rose-500 font-bold' : 'text-slate-700 dark:text-slate-300'}>
                        CPU: {device.cpu}%
                      </div>
                      <div className="text-[10px] text-slate-400">RAM: {device.ram}%</div>
                    </td>

                    {/* Traffic In / Out */}
                    <td className="py-3 px-4 text-right font-mono tabular-nums whitespace-nowrap">
                      <div className="text-cyan-600 dark:text-cyan-400">↓ {formatMbps(device.trafficInMbps)}</div>
                      <div className="text-[10px] text-slate-400">↑ {formatMbps(device.trafficOutMbps)}</div>
                    </td>

                    {/* Ports UP / Total */}
                    <td className="py-3 px-4 text-right font-mono tabular-nums">
                      <span className="font-semibold text-emerald-600 dark:text-emerald-400">{portCounts(device).up}</span>
                      <span className="text-slate-400"> / {portCounts(device).total}</span>
                    </td>
                      </>
                    )}

                    {/* Actions */}
                    <td className="py-3 px-4 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        {/* Inspect Ports (Admin & Engineer) */}
                        {!isViewer && (
                          <button
                            onClick={() => navigate('/ports')}
                            title={t('inspectPorts')}
                            className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400 hover:text-cyan-500 transition-colors"
                          >
                            <Network className="w-3.5 h-3.5" />
                          </button>
                        )}

                        {/* SSH via PuTTY (Admin & Engineer): ssh:// link handled by tools/ssh-handler */}
                        {!isViewer &&
                          (device.status === 'offline' ? (
                            <span
                              title={t('sshOffline')}
                              className="p-1.5 rounded text-slate-300 dark:text-slate-600 cursor-not-allowed"
                            >
                              <Terminal className="w-3.5 h-3.5" />
                            </span>
                          ) : (
                            <a
                              href={`ssh://${device.ip}`}
                              title={`${t('sshConnect')} (${device.ip})`}
                              className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400 hover:text-emerald-500 transition-colors"
                            >
                              <Terminal className="w-3.5 h-3.5" />
                            </a>
                          ))}

                        {/* Poll this device now, instead of waiting for the next cycle */}
                        {(isAdmin || isEngineer) && (
                          <button
                            onClick={() => handlePollNow(device)}
                            disabled={pollingIds.has(device.id)}
                            title={t('pollNow')}
                            className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400 hover:text-cyan-500 transition-colors disabled:opacity-50"
                          >
                            <RefreshCw
                              className={`w-3.5 h-3.5 ${pollingIds.has(device.id) ? 'animate-spin text-cyan-500' : ''}`}
                            />
                          </button>
                        )}

                        {/* Pause polling without removing the device from the inventory */}
                        {(isAdmin || isEngineer) && (
                          <button
                            onClick={() => togglePolling(device)}
                            title={device.pollEnabled === false ? t('resumePolling') : t('pausePolling')}
                            className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400 hover:text-amber-500 transition-colors"
                          >
                            {device.pollEnabled === false ? (
                              <PlayCircle className="w-3.5 h-3.5 text-amber-500" />
                            ) : (
                              <PauseCircle className="w-3.5 h-3.5" />
                            )}
                          </button>
                        )}

                        {/* Edit device: location, rack and the SNMP settings (Admin & Engineer) */}
                        {(isAdmin || isEngineer) && (
                          <button
                            onClick={() => openDeviceDialog(device)}
                            title={t('editDeviceTitle')}
                            className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400 hover:text-amber-500 transition-colors"
                          >
                            <Edit className="w-3.5 h-3.5" />
                          </button>
                        )}

                        {/* Quick Backup Snapshot (Admin & Engineer) */}
                        {(isAdmin || isEngineer) && (
                          <button
                            onClick={() => handleQuickBackup(device)}
                            title={t('quickSnapshot')}
                            className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400 hover:text-emerald-500 transition-colors"
                          >
                            <HardDrive className="w-3.5 h-3.5" />
                          </button>
                        )}

                        {/* Delete Device (Admin ONLY) */}
                        {isAdmin && (
                          <button
                            onClick={() => {
                              if (confirm(`Are you sure you want to delete ${device.name}?`)) {
                                deleteDevice(device.id);
                              }
                            }}
                            title={t('deleteDevice')}
                            className="p-1.5 rounded hover:bg-rose-50 dark:hover:bg-rose-950/40 text-slate-400 hover:text-rose-500 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal: Edit Location / Rack (Admin & Engineer) */}
      {editingLocation && (
        <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-2xl w-full p-6 shadow-2xl max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-200 dark:border-slate-800">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <Edit className="w-5 h-5 text-amber-500" />
                  {t('editDeviceTitle')}
                </h3>
                <p className="text-[11px] font-mono text-slate-400 mt-0.5">
                  {editingLocation.device.name} [{editingLocation.device.ip}]
                </p>
              </div>
              <button
                onClick={() => setEditingLocation(null)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveLocation} className="space-y-3.5 text-xs">
              <div>
                <label className="block text-slate-600 dark:text-slate-400 mb-1 font-medium">{t('locationRack')}</label>
                <input
                  type="text"
                  required
                  autoFocus
                  value={editingLocation.location}
                  onChange={e => setEditingLocation({ ...editingLocation, location: e.target.value })}
                  placeholder="Building B - Floor 3"
                  className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2 text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-cyan-500"
                />
              </div>

              <div>
                <label className="block text-slate-600 dark:text-slate-400 mb-1 font-medium">{t('cfgRack')}</label>
                <input
                  type="text"
                  required
                  value={editingLocation.rack}
                  onChange={e => setEditingLocation({ ...editingLocation, rack: e.target.value })}
                  placeholder="Rack-B3 (Unit 10)"
                  className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2 text-slate-900 dark:text-white font-mono focus:outline-none focus:ring-1 focus:ring-cyan-500"
                />
              </div>

              {/* SNMP: the settings that decide whether this device can be polled at all */}
              <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-3">
                <h4 className="text-xs font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                  <Radio className="w-3.5 h-3.5 text-cyan-500" />
                  {t('cfgStepSnmp')}
                </h4>
                <p className="text-[11px] text-slate-400">{t('snmpKeepBlankHint')}</p>

                <SnmpFields value={editSnmp} onChange={setEditSnmp} />

                <SnmpTestPanel
                  isTesting={isTestingEdit}
                  result={editProbe}
                  onTest={handleTestEditSnmp}
                  canTest={
                    editSnmp.snmpVersion === '2c'
                      ? Boolean(editSnmp.snmpCommunity.trim())
                      : Boolean(editSnmp.snmpV3User.trim())
                  }
                />

                {/* Why the device is currently offline, straight from the last poll */}
                {editingLocation.device.lastError && (
                  <div className="p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 text-amber-800 dark:text-amber-300 text-[11px] flex items-start gap-2">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-500" />
                    <span className="leading-relaxed">
                      <span className="font-semibold block">{t('lastPollError')}</span>
                      {editingLocation.device.lastError}
                    </span>
                  </div>
                )}
              </div>

              {editError && (
                <div className="p-2.5 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-800 text-rose-800 dark:text-rose-300 text-[11px] flex items-start gap-2">
                  <XCircle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-rose-500" />
                  <span>{editError}</span>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setEditingLocation(null)}
                  className="px-4 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-300 font-semibold"
                >
                  {t('cancel')}
                </button>
                <button
                  type="submit"
                  disabled={isSavingEdit}
                  className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold"
                >
                  {isSavingEdit ? t('saving') : t('save')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Create a device from an imported config */}
      <ConfigImportModal isOpen={showConfigModal} onClose={() => setShowConfigModal(false)} />
    </div>
  );
};
