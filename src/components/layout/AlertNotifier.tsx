import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../../context/LanguageContext';
import { useNetworkData, alertText } from '../../context/NetworkDataContext';
import { useAuth } from '../../context/AuthContext';
import { IncidentAlert } from '../../types';
import { AlertTriangle, Bell, ShieldAlert, X } from 'lucide-react';

const TOAST_DURATION_MS = 8000;

const canUseBrowserNotifications = () => typeof window !== 'undefined' && 'Notification' in window;

// In-app notification: pops a toast (and a desktop notification when allowed) for every new active alert
export const AlertNotifier: React.FC = () => {
  const { t, lang } = useLanguage();
  const { alerts } = useNetworkData();
  const { isViewer } = useAuth();
  const navigate = useNavigate();

  const [toasts, setToasts] = useState<IncidentAlert[]>([]);
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(() =>
    canUseBrowserNotifications() ? Notification.permission : 'unsupported'
  );
  const seenIds = useRef<Set<string>>(new Set(alerts.map(a => a.id)));

  useEffect(() => {
    const fresh = alerts.filter(a => a.status === 'active' && !seenIds.current.has(a.id));
    alerts.forEach(a => seenIds.current.add(a.id));
    if (fresh.length === 0) return;

    setToasts(prev => [...fresh, ...prev].slice(0, 4));
    fresh.forEach(alert => {
      setTimeout(() => setToasts(prev => prev.filter(x => x.id !== alert.id)), TOAST_DURATION_MS);
      if (permission === 'granted') {
        new Notification(`[${alert.severity.toUpperCase()}] ${alert.deviceName}`, { body: alertText(alert, lang).message });
      }
    });
  }, [alerts]);

  const dismiss = (id: string) => setToasts(prev => prev.filter(x => x.id !== id));

  const enableDesktop = async () => {
    if (!canUseBrowserNotifications()) return;
    setPermission(await Notification.requestPermission());
  };

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[60] w-[calc(100%-2rem)] max-w-sm space-y-2">
      {toasts.map(alert => (
        <div
          key={alert.id}
          className={`p-3 rounded-xl border shadow-lg bg-white dark:bg-slate-900 text-xs ${
            alert.severity === 'critical' ? 'border-rose-400 dark:border-rose-700' : 'border-amber-400 dark:border-amber-700'
          }`}
        >
          <div className="flex items-start gap-2.5">
            {alert.severity === 'critical' ? (
              <ShieldAlert className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
            )}
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-slate-900 dark:text-white">
                {t('appNotifTitle')}: {alert.deviceName}
              </div>
              <p className="text-slate-600 dark:text-slate-300 mt-0.5 line-clamp-2">{alertText(alert, lang).message}</p>
              <div className="flex items-center gap-3 mt-2">
                {!isViewer && (
                  <button
                    onClick={() => {
                      dismiss(alert.id);
                      navigate('/alerts');
                    }}
                    className="font-semibold text-cyan-600 dark:text-cyan-400 hover:underline"
                  >
                    {t('viewAllAlerts')} →
                  </button>
                )}
                {permission === 'default' && (
                  <button
                    onClick={enableDesktop}
                    className="flex items-center gap-1 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
                  >
                    <Bell className="w-3 h-3" />
                    {t('enableDesktopNotif')}
                  </button>
                )}
              </div>
            </div>
            <button onClick={() => dismiss(alert.id)} className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
};
