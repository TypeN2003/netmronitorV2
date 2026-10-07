import React from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { useNetworkData, DEFAULT_RUCKUS_ONE_URL } from '../../context/NetworkDataContext';
import {
  LayoutDashboard,
  Server,
  Network,
  Layers,
  Wifi,
  ExternalLink,
  GitFork,
  AlertTriangle,
  FileText,
  BarChart3,
  ShieldCheck,
  Settings,
  Eye,
  Lock,
} from 'lucide-react';

export const Sidebar: React.FC = () => {
  const { currentUser, isAdmin, isEngineer, isViewer, canAccessUsers, canAccessSettings } = useAuth();
  const { t } = useLanguage();
  const { alerts, settings } = useNetworkData();

  const activeAlertCount = alerts.filter(a => a.status === 'active').length;

  const navItems = [
    {
      to: '/dashboard',
      label: t('navDashboard'),
      icon: LayoutDashboard,
      roles: ['Admin', 'Engineer', 'Viewer'],
    },
    {
      to: '/devices',
      label: t('navDevices'),
      icon: Server,
      roles: ['Admin', 'Engineer', 'Viewer'],
    },
    {
      to: '/ports',
      label: t('navPorts'),
      icon: Network,
      roles: ['Admin', 'Engineer'],
    },
    {
      to: '/vlans',
      label: t('navVlans'),
      icon: Layers,
      roles: ['Admin', 'Engineer'],
    },
    {
      to: '/access-points',
      label: t('navAPs'),
      icon: Wifi,
      // Wi-Fi is managed in the faculty's RUCKUS One cloud console (URL set in Settings)
      externalUrl: settings.ruckusOneUrl || DEFAULT_RUCKUS_ONE_URL,
      roles: ['Admin', 'Engineer', 'Viewer'],
    },
    {
      to: '/topology',
      label: t('navTopology'),
      icon: GitFork,
      roles: ['Admin', 'Engineer', 'Viewer'],
    },
    {
      to: '/alerts',
      label: t('navAlerts'),
      icon: AlertTriangle,
      badge: activeAlertCount > 0 ? activeAlertCount : undefined,
      roles: ['Admin', 'Engineer'],
    },
    {
      to: '/event-logs',
      label: t('navEventLogs'),
      icon: FileText,
      roles: ['Admin', 'Engineer'],
    },
    {
      to: '/statistics',
      label: t('navStatistics'),
      icon: BarChart3,
      roles: ['Admin', 'Engineer'],
    },
    // Users: Admin ONLY
    {
      to: '/users',
      label: t('navUsers'),
      icon: ShieldCheck,
      roles: ['Admin'],
      visible: canAccessUsers,
    },
    // Settings: Admin & Engineer ONLY (hidden for Viewer)
    {
      to: '/settings',
      label: t('navSettings'),
      icon: Settings,
      roles: ['Admin', 'Engineer'],
      visible: canAccessSettings,
    },
  ];

  const filteredNavItems = navItems.filter(item => {
    if (item.visible !== undefined) return item.visible;
    if (currentUser?.role) {
      return item.roles.includes(currentUser.role);
    }
    return true;
  });

  return (
    <aside className="w-64 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/95 flex flex-col justify-between shrink-0 h-full transition-colors select-none z-20">
      {/* Scrollable Navigation Container */}
      <div className="flex-1 min-h-0 py-3.5 px-3 space-y-1 overflow-y-auto scrollbar-thin scrollbar-thumb-slate-200 dark:scrollbar-thumb-slate-700">
        {/* Navigation Category Label */}
        <div className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
          {t('coreInfrastructure')}
        </div>

        {filteredNavItems.map(item => {
          const Icon = item.icon;
          if (item.externalUrl) {
            return (
              <a
                key={item.to}
                href={item.externalUrl}
                target="_blank"
                rel="noopener noreferrer"
                title={item.externalUrl}
                className="flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-all group text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800/60"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <Icon className="w-4 h-4 shrink-0 transition-transform group-hover:scale-110" />
                  <span className="truncate">{item.label}</span>
                </div>
                <ExternalLink className="w-3 h-3 shrink-0 ml-1 opacity-60" />
              </a>
            );
          }
          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-all group ${
                  isActive
                    ? 'bg-cyan-50 dark:bg-cyan-950/40 text-cyan-700 dark:text-cyan-300 font-semibold border border-cyan-200 dark:border-cyan-800/80 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800/60'
                }`
              }
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <Icon className="w-4 h-4 shrink-0 transition-transform group-hover:scale-110" />
                <span className="truncate">{item.label}</span>
              </div>
              {item.badge !== undefined && (
                <span className="px-1.5 py-0.5 text-[10px] font-mono font-bold rounded-full bg-rose-500 text-white shrink-0 ml-1">
                  {item.badge}
                </span>
              )}
            </NavLink>
          );
        })}
      </div>

      {/* Selected Element 2: Bottom Status & Role Clearance Notice */}
      <div className="shrink-0 p-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/80 backdrop-blur-xs">
        {isViewer ? (
          <div className="p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 flex items-start gap-2 text-amber-800 dark:text-amber-300 text-[11px] shadow-xs">
            <Eye className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
            <div>
              <span className="font-semibold block">{t('viewerClearanceTitle')}</span>
              <span className="text-[10px] text-amber-700 dark:text-amber-400 leading-tight block mt-0.5">
                {t('viewerClearanceDesc')}
              </span>
            </div>
          </div>
        ) : isEngineer ? (
          <div className="p-2.5 rounded-lg bg-cyan-50 dark:bg-cyan-950/30 border border-cyan-200 dark:border-cyan-800/50 flex items-start gap-2 text-cyan-800 dark:text-cyan-300 text-[11px] shadow-xs">
            <Lock className="w-4 h-4 shrink-0 text-cyan-600 dark:text-cyan-400 mt-0.5" />
            <div>
              <span className="font-semibold block">{t('engineerAccessTitle')}</span>
              <span className="text-[10px] text-cyan-700 dark:text-cyan-400 leading-tight block mt-0.5">
                {t('engineerAccessDesc')}
              </span>
            </div>
          </div>
        ) : (
          <div className="p-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/50 flex items-start gap-2 text-emerald-800 dark:text-emerald-300 text-[11px] shadow-xs">
            <ShieldCheck className="w-4 h-4 shrink-0 text-emerald-600 dark:text-emerald-400 mt-0.5" />
            <div>
              <span className="font-semibold block">{t('rootAdminTitle')}</span>
              <span className="text-[10px] text-emerald-700 dark:text-emerald-400 leading-tight block mt-0.5">
                {t('rootAdminDesc')}
              </span>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
};
