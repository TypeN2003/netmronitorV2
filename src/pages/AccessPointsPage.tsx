import React, { useState } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { useNetworkData, DEFAULT_RUCKUS_ONE_URL } from '../context/NetworkDataContext';
import { useAuth } from '../context/AuthContext';
import {
  Wifi,
  Radio,
  Users,
  RotateCw,
  Search,
  ExternalLink,
  Signal,
  CheckCircle2,
  AlertTriangle,
  Cpu,
} from 'lucide-react';
import { AccessPoint } from '../types';

export const AccessPointsPage: React.FC = () => {
  const { t } = useLanguage();
  const { accessPoints, rebootAccessPoint, settings } = useNetworkData();
  const ruckusOneUrl = settings.ruckusOneUrl || DEFAULT_RUCKUS_ONE_URL;
  const { isAdmin, isEngineer } = useAuth();

  const [search, setSearch] = useState('');
  const [rebootingId, setRebootingId] = useState<string | null>(null);

  const filteredAps = accessPoints.filter(
    ap =>
      ap.name.toLowerCase().includes(search.toLowerCase()) ||
      ap.ip.includes(search) ||
      ap.location.toLowerCase().includes(search.toLowerCase()) ||
      ap.building.toLowerCase().includes(search.toLowerCase())
  );

  const handleReboot = async (apId: string) => {
    setRebootingId(apId);
    const res = await rebootAccessPoint(apId);
    setRebootingId(null);
    // Rebooting an AP is a RUCKUS One operation; the server answers 501 until that lands
    if (!res.success) alert(res.error ?? t('apRebootUnavailable'));
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-2.5">
            <Wifi className="w-6 h-6 text-cyan-500" />
            {t('apClusters')}
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            High-density 802.11ax Wi-Fi 6 & 6E Access Point telemetry and Radio Resource Management (RRM)
          </p>
        </div>

        {/* The faculty's APs are cloud-managed in RUCKUS One; its console cannot be embedded
            (it sends X-Frame-Options: DENY), so it opens in a new tab */}
        <a
          href={ruckusOneUrl}
          target="_blank"
          rel="noopener noreferrer"
          title={ruckusOneUrl}
          className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold shadow-xs transition-all"
        >
          <ExternalLink className="w-4 h-4" />
          <span>{t('openRuckusOne')}</span>
        </a>
      </div>

      {/* Search Input */}
      <div className="bg-white dark:bg-slate-900 p-3 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs flex items-center justify-between gap-3 text-xs">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search AP name, IP, building or floor..."
            className="w-full bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-lg pl-9 pr-3 py-1.5 text-xs text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-cyan-500"
          />
        </div>
      </div>

      {/* AP Grid Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {filteredAps.map(ap => {
          const isRebooting = rebootingId === ap.id;
          return (
            <div
              key={ap.id}
              className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 shadow-xs flex flex-col justify-between hover:border-cyan-500/50 transition-all"
            >
              <div>
                {/* AP Header */}
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <h3 className="font-bold text-sm text-slate-900 dark:text-white flex items-center gap-1.5">
                      <Radio className="w-4 h-4 text-cyan-500" />
                      {ap.name}
                    </h3>
                    <div className="text-[10px] text-slate-400 font-mono">{ap.ip} · {ap.mac}</div>
                  </div>
                  <span
                    className={`text-[10px] font-mono uppercase px-1.5 py-0.5 rounded font-bold ${
                      ap.status === 'online'
                        ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-800'
                        : 'bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 border border-amber-300 dark:border-amber-800'
                    }`}
                  >
                    {ap.status}
                  </span>
                </div>

                <div className="text-[11px] text-slate-500 dark:text-slate-400 mb-3">
                  {ap.location}
                </div>

                {/* SSIDs */}
                <div className="space-y-1 mb-3">
                  <span className="text-[10px] uppercase font-semibold text-slate-400">Broadcasting:</span>
                  <div className="flex flex-wrap gap-1">
                    {ap.ssidList.map((ssid, idx) => (
                      <span
                        key={idx}
                        className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-mono"
                      >
                        {ssid}
                      </span>
                    ))}
                  </div>
                </div>

                {/* RF Channels & Power */}
                <div className="grid grid-cols-2 gap-2 text-xs mb-3">
                  <div className="p-2 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/50">
                    <span className="text-[10px] text-slate-400 block">Channels</span>
                    <span className="font-mono text-slate-800 dark:text-slate-200 font-semibold text-[11px]">
                      2.4G:{ap.channels.band24} · 5G:{ap.channels.band5}
                      {ap.channels.band6 ? ` · 6G:${ap.channels.band6}` : ''}
                    </span>
                  </div>

                  <div className="p-2 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/50">
                    <span className="text-[10px] text-slate-400 block">{t('avgRssi')}</span>
                    <span className="font-mono text-emerald-600 dark:text-emerald-400 font-semibold text-[11px]">
                      {ap.rssiAvg} dBm
                    </span>
                  </div>
                </div>

                {/* Connected Clients & Retry Rate */}
                <div className="flex items-center justify-between text-xs py-2 border-t border-slate-100 dark:border-slate-800">
                  <span className="text-slate-500 flex items-center gap-1">
                    <Users className="w-3.5 h-3.5 text-blue-500" />
                    <span>{t('connectedUsers')}</span>
                  </span>
                  <span className="font-mono font-bold text-slate-900 dark:text-white tabular-nums">
                    {ap.connectedClients} Clients
                  </span>
                </div>

                <div className="flex items-center justify-between text-xs py-1">
                  <span className="text-slate-500">Retry Rate</span>
                  <span
                    className={`font-mono text-xs font-semibold tabular-nums ${
                      ap.retryRate > 5 ? 'text-amber-500' : 'text-emerald-500'
                    }`}
                  >
                    {ap.retryRate}%
                  </span>
                </div>
              </div>

              {/* Action Button: Reboot AP (Admin & Engineer Only) */}
              {(isAdmin || isEngineer) && (
                <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800">
                  <button
                    onClick={() => handleReboot(ap.id)}
                    disabled={isRebooting}
                    className="w-full py-1.5 px-3 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-medium text-xs flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
                  >
                    <RotateCw className={`w-3.5 h-3.5 ${isRebooting ? 'animate-spin' : ''}`} />
                    <span>{isRebooting ? t('rebootingAp') : t('rebootAp')}</span>
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
