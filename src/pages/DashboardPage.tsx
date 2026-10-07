import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../context/LanguageContext';
import { useNetworkData, alertText } from '../context/NetworkDataContext';
import { useAuth } from '../context/AuthContext';
import {
  Server,
  Activity,
  AlertTriangle,
  ArrowUpRight,
  ArrowDownRight,
  RefreshCw,
  GitFork,
  ShieldAlert,
  Cpu,
  Layers,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Legend,
} from 'recharts';
import { CPU_THRESHOLD, RAM_THRESHOLD } from '../context/NetworkDataContext';
import { api } from '../services/api';
import type { ResourcePoint, TrafficPoint } from '../types';

export const DashboardPage: React.FC = () => {
  const { t, lang } = useLanguage();
  const {
    devices,
    alerts,
    vlans,
    refreshTelemetry,
    isTelemetrySyncing,
    lastSyncAt,
    isLoading,
    connectionError,
  } = useNetworkData();
  const { currentUser, isViewer } = useAuth();
  const navigate = useNavigate();

  // Chart series come from telemetry the collector stored, one point per poll bucket.
  // An empty array means nothing has been polled yet, which the charts say out loud
  // instead of drawing an invented curve.
  const [trafficData, setTrafficData] = useState<TrafficPoint[]>([]);
  const [resourceData, setResourceData] = useState<ResourcePoint[]>([]);
  const [historySamples, setHistorySamples] = useState<number | null>(null);

  const loadHistory = useCallback(async () => {
    try {
      const history = await api.telemetry.history({ hours: 6, points: 12 });
      setTrafficData(history.traffic);
      setResourceData(history.resource);
      setHistorySamples(history.sampleCount);
    } catch {
      // The banner from connectionError already covers an unreachable collector
      setHistorySamples(0);
    }
  }, []);

  // Reload the series whenever a poll cycle lands (lastSyncAt changes on every cycle)
  useEffect(() => {
    void loadHistory();
  }, [loadHistory, lastSyncAt]);

  const totalDevices = devices.length;
  const onlineDevices = devices.filter(d => d.status === 'online').length;
  const warningDevices = devices.filter(d => d.status === 'warning').length;
  const offlineDevices = devices.filter(d => d.status === 'offline').length;
  const highCpuDevices = devices.filter(d => d.cpu >= CPU_THRESHOLD).length;
  const highRamDevices = devices.filter(d => d.ram >= RAM_THRESHOLD).length;
  const activeCriticalAlerts = alerts.filter(a => a.severity === 'critical' && a.status === 'active');

  // Peaks across the window, for the chart legend
  const peakInbound = trafficData.reduce((max, p) => Math.max(max, p.inbound), 0);
  const peakOutbound = trafficData.reduce((max, p) => Math.max(max, p.outbound), 0);
  const hasHistory = trafficData.length > 0;

  /**
   * Share of monitored devices that are answering and under their thresholds.
   * Previously a fixed 96.4%; this is the real number.
   */
  const healthPercent =
    totalDevices === 0 ? 0 : Math.round(((onlineDevices + warningDevices * 0.5) / totalDevices) * 1000) / 10;

  // Top VLANs traffic consumption
  const vlanChartData = vlans.slice(0, 5).map(v => ({
    name: `VLAN ${v.id}`,
    traffic: v.trafficRateMbps,
    fullName: v.name,
  }));

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

      {!connectionError && !isLoading && devices.length === 0 && (
        <div className="p-3.5 rounded-xl bg-cyan-50 dark:bg-cyan-950/40 border border-cyan-300 dark:border-cyan-800 text-cyan-800 dark:text-cyan-300 text-xs flex items-start gap-2">
          <Server className="w-4 h-4 shrink-0 mt-0.5 text-cyan-500" />
          <div>
            <span className="font-semibold block">{t('noDevicesYet')}</span>
            <span className="text-[11px] opacity-90">{t('noDevicesYetHint')}</span>
          </div>
        </div>
      )}

      {/* Top Header & Refresh Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            {t('navDashboard')}
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Cisco DNA Center & PRTG Enterprise NOC Telemetry Suite · Welcome, {currentUser?.name} ({currentUser?.role})
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-xs font-mono text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-900 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            <span>{t('lastSyncTime')}: {lastSyncAt.slice(11)}</span>
          </div>

          <button
            onClick={refreshTelemetry}
            disabled={isTelemetrySyncing}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold shadow-xs transition-all disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isTelemetrySyncing ? 'animate-spin' : ''}`} />
            <span>{t('refreshData')}</span>
          </button>
        </div>
      </div>

      {/* Top Metric Cards: device counts by status */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {/* Total Devices */}
        <div onClick={() => navigate('/devices')} className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs cursor-pointer hover:border-cyan-400 transition-colors">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-2">
            <span className="text-[11px] font-medium uppercase tracking-wider">{t('totalHardware')}</span>
            <Server className="w-4 h-4 text-cyan-500" />
          </div>
          <div className="text-2xl font-bold font-mono text-slate-900 dark:text-white tabular-nums">{totalDevices}</div>
          <div className="mt-1 text-[11px] text-slate-500 font-mono">Router · Switch · Firewall · Server</div>
        </div>

        {/* Online */}
        <div onClick={() => navigate('/devices?status=online')} className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs cursor-pointer hover:border-emerald-400 transition-colors">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-2">
            <span className="text-[11px] font-medium uppercase tracking-wider">{t('statusOnline')}</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="text-2xl font-bold font-mono text-emerald-600 dark:text-emerald-400 tabular-nums">{onlineDevices}</div>
          <div className="mt-1 text-[11px] text-emerald-600 dark:text-emerald-400 font-mono">
            {totalDevices > 0 ? ((onlineDevices / totalDevices) * 100).toFixed(1) : '0.0'}%
          </div>
        </div>

        {/* Warning (CPU / Memory over threshold) */}
        <div onClick={() => navigate('/devices?status=warning')} className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs cursor-pointer hover:border-amber-400 transition-colors">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-2">
            <span className="text-[11px] font-medium uppercase tracking-wider">{t('statusWarning')}</span>
            <AlertTriangle className="w-4 h-4 text-amber-500" />
          </div>
          <div className="text-2xl font-bold font-mono text-amber-500 tabular-nums">{warningDevices}</div>
          <div className="mt-1 text-[11px] text-amber-500 font-mono">
            CPU ≥ {CPU_THRESHOLD}%: {highCpuDevices} · RAM ≥ {RAM_THRESHOLD}%: {highRamDevices}
          </div>
        </div>

        {/* Offline */}
        <div onClick={() => navigate('/devices?status=offline')} className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs cursor-pointer hover:border-rose-400 transition-colors">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-2">
            <span className="text-[11px] font-medium uppercase tracking-wider">{t('statusOffline')}</span>
            <XCircle className="w-4 h-4 text-rose-500" />
          </div>
          <div className="text-2xl font-bold font-mono text-rose-600 dark:text-rose-400 tabular-nums">{offlineDevices}</div>
          {/* Offline is decided by an SNMP timeout; nothing here uses ICMP */}
          <div className="mt-1 text-[11px] text-slate-500 font-mono">{t('offlineReason')}</div>
        </div>
      </div>

      {/* Middle Row: Real-time Telemetry Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Network Traffic Load Chart */}
        <div className="lg:col-span-2 bg-white dark:bg-slate-900 p-5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                <Activity className="w-4 h-4 text-cyan-500" />
                {t('telemetryTitle')}
              </h2>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {t('telemetrySubtitle')}
              </span>
            </div>
            <div className="flex items-center gap-3 text-xs font-mono">
              <span className="flex items-center gap-1.5 text-cyan-500">
                <span className="w-2.5 h-2.5 rounded-sm bg-cyan-500"></span> {t('inbound')} (
                {t('peak')} {peakInbound} Mbps)
              </span>
              <span className="flex items-center gap-1.5 text-blue-500">
                <span className="w-2.5 h-2.5 rounded-sm bg-blue-500"></span> {t('outbound')} (
                {t('peak')} {peakOutbound} Mbps)
              </span>
            </div>
          </div>

          <div className="h-64 w-full">
            {!hasHistory && !isLoading && (
              <div className="h-full flex flex-col items-center justify-center gap-2 text-center px-6">
                <Activity className="w-7 h-7 text-slate-300 dark:text-slate-700" />
                <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm leading-relaxed">
                  {historySamples === 0 ? t('noTelemetryYet') : t('loadingTelemetry')}
                </p>
              </div>
            )}
            {hasHistory && (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trafficData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorIn" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#06b6d4" stopOpacity={0.0} />
                  </linearGradient>
                  <linearGradient id="colorOut" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.3} />
                <XAxis dataKey="time" stroke="#64748b" fontSize={11} tickLine={false} />
                <YAxis stroke="#64748b" fontSize={11} tickLine={false} unit="M" />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#0f172a',
                    borderColor: '#334155',
                    borderRadius: '8px',
                    fontSize: '12px',
                    color: '#f8fafc',
                  }}
                />
                <Area type="monotone" dataKey="inbound" stroke="#06b6d4" strokeWidth={2} fillOpacity={1} fill="url(#colorIn)" />
                <Area type="monotone" dataKey="outbound" stroke="#3b82f6" strokeWidth={2} fillOpacity={1} fill="url(#colorOut)" />
              </AreaChart>
            </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* System Health & PRTG Scoreboard */}
        <div className="bg-white dark:bg-slate-900 p-5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                {t('systemHealth')}
              </h2>
              <span
                className={`text-xs font-mono font-bold ${
                  healthPercent >= 90
                    ? 'text-emerald-500'
                    : healthPercent >= 60
                      ? 'text-amber-500'
                      : 'text-rose-500'
                }`}
              >
                {totalDevices === 0 ? '--' : `${healthPercent}%`}
              </span>
            </div>

            {/* Health meter: devices answering SNMP and under their thresholds */}
            <div className="w-full bg-slate-100 dark:bg-slate-800 h-3 rounded-full overflow-hidden mb-4">
              <div
                className="bg-gradient-to-r from-emerald-500 to-cyan-500 h-full rounded-full transition-all"
                style={{ width: `${healthPercent}%` }}
              ></div>
            </div>

            {/* Mini Probe Counters */}
            <div className="space-y-2.5 text-xs">
              <div className="flex items-center justify-between p-2 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/50">
                <span className="text-slate-600 dark:text-slate-300">{t('snmpProbeStatus')}</span>
                <span
                  className={`font-mono font-semibold ${
                    offlineDevices > 0 ? 'text-rose-500' : 'text-emerald-600 dark:text-emerald-400'
                  }`}
                >
                  {totalDevices - offlineDevices} / {totalDevices}
                </span>
              </div>
              <div className="flex items-center justify-between p-2 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/50">
                <span className="text-slate-600 dark:text-slate-300">{t('devicesOverThreshold')}</span>
                <span
                  className={`font-mono font-semibold ${
                    highCpuDevices + highRamDevices > 0
                      ? 'text-amber-500'
                      : 'text-emerald-600 dark:text-emerald-400'
                  }`}
                >
                  {highCpuDevices + highRamDevices}
                </span>
              </div>
              <div className="flex items-center justify-between p-2 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/50">
                <span className="text-slate-600 dark:text-slate-300">{t('activeCriticalAlarms')}</span>
                <span className="font-mono text-rose-500 font-bold">{activeCriticalAlerts.length}</span>
              </div>
            </div>
          </div>

          {/* Interactive Topology Quick Preview Card */}
          <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-800">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                <GitFork className="w-3.5 h-3.5 text-cyan-500" />
                {t('topologyPreview')}
              </span>
              <button
                onClick={() => navigate('/topology')}
                className="text-[11px] text-cyan-600 dark:text-cyan-400 hover:underline font-medium"
              >
                {t('viewFullTopology')} →
              </button>
            </div>
            <div
              onClick={() => navigate('/topology')}
              className="h-24 bg-slate-50 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-2 relative overflow-hidden cursor-pointer group flex items-center justify-center"
            >
              {/* Abstract mini topology nodes visualization */}
              <div className="absolute inset-0 bg-radial from-cyan-100/60 dark:from-cyan-900/20 to-transparent"></div>
              <div className="flex items-center gap-6 relative z-10">
                <div className="w-6 h-6 rounded-md bg-blue-600 flex items-center justify-center text-[10px] text-white font-mono shadow-xs">
                  WAN
                </div>
                <div className="w-8 h-0.5 bg-cyan-500"></div>
                <div className="w-7 h-7 rounded-md bg-cyan-600 flex items-center justify-center text-[10px] text-white font-mono shadow-xs">
                  CORE
                </div>
                <div className="w-8 h-0.5 bg-cyan-500"></div>
                <div className="w-6 h-6 rounded-md bg-purple-600 flex items-center justify-center text-[10px] text-white font-mono shadow-xs">
                  DIST
                </div>
              </div>
              <div className="absolute bottom-1 right-2 text-[9px] text-slate-500 font-mono group-hover:text-cyan-600 dark:group-hover:text-cyan-400 transition-colors">
                Click to explore 5-tier topology map
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Row: Top VLANs Usage & Critical Alerts Deck */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top VLANs Bar Chart */}
        <div className="bg-white dark:bg-slate-900 p-5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                <Layers className="w-4 h-4 text-cyan-500" />
                {t('topVlansTitle')}
              </h2>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                Active segment consumption (Mbps)
              </span>
            </div>
            {!isViewer && (
              <button
                onClick={() => navigate('/vlans')}
                className="text-xs text-cyan-600 dark:text-cyan-400 hover:underline font-medium"
              >
                {t('vlanAnalytics')} →
              </button>
            )}
          </div>

          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={vlanChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.3} />
                <XAxis dataKey="name" stroke="#64748b" fontSize={11} tickLine={false} />
                <YAxis stroke="#64748b" fontSize={11} tickLine={false} unit="M" />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#0f172a',
                    borderColor: '#334155',
                    borderRadius: '8px',
                    fontSize: '12px',
                    color: '#f8fafc',
                  }}
                />
                <Bar dataKey="traffic" fill="#06b6d4" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Critical Alerts Incident Stream */}
        <div className="bg-white dark:bg-slate-900 p-5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-rose-500" />
                {t('criticalIncidents')}
              </h2>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                Actionable NOC alerts requiring investigation
              </span>
            </div>
            {!isViewer && (
              <button
                onClick={() => navigate('/alerts')}
                className="text-xs text-cyan-600 dark:text-cyan-400 hover:underline font-medium"
              >
                {t('viewAllAlerts')} →
              </button>
            )}
          </div>

          <div className="space-y-2.5">
            {alerts.slice(0, 3).map(alert => (
              <div
                key={alert.id}
                onClick={() => !isViewer && navigate('/alerts')}
                className={`p-3 rounded-lg border transition-all ${isViewer ? '' : 'cursor-pointer'} ${
                  alert.severity === 'critical'
                    ? 'bg-rose-50 dark:bg-rose-950/20 border-rose-200 dark:border-rose-900/60 hover:border-rose-500'
                    : 'bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900/60 hover:border-amber-500'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-[10px] font-mono uppercase px-1.5 py-0.2 rounded font-bold ${
                        alert.severity === 'critical' ? 'bg-rose-600 text-white' : 'bg-amber-600 text-white'
                      }`}
                    >
                      {alert.severity}
                    </span>
                    <span className="font-semibold text-xs text-slate-900 dark:text-white">{alert.deviceName}</span>
                  </div>
                  <span className="text-[10px] text-slate-400 font-mono">{alert.timestamp.slice(11)}</span>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-300 line-clamp-2">{alertText(alert, lang).message}</p>
                {alert.notes.length > 0 && (
                  <div className="mt-1.5 pt-1.5 border-t border-slate-200 dark:border-slate-800 text-[10px] text-slate-500 dark:text-slate-400 flex items-center gap-1">
                    <span>Note:</span>
                    <span className="italic truncate">{alert.notes[0].text}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
