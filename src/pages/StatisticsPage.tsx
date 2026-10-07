import React, { useCallback, useEffect, useState } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { useNetworkData } from '../context/NetworkDataContext';
import { BarChart3, TrendingUp, Globe, Layers, Info, Cpu } from 'lucide-react';
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
  Cell,
} from 'recharts';
import { api } from '../services/api';
import type { ResourcePoint, TopPortRow, TrafficPoint } from '../types';

/**
 * Longer-range analytics, built from the telemetry the collector stored.
 *
 * What SNMP counters can answer: how much traffic crossed each interface, how busy
 * the devices were, which ports carried the most. What they cannot answer: which
 * application protocols that traffic was. Protocol breakdown needs NetFlow/IPFIX or
 * DPI, so that chart is not shown rather than filled with invented percentages.
 */

const VLAN_COLORS = ['#06b6d4', '#3b82f6', '#10b981', '#8b5cf6', '#f59e0b', '#ec4899', '#14b8a6', '#f43f5e'];

const TOOLTIP_STYLE = {
  backgroundColor: '#0f172a',
  borderColor: '#334155',
  borderRadius: '8px',
  fontSize: '11px',
  color: '#f8fafc',
};

export const StatisticsPage: React.FC = () => {
  const { t } = useLanguage();
  const { vlans, devices, lastSyncAt, isLoading } = useNetworkData();

  const [traffic, setTraffic] = useState<TrafficPoint[]>([]);
  const [resource, setResource] = useState<ResourcePoint[]>([]);
  const [topPorts, setTopPorts] = useState<TopPortRow[]>([]);
  const [sampleCount, setSampleCount] = useState<number | null>(null);
  const [hours, setHours] = useState<number>(24);

  const load = useCallback(async () => {
    try {
      // One point per hour over the window, capped by what retention keeps
      const [history, ports] = await Promise.all([
        api.telemetry.history({ hours, points: Math.min(24, hours) }),
        api.telemetry.topPorts(10),
      ]);
      setTraffic(history.traffic);
      setResource(history.resource);
      setSampleCount(history.sampleCount);
      setTopPorts(ports);
    } catch {
      setSampleCount(0);
    }
  }, [hours]);

  useEffect(() => {
    void load();
  }, [load, lastSyncAt]);

  const hasHistory = traffic.length > 0;

  // Busiest VLANs by current throughput — the collector keeps this rolled up per VLAN
  const vlanTraffic = [...vlans]
    .filter(v => v.trafficRateMbps > 0)
    .sort((a, b) => b.trafficRateMbps - a.trafficRateMbps)
    .slice(0, 8)
    .map(v => ({ name: `VLAN ${v.id}`, fullName: v.name, traffic: v.trafficRateMbps }));

  const peakIn = traffic.reduce((max, p) => Math.max(max, p.inbound), 0);
  const peakOut = traffic.reduce((max, p) => Math.max(max, p.outbound), 0);
  const peakCpu = resource.reduce((max, p) => Math.max(max, p.cpu), 0);

  const emptyState = (
    <div className="h-full flex flex-col items-center justify-center gap-2 text-center px-6">
      <BarChart3 className="w-7 h-7 text-slate-300 dark:text-slate-700" />
      <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm leading-relaxed">
        {sampleCount === 0 ? t('noTelemetryYet') : t('loadingTelemetry')}
      </p>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-2.5">
            <BarChart3 className="w-6 h-6 text-cyan-500" />
            {t('statsTitle')}
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{t('statsSubtitle')}</p>
        </div>

        {/* Window selector — bounded by the collector's retention period */}
        <div className="flex items-center bg-slate-100 dark:bg-slate-800 rounded-lg p-0.5 border border-slate-200 dark:border-slate-700">
          {[
            { value: 6, label: t('last6h') },
            { value: 24, label: t('last24h') },
            { value: 168, label: t('last7d') },
          ].map(option => (
            <button
              key={option.value}
              onClick={() => setHours(option.value)}
              className={`px-3 py-1 text-xs font-semibold rounded transition-colors ${
                hours === option.value
                  ? 'bg-white dark:bg-slate-700 text-cyan-600 dark:text-cyan-400'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {/* Summary tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: t('peakInbound'), value: `${peakIn} Mbps`, icon: TrendingUp, tone: 'text-cyan-500' },
          { label: t('peakOutbound'), value: `${peakOut} Mbps`, icon: TrendingUp, tone: 'text-blue-500' },
          { label: t('peakCpuLabel'), value: `${peakCpu}%`, icon: Cpu, tone: 'text-amber-500' },
          {
            label: t('samplesStored'),
            value: sampleCount === null ? '—' : sampleCount.toLocaleString(),
            icon: Layers,
            tone: 'text-emerald-500',
          },
        ].map(tile => (
          <div
            key={tile.label}
            className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs"
          >
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">{tile.label}</span>
              <tile.icon className={`w-4 h-4 ${tile.tone}`} />
            </div>
            <div className="text-xl font-bold text-slate-900 dark:text-white font-mono tabular-nums">
              {tile.value}
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Throughput over time */}
        <div className="lg:col-span-2 bg-white dark:bg-slate-900 p-5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs">
          <div className="flex items-start justify-between mb-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-cyan-500" />
                {t('throughputTrend')}
              </h2>
              <span className="text-xs text-slate-500 dark:text-slate-400">{t('throughputTrendHint')}</span>
            </div>
          </div>

          <div className="h-72 w-full">
            {!hasHistory && !isLoading ? (
              emptyState
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={traffic} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="statIn" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#06b6d4" stopOpacity={0.0} />
                    </linearGradient>
                    <linearGradient id="statOut" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.3} />
                  <XAxis dataKey="time" stroke="#64748b" fontSize={11} tickLine={false} />
                  <YAxis stroke="#64748b" fontSize={11} tickLine={false} unit="M" />
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                  <Legend wrapperStyle={{ fontSize: '11px' }} />
                  <Area
                    type="monotone"
                    name={t('inbound')}
                    dataKey="inbound"
                    stroke="#06b6d4"
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#statIn)"
                  />
                  <Area
                    type="monotone"
                    name={t('outbound')}
                    dataKey="outbound"
                    stroke="#3b82f6"
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#statOut)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Traffic by VLAN — replaces the protocol donut, which SNMP cannot answer */}
        <div className="bg-white dark:bg-slate-900 p-5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2 mb-1">
              <Layers className="w-4 h-4 text-cyan-500" />
              {t('trafficByVlan')}
            </h2>
            <span className="text-xs text-slate-500 dark:text-slate-400">{t('trafficByVlanHint')}</span>
          </div>

          <div className="h-52 w-full mt-3">
            {vlanTraffic.length === 0 ? (
              <div className="h-full flex items-center justify-center text-center px-4">
                <p className="text-xs text-slate-500 dark:text-slate-400">{t('noVlanTraffic')}</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={vlanTraffic} margin={{ top: 5, right: 10, left: -24, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.3} vertical={false} />
                  <XAxis dataKey="name" stroke="#64748b" fontSize={10} tickLine={false} interval={0} angle={-30} textAnchor="end" height={46} />
                  <YAxis stroke="#64748b" fontSize={11} tickLine={false} unit="M" />
                  <Tooltip
                    contentStyle={TOOLTIP_STYLE}
                    formatter={value => [`${value} Mbps`, t('traffic')]}
                    labelFormatter={label => {
                      // Show the VLAN name next to its id, which is all the axis has room for
                      const match = vlanTraffic.find(v => v.name === label);
                      return match ? `${match.name} — ${match.fullName}` : String(label ?? '');
                    }}
                  />
                  <Bar dataKey="traffic" radius={[4, 4, 0, 0]}>
                    {vlanTraffic.map((entry, index) => (
                      <Cell key={entry.name} fill={VLAN_COLORS[index % VLAN_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Say plainly what this page cannot show, instead of inventing it */}
          <div className="mt-auto pt-3 border-t border-slate-200 dark:border-slate-800 flex items-start gap-2 text-[11px] text-slate-500 dark:text-slate-400">
            <Info className="w-3.5 h-3.5 shrink-0 mt-0.5 text-slate-400" />
            <span className="leading-relaxed">{t('noProtocolBreakdown')}</span>
          </div>
        </div>
      </div>

      {/* Busiest ports */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
            <Globe className="w-4 h-4 text-cyan-500" />
            {t('topTalkers')}
          </h2>
          <span className="text-xs font-mono text-slate-500">{t('topPortsHint')}</span>
        </div>

        {topPorts.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400">
            {devices.length === 0 ? t('noDevicesYet') : t('noPortTraffic')}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400 uppercase tracking-wider font-semibold">
                <tr>
                  <th className="py-3 px-4 w-16">{t('rank')}</th>
                  <th className="py-3 px-4">{t('device')}</th>
                  <th className="py-3 px-4">{t('portName')}</th>
                  <th className="py-3 px-4">{t('vlan')}</th>
                  <th className="py-3 px-4 text-right">{t('inbound')}</th>
                  <th className="py-3 px-4 text-right">{t('outbound')}</th>
                  <th className="py-3 px-4 text-right">{t('total')}</th>
                  <th className="py-3 px-4">{t('connectedMac')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                {topPorts.map((port, index) => (
                  <tr
                    key={`${port.deviceIp}-${port.portName}`}
                    className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                  >
                    <td className="py-3 px-4 font-mono font-bold text-cyan-600 dark:text-cyan-400">
                      #{index + 1}
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-semibold text-slate-900 dark:text-white">{port.deviceName}</div>
                      <div className="font-mono text-[11px] text-slate-500">{port.deviceIp}</div>
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-700 dark:text-slate-300">{port.portName}</td>
                    <td className="py-3 px-4 font-mono text-slate-500">
                      {port.vlan} ({port.vlanName})
                    </td>
                    <td className="py-3 px-4 text-right font-mono text-cyan-600 dark:text-cyan-400 tabular-nums">
                      {port.inMbps}
                    </td>
                    <td className="py-3 px-4 text-right font-mono text-blue-600 dark:text-blue-400 tabular-nums">
                      {port.outMbps}
                    </td>
                    <td className="py-3 px-4 text-right font-mono font-bold text-slate-900 dark:text-white tabular-nums">
                      {port.totalMbps}
                    </td>
                    <td className="py-3 px-4 font-mono text-[11px] text-slate-500">
                      {port.connectedMac ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
