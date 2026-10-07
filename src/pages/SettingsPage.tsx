import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useLanguage } from '../context/LanguageContext';
import { useTheme } from '../context/ThemeContext';
import { useNetworkData, DEFAULT_RUCKUS_ONE_URL } from '../context/NetworkDataContext';
import { useAuth } from '../context/AuthContext';
import { BackupManager } from '../components/settings/BackupManager';
import { api } from '../services/api';
import {
  Settings,
  Bell,
  Clock,
  Send,
  Save,
  CheckCircle2,
  Lock,
  Globe,
  Radio,
  Sliders,
  HardDrive,
  Shield,
  AlertTriangle,
  Activity,
  Mail,
  XCircle,
  Info,
} from 'lucide-react';

export const SettingsPage: React.FC = () => {
  const { lang, setLang, t } = useLanguage();
  const { theme, toggleTheme } = useTheme();
  const { settings, updateSettings, telemetryStatus, connectionError } = useNetworkData();
  const { currentUser, isAdmin } = useAuth();

  // ?tab=backups (e.g. from the Devices page) opens that tab directly
  const [searchParams] = useSearchParams();
  const requestedTab = searchParams.get('tab');
  const [activeTab, setActiveTab] = useState<'general' | 'webhooks' | 'backups' | 'security'>(
    requestedTab === 'webhooks' || requestedTab === 'backups' || requestedTab === 'security' ? requestedTab : 'general'
  );
  const [formData, setFormData] = useState({ ...settings });
  const [testSent, setTestSent] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  // The bot token never comes back from the server, so the field starts blank and
  // only a non-empty value replaces what is stored.
  const [telegramToken, setTelegramToken] = useState('');
  // Like the bot token, the App Password never comes back from the server
  const [smtpPassword, setSmtpPassword] = useState('');
  const [isTestingEmail, setIsTestingEmail] = useState(false);
  const [emailTestResult, setEmailTestResult] = useState<{
    ok: boolean;
    error?: string;
    hint?: string;
  } | null>(null);
  const [isTestingTelegram, setIsTestingTelegram] = useState(false);
  const [telegramTestResult, setTelegramTestResult] = useState<{
    ok: boolean;
    error?: string;
    hint?: string;
  } | null>(null);

  // Settings live on the server: adopt whatever it last confirmed
  useEffect(() => {
    setFormData({ ...settings });
  }, [settings]);

  /**
   * Really sends a Telegram message and reports what Telegram said.
   *
   * The token typed into the form is sent along, so credentials can be checked
   * before they are saved. Telegram refusing is a normal outcome, not an error:
   * the endpoint answers 200 with `ok: false` and the reason.
   */
  const handleTestWebhook = async () => {
    setTelegramTestResult(null);
    setIsTestingTelegram(true);
    try {
      const result = await api.settings.testTelegram({
        telegramBotToken: telegramToken.trim() || undefined,
        telegramChatId: formData.telegramChatId?.trim() || undefined,
      });
      setTelegramTestResult(result);
    } catch (error) {
      setTelegramTestResult({
        ok: false,
        error: error instanceof Error ? error.message : t('telegramTestFailed'),
      });
    } finally {
      setIsTestingTelegram(false);
    }
  };

  /**
   * Really sends an email and reports what the mail server said.
   *
   * Credentials typed into the form are sent along, so they can be checked before
   * being saved. SMTP refusing is a normal outcome, not an error: the endpoint
   * answers 200 with `ok: false` and the reason.
   */
  const handleTestEmail = async () => {
    setEmailTestResult(null);
    setIsTestingEmail(true);
    try {
      const result = await api.settings.testEmail({
        smtpHost: formData.smtpHost?.trim() || undefined,
        smtpPort: formData.smtpPort || undefined,
        smtpUser: formData.smtpUser?.trim() || undefined,
        smtpPassword: smtpPassword.trim() || undefined,
        emailFrom: formData.emailFrom?.trim() || undefined,
        emailNotification: formData.emailNotification?.trim() || undefined,
      });
      setEmailTestResult(result);
    } catch (error) {
      setEmailTestResult({
        ok: false,
        error: error instanceof Error ? error.message : t('emailTestFailed'),
      });
    } finally {
      setIsTestingEmail(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveError(null);
    setIsSaving(true);
    // The backup policy is maintained by the backup runs; never send this form's stale copy
    const { backupPolicy: _staleBackupPolicy, ...generalSettings } = formData;
    const res = await updateSettings({
      ...generalSettings,
      // Empty means "keep the stored token"
      ...(telegramToken.trim() ? { telegramBotToken: telegramToken.trim() } : {}),
      ...(smtpPassword.trim() ? { smtpPassword: smtpPassword.trim() } : {}),
    });
    if (res.success) {
      setTelegramToken('');
      setSmtpPassword('');
    }
    setIsSaving(false);
    if (!res.success) {
      setSaveError(res.error ?? t('settingsSaveFailed'));
      return;
    }
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 2500);
  };

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-2.5">
          <Settings className="w-6 h-6 text-cyan-500" />
          {t('settingsTitle')}
        </h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          {t('settingsSubtitle')}
        </p>
      </div>

      {/* Tabs Navigation */}
      <div className="flex items-center gap-1.5 border-b border-slate-200 dark:border-slate-800 pb-2 overflow-x-auto text-xs font-semibold">
        <button
          type="button"
          onClick={() => setActiveTab('general')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl transition-all whitespace-nowrap ${
            activeTab === 'general'
              ? 'bg-cyan-600 text-white shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <Globe className="w-4 h-4" />
          <span>{t('generalSettings')}</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('backups')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl transition-all whitespace-nowrap ${
            activeTab === 'backups'
              ? 'bg-cyan-600 text-white shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <HardDrive className="w-4 h-4" />
          <span>{t('backupManagerTitle')}</span>
          <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-cyan-950 text-cyan-300 font-mono">
            Archive
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('webhooks')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl transition-all whitespace-nowrap ${
            activeTab === 'webhooks'
              ? 'bg-cyan-600 text-white shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <Bell className="w-4 h-4" />
          <span>{t('webhookSettings')}</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('security')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl transition-all whitespace-nowrap ${
            activeTab === 'security'
              ? 'bg-cyan-600 text-white shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <Lock className="w-4 h-4" />
          <span>{t('securityTab')}</span>
        </button>
      </div>

      {saveSuccess && (
        <div className="p-3.5 rounded-xl bg-emerald-950/40 border border-emerald-800 text-emerald-300 text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <span>{t('settingsSaved')}</span>
        </div>
      )}

      {saveError && (
        <div className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-800 text-rose-800 dark:text-rose-300 text-xs flex items-center gap-2">
          <XCircle className="w-4 h-4 text-rose-500 shrink-0" />
          <span>{saveError}</span>
        </div>
      )}

      {testSent && (
        <div className="p-3.5 rounded-xl bg-cyan-950/40 border border-cyan-800 text-cyan-300 text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-cyan-400" />
          <span>{t('testWebhookSuccess')}</span>
        </div>
      )}

      {/* Tab Content: Automated Backup Manager */}
      {activeTab === 'backups' && <BackupManager />}

      {/* Tab Content: General & Telemetry */}
      {activeTab === 'general' && (
        <form onSubmit={handleSave} className="space-y-6">
          {/* Collector health: what the backend is actually doing right now */}
          <div className="bg-white dark:bg-slate-900 p-5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-3">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-2">
              <Activity className="w-4 h-4 text-cyan-500" />
              {t('collectorStatus')}
            </h2>

            {connectionError ? (
              <div className="flex items-start gap-2 text-xs text-rose-700 dark:text-rose-300">
                <XCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-500" />
                <div>
                  <span className="font-semibold block">{t('collectorUnreachable')}</span>
                  <span className="text-[11px] opacity-90">{connectionError}</span>
                </div>
              </div>
            ) : !telemetryStatus ? (
              <p className="text-xs text-slate-500 dark:text-slate-400">{t('loadingTelemetry')}</p>
            ) : (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                  {[
                    {
                      label: t('collectorPolling'),
                      value: telemetryStatus.pollerEnabled
                        ? `${t('every')} ${telemetryStatus.intervalSeconds}s`
                        : t('pollingDisabled'),
                      tone: telemetryStatus.pollerEnabled
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-amber-600 dark:text-amber-400',
                    },
                    {
                      label: t('monitoredDevices'),
                      value: `${telemetryStatus.pollableCount} / ${telemetryStatus.deviceCount}`,
                      tone: 'text-slate-900 dark:text-white',
                    },
                    {
                      label: t('thresholdsLabel'),
                      value: `CPU ${telemetryStatus.cpuThreshold}% / RAM ${telemetryStatus.ramThreshold}%`,
                      tone: 'text-slate-900 dark:text-white',
                    },
                    {
                      label: t('samplesStored'),
                      value: telemetryStatus.sampleCount.toLocaleString(),
                      tone: 'text-slate-900 dark:text-white',
                    },
                  ].map(item => (
                    <div
                      key={item.label}
                      className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/50"
                    >
                      <span className="block text-[11px] text-slate-500 dark:text-slate-400">{item.label}</span>
                      <span className={`font-mono font-semibold ${item.tone}`}>{item.value}</span>
                    </div>
                  ))}
                </div>

                {telemetryStatus.lastCycle && (
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                    {t('lastPollCycle')}: {telemetryStatus.lastCycle.finishedAt} —{' '}
                    {telemetryStatus.lastCycle.reachable} {t('reachable')}, {telemetryStatus.lastCycle.failed}{' '}
                    {t('failed')} ({telemetryStatus.lastCycle.durationMs} ms)
                  </div>
                )}

                {/* Name the devices the last cycle could not reach, with the reason */}
                {telemetryStatus.lastCycle?.devices.some(d => !d.ok) && (
                  <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 text-amber-800 dark:text-amber-300 text-[11px] space-y-1">
                    <div className="flex items-center gap-1.5 font-semibold">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                      <span>{t('pollFailures')}</span>
                    </div>
                    <ul className="list-disc list-inside space-y-0.5 pl-1">
                      {telemetryStatus.lastCycle.devices
                        .filter(d => !d.ok)
                        .map(d => (
                          <li key={d.id}>
                            <span className="font-mono">
                              {d.name} ({d.ip})
                            </span>
                            : {d.error}
                          </li>
                        ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Section 1: General & Gateway */}
          <div className="bg-white dark:bg-slate-900 p-5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-2">
              <Globe className="w-4 h-4 text-cyan-500" />
              {t('generalSettings')}
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div>
                <label className="block text-slate-600 dark:text-slate-400 mb-1 font-medium">{t('uiLanguageLabel')}</label>
                <select
                  value={lang}
                  onChange={e => setLang(e.target.value as any)}
                  className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2 text-slate-900 dark:text-white focus:outline-none"
                >
                  <option value="th">ภาษาไทย (Thai)</option>
                  <option value="en">English (US)</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-600 dark:text-slate-400 mb-1 font-medium">{t('ruckusOneUrlLabel')}</label>
                <input
                  type="url"
                  value={formData.ruckusOneUrl ?? DEFAULT_RUCKUS_ONE_URL}
                  onChange={e => setFormData({ ...formData, ruckusOneUrl: e.target.value })}
                  placeholder={DEFAULT_RUCKUS_ONE_URL}
                  pattern="https://.*"
                  className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2 text-slate-900 dark:text-white font-mono focus:outline-none"
                />
                <p className="text-[11px] text-slate-400 mt-1">{t('ruckusOneUrlHint')}</p>
              </div>
            </div>
          </div>

          {/* Section 2: SNMP Polling & Telemetry */}
          <div className="bg-white dark:bg-slate-900 p-5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-2">
              <Radio className="w-4 h-4 text-cyan-500" />
              {t('pollingSettings')}
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
              <div>
                <label className="block text-slate-600 dark:text-slate-400 mb-1 font-medium">
                  {t('pollingIntervalLabel')}
                </label>
                <select
                  value={formData.snmpInterval}
                  onChange={e => setFormData({ ...formData, snmpInterval: parseInt(e.target.value) })}
                  className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2 text-slate-900 dark:text-white focus:outline-none font-mono"
                >
                  {/* The server rejects anything below 15 s */}
                  <option value={30}>30s</option>
                  <option value={60}>60s</option>
                  <option value={120}>120s</option>
                  <option value={300}>300s (5 {t('minutes')})</option>
                  <option value={600}>600s (10 {t('minutes')})</option>
                </select>
                <p className="text-[11px] text-slate-400 mt-1">{t('pollingIntervalHint')}</p>
              </div>

              <div>
                <label className="block text-slate-600 dark:text-slate-400 mb-1 font-medium">
                  {t('snmpTimeoutLabel')}
                </label>
                <input
                  type="number"
                  min={200}
                  max={60000}
                  value={formData.pingTimeoutMs}
                  onChange={e => setFormData({ ...formData, pingTimeoutMs: parseInt(e.target.value) || 2000 })}
                  className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2 text-slate-900 dark:text-white font-mono focus:outline-none"
                />
                <p className="text-[11px] text-slate-400 mt-1">{t('snmpTimeoutHint')}</p>
              </div>

              <div>
                <label className="block text-slate-600 dark:text-slate-400 mb-1 font-medium">
                  {t('packetLossLabel')}
                </label>
                <input
                  type="number"
                  value={formData.packetLossThreshold}
                  onChange={e => setFormData({ ...formData, packetLossThreshold: parseInt(e.target.value) || 5 })}
                  className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2 text-slate-900 dark:text-white font-mono focus:outline-none"
                />
                {/* Stored but unused: an SNMP-only collector has no packet-loss measurement */}
                <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1 flex items-start gap-1">
                  <Info className="w-3 h-3 shrink-0 mt-0.5" />
                  <span>{t('noEffectYet')}</span>
                </p>
              </div>
            </div>

            <p className="text-[11px] text-slate-500 dark:text-slate-400 flex items-start gap-1.5 pt-1">
              <Info className="w-3.5 h-3.5 shrink-0 mt-0.5 text-cyan-500" />
              <span>{t('thresholdsEnvHint')}</span>
            </p>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={isSaving}
              className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold text-xs tracking-wide shadow-md shadow-cyan-600/30 transition-all"
            >
              <Save className="w-4 h-4" />
              <span>{isSaving ? t('saving') : t('saveSettings')}</span>
            </button>
          </div>
        </form>
      )}

      {/* Tab Content: Webhooks & Notifications */}
      {activeTab === 'webhooks' && (
        <form onSubmit={handleSave} className="space-y-6">
          <div className="bg-white dark:bg-slate-900 p-5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-2">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                <Bell className="w-4 h-4 text-cyan-500" />
                {t('webhookSettings')}
              </h2>
              <button
                type="button"
                onClick={handleTestWebhook}
                disabled={isTestingTelegram}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed text-slate-800 dark:text-slate-200 text-xs font-medium border border-slate-200 dark:border-slate-700"
              >
                <Send className={`w-3 h-3 text-cyan-500 ${isTestingTelegram ? 'animate-pulse' : ''}`} />
                <span>{isTestingTelegram ? t('telegramTesting') : t('testWebhook')}</span>
              </button>
            </div>

            {/* What Telegram actually answered */}
            {telegramTestResult && (
              <div
                className={`p-3 rounded-lg border text-[11px] flex items-start gap-2 ${
                  telegramTestResult.ok
                    ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300'
                    : 'bg-rose-50 dark:bg-rose-950/40 border-rose-300 dark:border-rose-800 text-rose-800 dark:text-rose-300'
                }`}
              >
                {telegramTestResult.ok ? (
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5 text-emerald-500" />
                ) : (
                  <XCircle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-rose-500" />
                )}
                <span className="leading-relaxed">
                  <span className="font-semibold block">
                    {telegramTestResult.ok ? t('telegramTestOk') : t('telegramTestFailed')}
                  </span>
                  {telegramTestResult.error}
                  {telegramTestResult.hint && <span className="block mt-1 opacity-90">{telegramTestResult.hint}</span>}
                </span>
              </div>
            )}

            <div className="space-y-3.5 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-slate-600 dark:text-slate-400 mb-1 font-medium">{t('telegramToken')}</label>
                  <input
                    type="password"
                    autoComplete="off"
                    value={telegramToken}
                    onChange={e => setTelegramToken(e.target.value)}
                    placeholder={
                      formData.telegramBotTokenSet ? t('telegramTokenStored') : '8637928289:AAH...'
                    }
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2 text-slate-900 dark:text-white font-mono focus:outline-none"
                  />
                  {/* The token controls the bot, so the server never sends it back */}
                  <p className="text-[11px] text-slate-400 mt-1">{t('telegramTokenHint')}</p>
                </div>

                <div>
                  <label className="block text-slate-600 dark:text-slate-400 mb-1 font-medium">{t('telegramChatId')}</label>
                  <input
                    type="text"
                    value={formData.telegramChatId}
                    onChange={e => setFormData({ ...formData, telegramChatId: e.target.value })}
                    placeholder="-1002938491028"
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2 text-slate-900 dark:text-white font-mono focus:outline-none"
                  />
                </div>
              </div>

              {/* How much to send */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-1">
                <div>
                  <label className="block text-slate-600 dark:text-slate-400 mb-1 font-medium">
                    {t('telegramMinSeverity')}
                  </label>
                  <select
                    value={formData.telegramMinSeverity ?? 'info'}
                    onChange={e =>
                      setFormData({
                        ...formData,
                        telegramMinSeverity: e.target.value as 'info' | 'warning' | 'critical',
                      })
                    }
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2 text-slate-900 dark:text-white focus:outline-none"
                  >
                    <option value="info">{t('severityInfoUp')}</option>
                    <option value="warning">{t('severityWarningUp')}</option>
                    <option value="critical">{t('severityCriticalOnly')}</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-600 dark:text-slate-400 mb-1 font-medium">
                    {t('telegramCooldown')}
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={1440}
                    value={formData.telegramCooldownMinutes ?? 5}
                    onChange={e =>
                      setFormData({ ...formData, telegramCooldownMinutes: parseInt(e.target.value) || 0 })
                    }
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2 text-slate-900 dark:text-white font-mono focus:outline-none"
                  />
                  <p className="text-[11px] text-slate-400 mt-1">{t('telegramCooldownHint')}</p>
                </div>

                <div className="space-y-2 pt-5">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.telegramEnabled ?? true}
                      onChange={e => setFormData({ ...formData, telegramEnabled: e.target.checked })}
                      className="w-3.5 h-3.5 text-cyan-500 rounded border-slate-300 dark:border-slate-600 focus:ring-0"
                    />
                    <span className="text-slate-600 dark:text-slate-400">{t('telegramEnabled')}</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.telegramNotifyRecovery ?? true}
                      onChange={e => setFormData({ ...formData, telegramNotifyRecovery: e.target.checked })}
                      className="w-3.5 h-3.5 text-cyan-500 rounded border-slate-300 dark:border-slate-600 focus:ring-0"
                    />
                    <span className="text-slate-600 dark:text-slate-400">{t('telegramNotifyRecovery')}</span>
                  </label>
                </div>
              </div>

              {/* ---- Email over SMTP ---- */}
              <div className="pt-4 mt-2 border-t border-slate-200 dark:border-slate-800 space-y-3.5">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                    <Mail className="w-3.5 h-3.5 text-cyan-500" />
                    {t('emailSectionTitle')}
                  </h3>
                  <button
                    type="button"
                    onClick={handleTestEmail}
                    disabled={isTestingEmail}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed text-slate-800 dark:text-slate-200 text-xs font-medium border border-slate-200 dark:border-slate-700"
                  >
                    <Send className={`w-3 h-3 text-cyan-500 ${isTestingEmail ? 'animate-pulse' : ''}`} />
                    <span>{isTestingEmail ? t('emailTesting') : t('emailTestButton')}</span>
                  </button>
                </div>

                {emailTestResult && (
                  <div
                    className={`p-3 rounded-lg border text-[11px] flex items-start gap-2 ${
                      emailTestResult.ok
                        ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300'
                        : 'bg-rose-50 dark:bg-rose-950/40 border-rose-300 dark:border-rose-800 text-rose-800 dark:text-rose-300'
                    }`}
                  >
                    {emailTestResult.ok ? (
                      <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5 text-emerald-500" />
                    ) : (
                      <XCircle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-rose-500" />
                    )}
                    <span className="leading-relaxed">
                      <span className="font-semibold block">
                        {emailTestResult.ok ? t('emailTestOk') : t('emailTestFailed')}
                      </span>
                      {emailTestResult.error}
                      {emailTestResult.hint && <span className="block mt-1 opacity-90">{emailTestResult.hint}</span>}
                    </span>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-slate-600 dark:text-slate-400 mb-1 font-medium">
                      {t('emailAlertsTo')}
                    </label>
                    <input
                      type="email"
                      value={formData.emailNotification}
                      onChange={e => setFormData({ ...formData, emailNotification: e.target.value })}
                      placeholder="noc-alerts@kmutnb.ac.th"
                      className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2 text-slate-900 dark:text-white font-mono focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-600 dark:text-slate-400 mb-1 font-medium">
                      {t('smtpUser')}
                    </label>
                    <input
                      type="email"
                      autoComplete="off"
                      value={formData.smtpUser ?? ''}
                      onChange={e => setFormData({ ...formData, smtpUser: e.target.value })}
                      placeholder="yourname@gmail.com"
                      className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2 text-slate-900 dark:text-white font-mono focus:outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-slate-600 dark:text-slate-400 mb-1 font-medium">
                    {t('smtpPassword')}
                  </label>
                  <input
                    type="password"
                    autoComplete="off"
                    value={smtpPassword}
                    onChange={e => setSmtpPassword(e.target.value)}
                    placeholder={formData.smtpPasswordSet ? t('telegramTokenStored') : 'xxxx xxxx xxxx xxxx'}
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2 text-slate-900 dark:text-white font-mono focus:outline-none"
                  />
                  <p className="text-[11px] text-slate-400 mt-1">{t('smtpPasswordHint')}</p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-slate-600 dark:text-slate-400 mb-1 font-medium">
                      {t('smtpHost')}
                    </label>
                    <input
                      type="text"
                      value={formData.smtpHost ?? ''}
                      onChange={e => setFormData({ ...formData, smtpHost: e.target.value })}
                      placeholder="smtp.gmail.com"
                      className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2 text-slate-900 dark:text-white font-mono focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-600 dark:text-slate-400 mb-1 font-medium">
                      {t('smtpPort')}
                    </label>
                    <input
                      type="number"
                      value={formData.smtpPort ?? 587}
                      onChange={e => setFormData({ ...formData, smtpPort: parseInt(e.target.value) || 587 })}
                      className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2 text-slate-900 dark:text-white font-mono focus:outline-none"
                    />
                    <p className="text-[11px] text-slate-400 mt-1">{t('smtpPortHint')}</p>
                  </div>
                  <div>
                    <label className="block text-slate-600 dark:text-slate-400 mb-1 font-medium">
                      {t('emailMinSeverity')}
                    </label>
                    <select
                      value={formData.emailMinSeverity ?? 'warning'}
                      onChange={e =>
                        setFormData({
                          ...formData,
                          emailMinSeverity: e.target.value as 'info' | 'warning' | 'critical',
                        })
                      }
                      className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2 text-slate-900 dark:text-white focus:outline-none"
                    >
                      <option value="info">{t('severityInfoUp')}</option>
                      <option value="warning">{t('severityWarningUp')}</option>
                      <option value="critical">{t('severityCriticalOnly')}</option>
                    </select>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-5">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.emailEnabled ?? false}
                      onChange={e => setFormData({ ...formData, emailEnabled: e.target.checked })}
                      className="w-3.5 h-3.5 text-cyan-500 rounded border-slate-300 dark:border-slate-600 focus:ring-0"
                    />
                    <span className="text-slate-600 dark:text-slate-400">{t('emailEnabled')}</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.emailNotifyRecovery ?? true}
                      onChange={e => setFormData({ ...formData, emailNotifyRecovery: e.target.checked })}
                      className="w-3.5 h-3.5 text-cyan-500 rounded border-slate-300 dark:border-slate-600 focus:ring-0"
                    />
                    <span className="text-slate-600 dark:text-slate-400">{t('telegramNotifyRecovery')}</span>
                  </label>
                  <div className="flex items-center gap-2">
                    <span className="text-slate-600 dark:text-slate-400">{t('telegramCooldown')}</span>
                    <input
                      type="number"
                      min={0}
                      max={1440}
                      value={formData.emailCooldownMinutes ?? 5}
                      onChange={e =>
                        setFormData({ ...formData, emailCooldownMinutes: parseInt(e.target.value) || 0 })
                      }
                      className="w-20 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2 text-slate-900 dark:text-white font-mono focus:outline-none"
                    />
                  </div>
                </div>

                <div className="p-3 rounded-lg bg-cyan-50 dark:bg-cyan-950/40 border border-cyan-300 dark:border-cyan-800 text-cyan-900 dark:text-cyan-300 text-[11px] flex items-start gap-2">
                  <Info className="w-3.5 h-3.5 shrink-0 mt-0.5 text-cyan-500" />
                  <span className="leading-relaxed">{t('gmailAppPasswordHint')}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-semibold text-xs tracking-wide shadow-md shadow-cyan-600/30 transition-all"
            >
              <Save className="w-4 h-4" />
              <span>{t('saveSettings')}</span>
            </button>
          </div>
        </form>
      )}

      {/* Tab Content: Security & Sessions */}
      {activeTab === 'security' && (
        <form onSubmit={handleSave} className="space-y-6">
          <div className="bg-white dark:bg-slate-900 p-5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-2">
              <Lock className="w-4 h-4 text-cyan-500" />
              {t('securitySessionsTitle')}
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div>
                <label className="block text-slate-600 dark:text-slate-400 mb-1 font-medium">
                  {t('sessionTimeout')}
                </label>
                <select
                  value={formData.sessionTimeoutMinutes}
                  onChange={e => setFormData({ ...formData, sessionTimeoutMinutes: parseInt(e.target.value) })}
                  className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2 text-slate-900 dark:text-white focus:outline-none font-mono"
                >
                  <option value={15}>15 {t('minutes')}</option>
                  <option value={30}>30 {t('minutes')}</option>
                  <option value={60}>60 {t('minutes')}</option>
                  <option value={480}>480 {t('minutes')}</option>
                </select>
                {/* Sessions end when the JWT expires, which is JWT_EXPIRES_IN in server/.env */}
                <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1 flex items-start gap-1">
                  <Info className="w-3 h-3 shrink-0 mt-0.5" />
                  <span>{t('sessionTimeoutHint')}</span>
                </p>
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-semibold text-xs tracking-wide shadow-md shadow-cyan-600/30 transition-all"
            >
              <Save className="w-4 h-4" />
              <span>{t('saveSettings')}</span>
            </button>
          </div>
        </form>
      )}
    </div>
  );
};
