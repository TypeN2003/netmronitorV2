import React, { useState } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { useNetworkData, alertText } from '../context/NetworkDataContext';
import { useAuth } from '../context/AuthContext';
import {
  AlertTriangle,
  ShieldAlert,
  CheckCircle2,
  Clock,
  MessageSquare,
  Search,
  Filter,
  X,
  Send,
  User,
  History,
} from 'lucide-react';
import { IncidentAlert, AlertNote } from '../types';

export const AlertsPage: React.FC = () => {
  const { t, lang } = useLanguage();
  const { alerts, acknowledgeAlert, resolveAlert } = useNetworkData();
  const { currentUser, isAdmin, isEngineer, isViewer } = useAuth();

  const [severityFilter, setSeverityFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [search, setSearch] = useState('');

  // Acknowledge Modal State
  const [activeAlertForAck, setActiveAlertForAck] = useState<IncidentAlert | null>(null);
  const [ackNoteText, setAckNoteText] = useState('');
  const [noteError, setNoteError] = useState('');

  const canAcknowledge = !isViewer && (isAdmin || isEngineer);

  const filteredAlerts = alerts.filter(a => {
    const matchesSeverity = severityFilter === 'all' || a.severity === severityFilter;
    const matchesStatus = statusFilter === 'all' || a.status === statusFilter;
    const q = search.toLowerCase();
    const text = alertText(a, lang);
    const matchesSearch =
      a.deviceName.toLowerCase().includes(q) ||
      text.message.toLowerCase().includes(q) ||
      text.category.toLowerCase().includes(q) ||
      a.notes.some(n => n.text.toLowerCase().includes(q)) ||
      a.deviceIp.includes(search);
    return matchesSeverity && matchesStatus && matchesSearch;
  });

  const handleOpenAckModal = (alert: IncidentAlert) => {
    setActiveAlertForAck(alert);
    setAckNoteText('');
    setNoteError('');
  };

  const handleConfirmAck = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeAlertForAck || !currentUser) return;

    const trimmed = ackNoteText.trim();
    if (!trimmed) {
      setNoteError(t('noteRequiredError'));
      return;
    }

    // The author comes from the signed-in account on the server, not from the browser
    const res = await acknowledgeAlert(activeAlertForAck.id, trimmed);
    if (!res.success) {
      setNoteError(res.error || t('ackFailed'));
      return;
    }
    setActiveAlertForAck(null);
    setAckNoteText('');
    setNoteError('');
  };

  const getSeverityBadge = (severity: string) => {
    switch (severity) {
      case 'critical':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-mono uppercase px-2 py-0.5 rounded font-bold bg-rose-600 text-white shadow-xs">
            Critical
          </span>
        );
      case 'warning':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-mono uppercase px-2 py-0.5 rounded font-bold bg-amber-600 text-white shadow-xs">
            Warning
          </span>
        );
      case 'info':
      default:
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-mono uppercase px-2 py-0.5 rounded font-bold bg-blue-600 text-white shadow-xs">
            Info
          </span>
        );
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-2.5">
          <ShieldAlert className="w-6 h-6 text-rose-500" />
          {t('alarmIncidentDeck')}
        </h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          {t('alertsSubtitle')}
        </p>
      </div>

      {/* Filters Bar */}
      <div className="bg-white dark:bg-slate-900 p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col md:flex-row items-center justify-between gap-3 text-xs">
        <div className="relative w-full md:w-80">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t('alertsSearchPlaceholder')}
            className="w-full bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-lg pl-9 pr-3 py-1.5 text-xs text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-cyan-500"
          />
        </div>

        <div className="flex items-center gap-3 w-full md:w-auto">
          {/* Severity Filter */}
          <div className="flex items-center gap-2">
            <span className="text-slate-500 text-[11px] whitespace-nowrap">{t('severity')}:</span>
            <select
              value={severityFilter}
              onChange={e => setSeverityFilter(e.target.value)}
              className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-800 dark:text-slate-200 focus:outline-none"
            >
              <option value="all">{t('severityAll')}</option>
              <option value="critical">{t('severityCritical')}</option>
              <option value="warning">{t('severityWarning')}</option>
              <option value="info">{t('severityInfo')}</option>
            </select>
          </div>

          {/* Status Filter */}
          <div className="flex items-center gap-2">
            <span className="text-slate-500 text-[11px] whitespace-nowrap">{t('alertStatusLabel')}:</span>
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-800 dark:text-slate-200 focus:outline-none"
            >
              <option value="all">{t('alertStatusAll')}</option>
              <option value="active">{t('alertStatusActive')}</option>
              <option value="acknowledged">{t('alertStatusAcknowledged')}</option>
              <option value="resolved">{t('alertStatusResolved')}</option>
            </select>
          </div>
        </div>
      </div>

      {/* Incidents List Deck */}
      <div className="space-y-4">
        {filteredAlerts.length === 0 ? (
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-8 text-center text-slate-400 text-xs">
            {t('alertsEmpty')}
          </div>
        ) : (
          filteredAlerts.map(alert => (
            <div
              key={alert.id}
              className={`bg-white dark:bg-slate-900 rounded-xl border p-4 shadow-xs transition-all ${
                alert.status === 'resolved'
                  ? 'border-slate-200 dark:border-slate-800 opacity-60'
                  : alert.severity === 'critical'
                  ? 'border-rose-200 dark:border-rose-900/60'
                  : 'border-slate-200 dark:border-slate-800'
              }`}
            >
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    {getSeverityBadge(alert.severity)}
                    <span className="font-bold text-sm text-slate-900 dark:text-white">
                      {alertText(alert, lang).category}
                    </span>
                    <span className="text-xs font-mono text-slate-400">({alert.id})</span>
                  </div>

                  <p className="text-xs text-slate-700 dark:text-slate-300 font-sans leading-relaxed">
                    {alertText(alert, lang).message}
                  </p>

                  <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500 font-mono pt-1">
                    <span>
                      {t('alertDeviceLabel')}: <strong className="text-cyan-600 dark:text-cyan-400">{alert.deviceName}</strong> ({alert.deviceIp})
                    </span>
                    <span>·</span>
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3 text-slate-400" />
                      <span>{alert.timestamp}</span>
                    </span>
                    {alert.acknowledgedBy && (
                      <>
                        <span>·</span>
                        <span className="text-amber-600 dark:text-amber-400 font-semibold">
                          {t('alertAckByLabel')}: {alert.acknowledgedBy} ({alert.acknowledgedAt?.slice(11)})
                        </span>
                      </>
                    )}
                  </div>
                </div>

                {/* Action Buttons: Acknowledge & Resolve */}
                <div className="flex items-center gap-2 shrink-0 pt-2 sm:pt-0">
                  {alert.status === 'active' && canAcknowledge && (
                    <button
                      onClick={() => handleOpenAckModal(alert)}
                      className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-semibold text-xs flex items-center gap-1.5 shadow-xs transition-colors"
                    >
                      <MessageSquare className="w-3.5 h-3.5" />
                      <span>{t('acknowledgeAction')}</span>
                    </button>
                  )}

                  {alert.status === 'acknowledged' && canAcknowledge && (
                    <button
                      onClick={() => resolveAlert(alert.id)}
                      className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs flex items-center gap-1.5 shadow-xs transition-colors"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>{t('resolveAction')}</span>
                    </button>
                  )}

                  {alert.status === 'resolved' && (
                    <span className="text-[11px] font-mono text-emerald-500 font-semibold flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      {t('alertStatusResolved')}
                    </span>
                  )}
                </div>
              </div>

              {/* Historical Notes Audit Trail on this incident card */}
              {alert.notes.length > 0 && (
                <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800">
                  <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-2 flex items-center gap-1.5">
                    <History className="w-3.5 h-3.5 text-cyan-500" />
                    <span>{t('notesHistory')} ({alert.notes.length})</span>
                  </div>

                  <div className="space-y-2">
                    {alert.notes.map(note => (
                      <div
                        key={note.id}
                        className="bg-slate-50 dark:bg-slate-800/60 p-2.5 rounded-lg border border-slate-200 dark:border-slate-700/60 text-xs"
                      >
                        <div className="flex items-center justify-between text-[11px] mb-1">
                          <span className="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1">
                            <User className="w-3 h-3 text-cyan-500" />
                            {note.author} ({note.role})
                          </span>
                          <span className="text-slate-400 font-mono text-[10px]">{note.timestamp}</span>
                        </div>
                        <p className="text-slate-600 dark:text-slate-300 font-sans italic">
                          "{note.text}"
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Acknowledge Modal with Mandatory Note Input */}
      {activeAlertForAck && (
        <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-3 mb-4 border-b border-slate-200 dark:border-slate-800">
              <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <MessageSquare className="w-5 h-5 text-amber-500" />
                {t('ackModalTitle')}
              </h3>
              <button
                onClick={() => setActiveAlertForAck(null)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="mb-4 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 text-xs">
              <div className="font-semibold text-amber-900 dark:text-amber-300">
                {activeAlertForAck.deviceName} ({activeAlertForAck.deviceIp})
              </div>
              <p className="text-slate-600 dark:text-slate-400 mt-0.5 line-clamp-2">
                {alertText(activeAlertForAck, lang).message}
              </p>
            </div>

            <form onSubmit={handleConfirmAck} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-700 dark:text-slate-300 font-medium mb-1.5">
                  {t('ackModalPrompt')}
                </label>
                <textarea
                  required
                  rows={4}
                  value={ackNoteText}
                  onChange={e => {
                    setAckNoteText(e.target.value);
                    if (noteError) setNoteError('');
                  }}
                  placeholder={t('ackModalPlaceholder')}
                  className={`w-full bg-slate-50 dark:bg-slate-800 border rounded-lg p-3 text-slate-900 dark:text-white focus:outline-none focus:ring-1 ${
                    noteError
                      ? 'border-rose-500 focus:ring-rose-500'
                      : 'border-slate-200 dark:border-slate-700 focus:ring-cyan-500'
                  }`}
                ></textarea>

                {noteError && (
                  <div className="mt-1.5 p-2 rounded-md bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-600 dark:text-rose-400 text-[11px] flex items-center gap-1.5 font-medium">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    <span>{noteError}</span>
                  </div>
                )}
                <span className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 block">
                  {t('alertAuthorLabel')}: <strong className="text-slate-700 dark:text-slate-300">{currentUser?.name}</strong> ({currentUser?.role})
                </span>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setActiveAlertForAck(null)}
                  className="px-4 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-semibold"
                >
                  {t('cancel')}
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-semibold flex items-center gap-1.5 shadow-xs"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>{t('ackConfirmButton')}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
