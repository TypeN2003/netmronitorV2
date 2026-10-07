import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { useTheme } from '../../context/ThemeContext';
import { useNetworkData, alertText } from '../../context/NetworkDataContext';
import { useNavigate, Link } from 'react-router-dom';
import {
  Activity,
  Sun,
  Moon,
  Globe,
  Bell,
  Search,
  UserCheck,
  LogOut,
  Shield,
  CheckCircle2,
  AlertTriangle,
  Radio,
  ExternalLink,
} from 'lucide-react';
import { Role } from '../../types';

export const Header: React.FC = () => {
  const { currentUser, logout, isAdmin, isEngineer, isViewer } = useAuth();
  const { lang, setLang, t } = useLanguage();
  const { theme, toggleTheme } = useTheme();
  const { alerts, devices, accessPoints } = useNetworkData();
  const navigate = useNavigate();

  const [showRoleMenu, setShowRoleMenu] = useState(false);
  const [showAlertsDropdown, setShowAlertsDropdown] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearchResults, setShowSearchResults] = useState(false);

  /**
   * The most upstream monitored device, used for the status badge in the header.
   * A Router sits closest to the outside world; a Firewall or Core Switch is the
   * next best stand-in. Nothing monitored yet means no badge at all.
   */
  const gatewayDevice =
    devices.find(d => d.type === 'Router') ??
    devices.find(d => d.type === 'Firewall') ??
    devices.find(d => d.type === 'Core Switch') ??
    devices[0] ??
    null;

  const activeAlerts = alerts.filter(a => a.status === 'active');
  const criticalCount = activeAlerts.filter(a => a.severity === 'critical').length;

  // Global search filtering
  const searchResults = searchQuery.trim()
    ? [
        ...devices
          .filter(d => d.name.toLowerCase().includes(searchQuery.toLowerCase()) || d.ip.includes(searchQuery))
          .map(d => ({ type: 'Device', title: d.name, sub: `${d.ip} · ${d.type}`, path: '/devices' })),
        ...accessPoints
          .filter(ap => ap.name.toLowerCase().includes(searchQuery.toLowerCase()) || ap.ip.includes(searchQuery))
          .map(ap => ({ type: 'AP', title: ap.name, sub: `${ap.ip} · ${ap.location}`, path: '/access-points' })),
      ].slice(0, 5)
    : [];

  const getRoleBadgeStyle = (role?: Role) => {
    switch (role) {
      case 'Admin':
        return 'bg-rose-100 text-rose-700 border-rose-300 dark:bg-rose-500/20 dark:text-rose-300 dark:border-rose-500/30';
      case 'Engineer':
        return 'bg-cyan-100 text-cyan-700 border-cyan-300 dark:bg-cyan-500/20 dark:text-cyan-300 dark:border-cyan-500/30';
      case 'Viewer':
      default:
        return 'bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-500/20 dark:text-amber-300 dark:border-amber-500/30';
    }
  };

  return (
    <header className="h-16 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 md:px-6 flex items-center justify-between shrink-0 sticky top-0 z-30 transition-colors">
      {/* Zone 1: Brand & Gateway Telemetry */}
      <div className="flex items-center gap-4">
        <Link to="/dashboard" className="flex items-center gap-2.5 group">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-tr from-cyan-600 to-blue-600 flex items-center justify-center shadow-md shadow-cyan-500/20 text-white">
            <Activity className="w-5 h-5 text-white animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-lg tracking-tight text-slate-900 dark:text-white group-hover:text-cyan-600 dark:group-hover:text-cyan-400 transition-colors">
                NetMonitor
              </span>
              <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-cyan-100 dark:bg-cyan-950/70 text-cyan-800 dark:text-cyan-300 font-semibold border border-cyan-300 dark:border-cyan-800">
                NOC Core
              </span>
            </div>
          </div>
        </Link>

        {/* Upstream device status, read from the last SNMP poll */}
        {gatewayDevice && (
          <div className="hidden lg:flex items-center gap-3 text-xs border-l border-slate-200 dark:border-slate-800 pl-4 text-slate-500 dark:text-slate-400">
            <div className="flex items-center gap-1.5 font-mono">
              <span className="relative flex h-2 w-2">
                {gatewayDevice.status === 'online' && (
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                )}
                <span
                  className={`relative inline-flex rounded-full h-2 w-2 ${
                    gatewayDevice.status === 'online'
                      ? 'bg-emerald-500'
                      : gatewayDevice.status === 'warning'
                        ? 'bg-amber-500'
                        : 'bg-rose-500'
                  }`}
                ></span>
              </span>
              <span className="text-slate-700 dark:text-slate-300 font-medium">
                {gatewayDevice.name}: {gatewayDevice.ip}
              </span>
              <span
                className={`font-semibold ${
                  gatewayDevice.status === 'online'
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : gatewayDevice.status === 'warning'
                      ? 'text-amber-600 dark:text-amber-400'
                      : 'text-rose-600 dark:text-rose-400'
                }`}
              >
                [
                {gatewayDevice.status === 'online'
                  ? t('statusOnline')
                  : gatewayDevice.status === 'warning'
                    ? t('statusWarning')
                    : t('statusOffline')}
                ]
              </span>
            </div>
            <span className="text-slate-300 dark:text-slate-700">·</span>
            {/* SNMP round-trip, which is what stands in for an ICMP ping here */}
            <div className="flex items-center gap-1 font-mono">
              <span>{t('snmpRtt')}:</span>
              <span className="text-cyan-600 dark:text-cyan-400 font-medium">
                {gatewayDevice.status === 'offline' ? '—' : `${gatewayDevice.pingMs} ms`}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Zone 2: Global Search Bar */}
      <div className="relative hidden md:block max-w-md w-full mx-4">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => {
              setSearchQuery(e.target.value);
              setShowSearchResults(true);
            }}
            onFocus={() => setShowSearchResults(true)}
            placeholder={t('searchPlaceholder')}
            className="w-full bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-lg pl-9 pr-4 py-1.5 text-xs text-slate-800 dark:text-slate-200 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-cyan-500 focus:border-cyan-500 transition-all font-sans"
          />
        </div>

        {/* Search Results Dropdown */}
        {showSearchResults && searchQuery && (
          <div
            className="absolute left-0 right-0 mt-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl py-2 z-50 text-xs"
            onMouseLeave={() => setShowSearchResults(false)}
          >
            <div className="px-3 py-1 text-[11px] text-slate-400 font-medium uppercase tracking-wider">
              Search Results ({searchResults.length})
            </div>
            {searchResults.length > 0 ? (
              searchResults.map((item, idx) => (
                <button
                  key={idx}
                  onClick={() => {
                    navigate(item.path);
                    setShowSearchResults(false);
                    setSearchQuery('');
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-slate-100 dark:hover:bg-slate-700/60 flex items-center justify-between text-slate-700 dark:text-slate-200 transition-colors"
                >
                  <div>
                    <span className="font-semibold text-slate-900 dark:text-white">{item.title}</span>
                    <span className="ml-2 text-slate-400 font-mono text-[11px]">{item.sub}</span>
                  </div>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
                    {item.type}
                  </span>
                </button>
              ))
            ) : (
              <div className="px-3 py-2 text-slate-400 text-center">No devices or APs found</div>
            )}
          </div>
        )}
      </div>

      {/* Zone 3: Actions (Theme, Language, Notifications, RBAC Role & User) */}
      <div className="flex items-center gap-2">
        {/* Language Switcher */}
        <div className="flex items-center bg-slate-100 dark:bg-slate-800 rounded-lg p-0.5 border border-slate-200 dark:border-slate-700">
          <button
            onClick={() => setLang('th')}
            title="Switch to Thai"
            className={`px-2 py-1 text-xs font-semibold rounded transition-colors ${
              lang === 'th'
                ? 'bg-white dark:bg-slate-700 text-cyan-600 dark:text-cyan-400 shadow-xs'
                : 'text-slate-500 hover:text-slate-800 dark:text-slate-400'
            }`}
          >
            TH
          </button>
          <button
            onClick={() => setLang('en')}
            title="Switch to English"
            className={`px-2 py-1 text-xs font-semibold rounded transition-colors ${
              lang === 'en'
                ? 'bg-white dark:bg-slate-700 text-cyan-600 dark:text-cyan-400 shadow-xs'
                : 'text-slate-500 hover:text-slate-800 dark:text-slate-400'
            }`}
          >
            EN
          </button>
        </div>

        {/* Theme Toggle Button */}
        <button
          onClick={toggleTheme}
          title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
          className="p-2 rounded-lg text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 transition-colors"
        >
          {theme === 'dark' ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-slate-600" />}
        </button>

        {/* Notifications Alert Bell */}
        <div className="relative">
          <button
            onClick={() => setShowAlertsDropdown(!showAlertsDropdown)}
            title={t('notifications')}
            className="p-2 rounded-lg text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 transition-colors relative"
          >
            <Bell className="w-4 h-4" />
            {activeAlerts.length > 0 && (
              <span className="absolute -top-1 -right-1 flex h-4 min-w-[16px] px-1 items-center justify-center rounded-full bg-rose-600 text-white text-[10px] font-bold font-mono">
                {activeAlerts.length}
              </span>
            )}
          </button>

          {/* Alerts Popover */}
          {showAlertsDropdown && (
            <div
              className="absolute right-0 mt-2 w-80 sm:w-96 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-2xl py-2 z-50 text-xs"
              onMouseLeave={() => setShowAlertsDropdown(false)}
            >
              <div className="px-4 py-2 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
                <span className="font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4 text-rose-500" />
                  {t('criticalIncidents')}
                </span>
                <span className="text-[11px] font-mono text-rose-500 font-medium">
                  {criticalCount} Critical
                </span>
              </div>
              <div className="max-h-72 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-700/50">
                {activeAlerts.length === 0 ? (
                  <div className="p-4 text-center text-slate-400">{t('noAlerts')}</div>
                ) : (
                  activeAlerts.map(alert => (
                    <div key={alert.id} className="p-3 hover:bg-slate-50 dark:hover:bg-slate-700/40 transition-colors">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-slate-900 dark:text-slate-100">{alert.deviceName}</span>
                        <span className="text-[10px] text-slate-400 font-mono">{alert.timestamp.slice(11)}</span>
                      </div>
                      <p className="text-slate-600 dark:text-slate-300 mt-1 line-clamp-2">{alertText(alert, lang).message}</p>
                    </div>
                  ))
                )}
              </div>
              {!isViewer && (
                <div className="p-2 border-t border-slate-200 dark:border-slate-700 text-center">
                  <button
                    onClick={() => {
                      navigate('/alerts');
                      setShowAlertsDropdown(false);
                    }}
                    className="w-full text-center py-1 text-cyan-600 dark:text-cyan-400 hover:underline font-medium text-xs"
                  >
                    {t('viewAllAlerts')} →
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* User Profile & Role Switcher Popover */}
        <div className="relative ml-1">
          <button
            onClick={() => setShowRoleMenu(!showRoleMenu)}
            className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors border border-transparent hover:border-slate-200 dark:hover:border-slate-700"
          >
            <div className="w-7 h-7 rounded-md bg-gradient-to-br from-slate-700 to-slate-900 text-white flex items-center justify-center font-bold text-xs uppercase shadow-xs">
              {currentUser?.name.charAt(0) || 'U'}
            </div>
            <div className="hidden sm:block text-left">
              <div className="text-xs font-semibold text-slate-900 dark:text-white max-w-[120px] truncate leading-tight">
                {currentUser?.name || 'Operator'}
              </div>
              <div className="flex items-center gap-1">
                <span
                  className={`text-[9px] font-mono px-1.5 py-0.2 rounded border font-semibold ${getRoleBadgeStyle(
                    currentUser?.role
                  )}`}
                >
                  {currentUser?.role || 'Viewer'}
                </span>
              </div>
            </div>
          </button>

          {/* Role Switcher & Profile Dropdown */}
          {showRoleMenu && (
            <div
              className="absolute right-0 mt-2 w-72 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-2xl p-2 z-50 text-xs"
              onMouseLeave={() => setShowRoleMenu(false)}
            >
              <div className="px-3 py-2 border-b border-slate-200 dark:border-slate-700">
                <div className="font-semibold text-slate-900 dark:text-white">{currentUser?.name}</div>
                <div className="text-[11px] text-slate-400 font-mono">{currentUser?.email}</div>
                <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">{currentUser?.department}</div>
              </div>

              {/* Role, as assigned on the server. An Admin changes roles on the Users page. */}
              <div className="p-2 bg-slate-50 dark:bg-slate-900/60 rounded-md my-2 border border-slate-200 dark:border-slate-700/60">
                <div className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1.5 flex items-center gap-1">
                  <UserCheck className="w-3.5 h-3.5 text-cyan-500" />
                  {t('yourRole')}
                </div>
                <div
                  className={`px-2 py-1.5 rounded text-[11px] font-semibold text-center border ${getRoleBadgeStyle(
                    currentUser?.role
                  )}`}
                >
                  {currentUser?.role}
                </div>
                {isAdmin && (
                  <button
                    onClick={() => {
                      setShowRoleMenu(false);
                      navigate('/users');
                    }}
                    className="mt-1.5 w-full px-2 py-1.5 rounded text-[11px] font-medium bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-cyan-50 dark:hover:bg-cyan-950/40 transition-colors"
                  >
                    {t('manageRoles')}
                  </button>
                )}
              </div>

              {/* Logout Button */}
              <button
                onClick={() => {
                  logout();
                  navigate('/login');
                }}
                className="w-full text-left px-3 py-2 rounded text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 flex items-center gap-2 font-medium transition-colors"
              >
                <LogOut className="w-3.5 h-3.5" />
                {t('logout')}
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
