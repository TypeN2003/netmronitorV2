import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useLanguage } from '../context/LanguageContext';
import { useNetworkData } from '../context/NetworkDataContext';
import { useAuth } from '../context/AuthContext';
import {
  Network,
  Activity,
  Layers,
  Zap,
  ArrowUpDown,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  X,
  Power,
  Server,
} from 'lucide-react';
import { PortInfo } from '../types';

export const PortsPage: React.FC = () => {
  const { t } = useLanguage();
  const { devices, portsByDevice, togglePortState } = useNetworkData();
  // A shut/no-shut is a real SNMP write that the device can refuse
  const [portActionError, setPortActionError] = useState<string | null>(null);
  const [isTogglingPort, setIsTogglingPort] = useState(false);
  const { isAdmin, isEngineer, isViewer } = useAuth();

  const switchDevices = devices.filter(d => d.type.includes('Switch'));
  // ?device=<id> preselects a switch (e.g. when arriving from the Topology map)
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedDeviceId = searchParams.get('device');
  // Empty until the device list arrives from the collector; the effect below fills it in
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>(requestedDeviceId ?? '');
  const [selectedPort, setSelectedPort] = useState<PortInfo | null>(null);

  /**
   * Pick which switch to show.
   *
   * Devices load asynchronously, so on the first render `switchDevices` is still
   * empty and nothing can be selected yet. This has to re-run when the list
   * arrives, otherwise the port grid stays blank forever.
   */
  useEffect(() => {
    if (requestedDeviceId && switchDevices.some(d => d.id === requestedDeviceId)) {
      setSelectedDeviceId(requestedDeviceId);
      return;
    }
    // Fall back to the first switch whenever the current selection is not one
    if (switchDevices.length > 0 && !switchDevices.some(d => d.id === selectedDeviceId)) {
      setSelectedDeviceId(switchDevices[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedDeviceId, devices]);

  const handleSelectDevice = (id: string) => {
    setSelectedDeviceId(id);
    setSelectedPort(null);
    setSearchParams({ device: id }, { replace: true });
  };

  const currentPorts = portsByDevice[selectedDeviceId] || [];
  const currentDevice = devices.find(d => d.id === selectedDeviceId);

  // Group ports into Odd (top row: 1, 3, 5...) and Even (bottom row: 2, 4, 6...)
  const oddPorts = currentPorts.filter(p => p.id % 2 !== 0);
  const evenPorts = currentPorts.filter(p => p.id % 2 === 0);

  type PortState = 'up' | 'down' | 'warning' | 'error' | 'sfp';
  const getPortState = (port: PortInfo): PortState => {
    if (!port.adminUp || port.status === 'down') return 'down';
    if (port.status === 'error') return 'error';
    if (port.status === 'warning') return 'warning';
    if (port.portType === 'SFP+') return 'sfp';
    return 'up';
  };

  // Solid fills so link state reads at a glance; down ports are hollow with a dashed outline
  const portStyles: Record<PortState, { cell: string; notch: string }> = {
    up: {
      cell: 'bg-emerald-500 dark:bg-emerald-600 border-emerald-600 dark:border-emerald-500 text-white hover:bg-emerald-600 dark:hover:bg-emerald-500',
      notch: 'bg-emerald-800/40',
    },
    sfp: {
      cell: 'bg-purple-500 dark:bg-purple-600 border-purple-600 dark:border-purple-500 text-white hover:bg-purple-600 dark:hover:bg-purple-500',
      notch: 'bg-purple-900/40',
    },
    // Faulty port (bad cable, err-disabled): solid red so broken ports stand out from unused ones
    error: {
      cell: 'bg-rose-500 dark:bg-rose-600 border-rose-600 dark:border-rose-500 text-white hover:bg-rose-600 dark:hover:bg-rose-500',
      notch: 'bg-rose-900/40',
    },
    warning: {
      cell: 'bg-amber-400 dark:bg-amber-500 border-amber-500 dark:border-amber-400 text-amber-950 hover:bg-amber-500 dark:hover:bg-amber-400',
      notch: 'bg-amber-900/30',
    },
    down: {
      cell: 'bg-white dark:bg-slate-800/70 border-dashed border-slate-300 dark:border-slate-600 text-slate-400 dark:text-slate-500 hover:border-slate-400 dark:hover:border-slate-500',
      notch: 'bg-slate-200 dark:bg-slate-700',
    },
  };

  const portCounts = currentPorts.reduce(
    (acc, p) => ({ ...acc, [getPortState(p)]: acc[getPortState(p)] + 1 }),
    { up: 0, down: 0, warning: 0, error: 0, sfp: 0 } as Record<PortState, number>
  );

  const renderPort = (port: PortInfo, row: 'top' | 'bottom') => {
    const style = portStyles[getPortState(port)];
    const notch = (
      <div className={`w-5 h-2 ${style.notch} ${row === 'top' ? 'rounded-b-sm' : 'rounded-t-sm'}`}></div>
    );
    const label = <span className="text-xs font-mono font-bold leading-none">{port.id}</span>;
    const vlan = <span className="text-[10px] font-mono leading-none opacity-80">V{port.vlan}</span>;
    return (
      <button
        key={port.id}
        onClick={() => {
          setPortActionError(null);
          setSelectedPort(port);
        }}
        title={`Port ${port.name} · ${port.status.toUpperCase()} · VLAN ${port.vlan}`}
        className={`h-14 min-w-0 rounded-md border-2 flex flex-col items-center justify-between py-1 transition-colors ${style.cell} ${
          selectedPort?.id === port.id
            ? 'ring-2 ring-offset-2 ring-cyan-500 ring-offset-slate-50 dark:ring-offset-slate-950'
            : ''
        }`}
      >
        {row === 'top' ? (
          <>
            {label}
            {notch}
            {vlan}
          </>
        ) : (
          <>
            {vlan}
            {notch}
            {label}
          </>
        )}
      </button>
    );
  };

  const getPortIndicatorColor = (port: PortInfo) => {
    if (!port.adminUp || port.status === 'down') return 'bg-slate-400 dark:bg-slate-600';
    if (port.status === 'warning') return 'bg-amber-400 animate-pulse';
    if (port.portType === 'SFP+') return 'bg-purple-400 shadow-xs shadow-purple-500';
    return 'bg-emerald-400 shadow-xs shadow-emerald-500';
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-2.5">
            <Network className="w-6 h-6 text-cyan-500" />
            {t('switchPortMatrix')}
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Visual physical RJ45 & SFP+ switch faceplate matrix with live telemetry diagnostics
          </p>
        </div>

        {/* Switch Hardware Selector */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500 dark:text-slate-400 font-medium whitespace-nowrap">
            {t('selectSwitch')}
          </span>
          <select
            value={selectedDeviceId}
            onChange={e => handleSelectDevice(e.target.value)}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100 text-xs rounded-lg px-3 py-2 font-medium focus:outline-none focus:ring-1 focus:ring-cyan-500"
          >
            {switchDevices.map(sw => (
              <option key={sw.id} value={sw.id}>
                {sw.name} ({sw.ip} - {sw.model})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Switch Faceplate Container */}
      <div className="bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 shadow-sm dark:shadow-2xl relative overflow-hidden">
        {/* Chassis Branding Header */}
        <div className="flex items-center justify-between pb-4 mb-6 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-3 h-3 rounded-full bg-emerald-500 shadow-md shadow-emerald-500/50 animate-pulse"></div>
            <div>
              <div className="text-sm font-bold tracking-wider uppercase font-mono text-slate-900 dark:text-white flex items-center gap-2">
                <span>{currentDevice?.vendor}</span>
                <span className="text-cyan-600 dark:text-cyan-400">{currentDevice?.model}</span>
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                Hostname: {currentDevice?.name} · IP: {currentDevice?.ip} · Ports: {currentPorts.length}
              </div>
            </div>
          </div>

          {/* Faceplate Port Status Legend */}
          <div className="flex flex-wrap items-center justify-end gap-2 text-xs">
            {(
              [
                ['up', t('portUp'), 'bg-emerald-500 border-emerald-600'],
                ['error', t('portError'), 'bg-rose-500 border-rose-600'],
                ['down', t('portDown'), 'bg-white dark:bg-slate-800 border-dashed border-slate-400 dark:border-slate-500'],
                ['warning', t('portWarning'), 'bg-amber-400 border-amber-500'],
                ['sfp', '10G SFP+', 'bg-purple-500 border-purple-600'],
              ] as [PortState, string, string][]
            ).map(([state, label, swatch]) => (
              <div
                key={state}
                className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700"
              >
                <span className={`w-3.5 h-3.5 rounded border-2 ${swatch}`}></span>
                <span className="font-medium text-slate-700 dark:text-slate-200">{label}</span>
                <span className="font-mono font-bold text-slate-900 dark:text-white">{portCounts[state]}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Physical Port Faceplate Matrix Grid (Dual Row) */}
        {currentPorts.length === 0 ? (
          <div className="py-12 text-center text-slate-500 dark:text-slate-400 font-mono text-xs">
            No interface port matrix provisioned for this device. Please select a Cisco or Aruba Switch.
          </div>
        ) : (
          <div className="overflow-x-auto pb-2">
            {/* Columns stretch to fill the width; below ~2.5rem per port the panel scrolls instead */}
            <div
              className="bg-slate-100 dark:bg-slate-950 p-3 rounded-xl border border-slate-200 dark:border-slate-800 space-y-2"
              style={{ minWidth: `${Math.max(oddPorts.length, evenPorts.length) * 2.5}rem` }}
            >
              {/* Top Row: Odd Ports (1, 3, 5...) */}
              <div
                className="grid gap-1.5"
                style={{ gridTemplateColumns: `repeat(${Math.max(oddPorts.length, 1)}, minmax(0, 1fr))` }}
              >
                {oddPorts.map(port => renderPort(port, 'top'))}
              </div>

              {/* Bottom Row: Even Ports (2, 4, 6...) */}
              <div
                className="grid gap-1.5"
                style={{ gridTemplateColumns: `repeat(${Math.max(evenPorts.length, 1)}, minmax(0, 1fr))` }}
              >
                {evenPorts.map(port => renderPort(port, 'bottom'))}
              </div>
            </div>
          </div>
        )}

        <div className="mt-2 text-right text-[11px] text-slate-500 dark:text-slate-400 font-mono">
          Click any port icon to inspect real-time interface telemetry, VLAN tag, duplex, and connected MAC.
        </div>
      </div>

      {/* Port Detail Modal */}
      {selectedPort && (
        <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl">
            {/* Modal Title */}
            <div className="flex items-center justify-between pb-3 mb-4 border-b border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <div
                  className={`w-3 h-3 rounded-full ${getPortIndicatorColor(selectedPort)}`}
                ></div>
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white font-mono">
                    Port {selectedPort.name}
                  </h3>
                  <span className="text-xs text-slate-400">
                    Switch: {currentDevice?.name} ({currentDevice?.ip})
                  </span>
                </div>
              </div>
              <button
                onClick={() => setSelectedPort(null)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Diagnostic Fields Grid */}
            <div className="space-y-3 text-xs">
              {selectedPort.status === 'error' && selectedPort.fault && (
                <div className="p-2.5 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-300 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <div>
                    <div className="font-semibold">{t('portError')}</div>
                    <div className="text-[11px] mt-0.5">
                      {t(selectedPort.fault === 'crc' ? 'portFaultCrc' : 'portFaultErrdisable')}
                    </div>
                  </div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/50">
                  <span className="text-slate-500 dark:text-slate-400 block text-[11px] mb-0.5">
                    {t('operationalStatus')}
                  </span>
                  <span
                    className={`font-semibold font-mono ${
                      selectedPort.status === 'up'
                        ? 'text-emerald-500'
                        : selectedPort.status === 'error'
                        ? 'text-rose-500'
                        : selectedPort.status === 'warning'
                        ? 'text-amber-500'
                        : 'text-slate-400'
                    }`}
                  >
                    {selectedPort.status.toUpperCase()} ({selectedPort.adminUp ? 'Admin Up' : 'Admin Down'})
                  </span>
                </div>

                <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/50">
                  <span className="text-slate-500 dark:text-slate-400 block text-[11px] mb-0.5">
                    {t('negotiatedSpeed')}
                  </span>
                  <span className="font-semibold font-mono text-cyan-600 dark:text-cyan-400">
                    {selectedPort.speed} ({selectedPort.duplex})
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/50">
                  <span className="text-slate-500 dark:text-slate-400 block text-[11px] mb-0.5">
                    {t('vlanAssigned')}
                  </span>
                  <span className="font-semibold font-mono text-slate-800 dark:text-slate-200">
                    VLAN {selectedPort.vlan} ({selectedPort.vlanName})
                  </span>
                </div>

                <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/50">
                  <span className="text-slate-500 dark:text-slate-400 block text-[11px] mb-0.5">
                    {t('poeDraw')}
                  </span>
                  <span className="font-semibold font-mono text-amber-500">
                    {selectedPort.poeWatts} Watts
                  </span>
                </div>
              </div>

              <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/50">
                <span className="text-slate-500 dark:text-slate-400 block text-[11px] mb-0.5">
                  {t('inOutRate')}
                </span>
                <div className="flex items-center justify-between font-mono text-slate-800 dark:text-slate-200 font-semibold">
                  <span className="text-cyan-500">RX: {selectedPort.inTrafficMbps} Mbps</span>
                  <span className="text-blue-500">TX: {selectedPort.outTrafficMbps} Mbps</span>
                </div>
              </div>

              <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/50">
                <span className="text-slate-500 dark:text-slate-400 block text-[11px] mb-0.5">
                  {t('connectedMacHost')}
                </span>
                <div className="font-semibold text-slate-900 dark:text-white">
                  {selectedPort.connectedDevice || 'No LLDP neighbor / Disconnected'}
                </div>
                {selectedPort.connectedMac && (
                  <span className="font-mono text-[11px] text-slate-400">{selectedPort.connectedMac}</span>
                )}
              </div>

              {selectedPort.errorDiscards > 0 && (
                <div className="p-2 rounded bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50 text-rose-500 text-xs flex items-center gap-1.5 font-mono">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span>{selectedPort.errorDiscards} Interface CRC/Discards Detected</span>
                </div>
              )}
            </div>

            {/* Why the last attempt was refused — a wrong/absent write community, usually */}
            {portActionError && (
              <div className="mt-4 p-2.5 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-800 text-rose-800 dark:text-rose-300 text-[11px] flex items-start gap-2">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-rose-500" />
                <span className="leading-relaxed">{portActionError}</span>
              </div>
            )}

            {/* Admin Toggle State Action */}
            <div className="mt-5 pt-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between">
              {currentDevice?.status === 'offline' ? (
                <div className="text-center w-full text-rose-500 text-xs italic">
                  {currentDevice.name}: {t('portOfflineHint')}
                </div>
              ) : isAdmin || isEngineer ? (
                <button
                  disabled={isTogglingPort}
                  onClick={async () => {
                    setPortActionError(null);
                    setIsTogglingPort(true);
                    const res = await togglePortState(selectedDeviceId, selectedPort.id);
                    setIsTogglingPort(false);
                    if (!res.success) {
                      // The device refused, or no write credential is configured.
                      // Leave the displayed state alone: it still matches the hardware.
                      setPortActionError(res.error ?? t('portChangeFailed'));
                      return;
                    }
                    setSelectedPort(prev =>
                      prev
                        ? {
                            ...prev,
                            adminUp: !prev.adminUp,
                            status: !prev.adminUp ? 'up' : 'down',
                          }
                        : null
                    );
                  }}
                  className={`w-full py-2 px-3 rounded-lg font-semibold text-xs flex items-center justify-center gap-2 transition-all disabled:opacity-60 disabled:cursor-not-allowed ${
                    selectedPort.adminUp
                      ? 'bg-rose-600 hover:bg-rose-500 text-white'
                      : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                  }`}
                >
                  <Power className="w-3.5 h-3.5" />
                  <span>
                    {isTogglingPort
                      ? t('applyingPortChange')
                      : selectedPort.adminUp
                        ? t('disablePort')
                        : t('enablePort')}
                  </span>
                </button>
              ) : (
                <div className="text-center w-full text-slate-400 text-xs italic">
                  {t('portReadOnlyHint')}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
