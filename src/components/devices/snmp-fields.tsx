import React from 'react';
import { CheckCircle2, Loader2, Radio, XCircle } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import type { SnmpProbeResult } from '../../types';

/**
 * The SNMP credential form, shared by "add device" and "edit device".
 *
 * Nothing here is cosmetic: these are the parameters the collector uses to poll the
 * device, and the Test button proves they work before the device is saved.
 */

export interface SnmpFormValues {
  snmpVersion: '2c' | '3';
  snmpPort: string;
  snmpCommunity: string;
  snmpWriteCommunity: string;
  snmpV3User: string;
  snmpV3SecurityLevel: 'noAuthNoPriv' | 'authNoPriv' | 'authPriv';
  snmpV3AuthProtocol: 'md5' | 'sha' | 'sha224' | 'sha256' | 'sha384' | 'sha512';
  snmpV3AuthKey: string;
  snmpV3PrivProtocol: 'des' | 'aes' | 'aes256b' | 'aes256r';
  snmpV3PrivKey: string;
}

export const EMPTY_SNMP_FORM: SnmpFormValues = {
  snmpVersion: '2c',
  snmpPort: '161',
  snmpCommunity: 'public',
  snmpWriteCommunity: '',
  snmpV3User: '',
  snmpV3SecurityLevel: 'authPriv',
  snmpV3AuthProtocol: 'sha',
  snmpV3AuthKey: '',
  snmpV3PrivProtocol: 'aes',
  snmpV3PrivKey: '',
};

/** Turn the form strings into the payload shape the API expects. */
export const toSnmpPayload = (form: SnmpFormValues) => ({
  snmpVersion: form.snmpVersion,
  snmpPort: Number(form.snmpPort) || 161,
  ...(form.snmpVersion === '2c'
    ? {
        snmpCommunity: form.snmpCommunity.trim() || 'public',
        ...(form.snmpWriteCommunity.trim() ? { snmpWriteCommunity: form.snmpWriteCommunity.trim() } : {}),
      }
    : {
        snmpV3User: form.snmpV3User.trim(),
        snmpV3SecurityLevel: form.snmpV3SecurityLevel,
        snmpV3AuthProtocol: form.snmpV3AuthProtocol,
        snmpV3AuthKey: form.snmpV3AuthKey,
        snmpV3PrivProtocol: form.snmpV3PrivProtocol,
        snmpV3PrivKey: form.snmpV3PrivKey,
      }),
});

const inputClass =
  'w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500';

interface SnmpFieldsProps {
  value: SnmpFormValues;
  onChange: (next: SnmpFormValues) => void;
  /** Hidden when editing, where a write community is set in its own section. */
  showWriteCommunity?: boolean;
  disabled?: boolean;
}

export const SnmpFields: React.FC<SnmpFieldsProps> = ({
  value,
  onChange,
  showWriteCommunity = true,
  disabled = false,
}) => {
  const { t } = useLanguage();
  const set = <K extends keyof SnmpFormValues>(key: K, next: SnmpFormValues[K]): void =>
    onChange({ ...value, [key]: next });

  const label = (text: string, required = false) => (
    <label className="block text-[11px] text-slate-600 dark:text-slate-400 mb-1 font-medium">
      {text}
      {required && <span className="text-rose-500"> *</span>}
    </label>
  );

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          {label(t('snmpVersion'), true)}
          <select
            value={value.snmpVersion}
            disabled={disabled}
            onChange={e => set('snmpVersion', e.target.value as '2c' | '3')}
            className={inputClass}
          >
            <option value="2c">SNMP v2c</option>
            <option value="3">SNMP v3</option>
          </select>
        </div>
        <div>
          {label(t('snmpPort'))}
          <input
            type="text"
            inputMode="numeric"
            value={value.snmpPort}
            disabled={disabled}
            onChange={e => set('snmpPort', e.target.value.replace(/[^0-9]/g, ''))}
            placeholder="161"
            className={`${inputClass} font-mono`}
          />
        </div>
      </div>

      {value.snmpVersion === '2c' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            {label(t('snmpCommunity'), true)}
            <input
              type="password"
              autoComplete="off"
              value={value.snmpCommunity}
              disabled={disabled}
              onChange={e => set('snmpCommunity', e.target.value)}
              placeholder="public"
              className={`${inputClass} font-mono`}
            />
            <p className="text-[10px] text-slate-400 mt-1">{t('snmpCommunityHint')}</p>
          </div>
          {showWriteCommunity && (
            <div>
              {label(t('snmpWriteCommunity'))}
              <input
                type="password"
                autoComplete="off"
                value={value.snmpWriteCommunity}
                disabled={disabled}
                onChange={e => set('snmpWriteCommunity', e.target.value)}
                placeholder={t('snmpOptional')}
                className={`${inputClass} font-mono`}
              />
              <p className="text-[10px] text-slate-400 mt-1">{t('snmpWriteCommunityHint')}</p>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              {label(t('snmpV3User'), true)}
              <input
                type="text"
                autoComplete="off"
                value={value.snmpV3User}
                disabled={disabled}
                onChange={e => set('snmpV3User', e.target.value)}
                placeholder="netmonitor-ro"
                className={`${inputClass} font-mono`}
              />
            </div>
            <div>
              {label(t('snmpV3Level'))}
              <select
                value={value.snmpV3SecurityLevel}
                disabled={disabled}
                onChange={e =>
                  set('snmpV3SecurityLevel', e.target.value as SnmpFormValues['snmpV3SecurityLevel'])
                }
                className={inputClass}
              >
                <option value="authPriv">authPriv ({t('snmpV3AuthPrivHint')})</option>
                <option value="authNoPriv">authNoPriv</option>
                <option value="noAuthNoPriv">noAuthNoPriv</option>
              </select>
            </div>
          </div>

          {value.snmpV3SecurityLevel !== 'noAuthNoPriv' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                {label(t('snmpV3AuthProtocol'))}
                <select
                  value={value.snmpV3AuthProtocol}
                  disabled={disabled}
                  onChange={e =>
                    set('snmpV3AuthProtocol', e.target.value as SnmpFormValues['snmpV3AuthProtocol'])
                  }
                  className={inputClass}
                >
                  <option value="sha">SHA-1</option>
                  <option value="sha256">SHA-256</option>
                  <option value="sha384">SHA-384</option>
                  <option value="sha512">SHA-512</option>
                  <option value="sha224">SHA-224</option>
                  <option value="md5">MD5</option>
                </select>
              </div>
              <div>
                {label(t('snmpV3AuthKey'), true)}
                <input
                  type="password"
                  autoComplete="off"
                  value={value.snmpV3AuthKey}
                  disabled={disabled}
                  onChange={e => set('snmpV3AuthKey', e.target.value)}
                  className={`${inputClass} font-mono`}
                />
              </div>
            </div>
          )}

          {value.snmpV3SecurityLevel === 'authPriv' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                {label(t('snmpV3PrivProtocol'))}
                <select
                  value={value.snmpV3PrivProtocol}
                  disabled={disabled}
                  onChange={e =>
                    set('snmpV3PrivProtocol', e.target.value as SnmpFormValues['snmpV3PrivProtocol'])
                  }
                  className={inputClass}
                >
                  <option value="aes">AES-128</option>
                  <option value="aes256b">AES-256 (Blumenthal)</option>
                  <option value="aes256r">AES-256 (Reeder)</option>
                  <option value="des">DES</option>
                </select>
              </div>
              <div>
                {label(t('snmpV3PrivKey'), true)}
                <input
                  type="password"
                  autoComplete="off"
                  value={value.snmpV3PrivKey}
                  disabled={disabled}
                  onChange={e => set('snmpV3PrivKey', e.target.value)}
                  className={`${inputClass} font-mono`}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------- probe result

interface SnmpTestPanelProps {
  isTesting: boolean;
  result: SnmpProbeResult | null;
  onTest: () => void;
  canTest: boolean;
}

/** The Test button plus whatever the device answered. */
export const SnmpTestPanel: React.FC<SnmpTestPanelProps> = ({ isTesting, result, onTest, canTest }) => {
  const { t } = useLanguage();

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={onTest}
        disabled={!canTest || isTesting}
        className="px-3.5 py-2 rounded-lg bg-slate-800 dark:bg-slate-700 hover:bg-slate-700 dark:hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-xs flex items-center gap-2 transition-colors"
      >
        {isTesting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Radio className="w-3.5 h-3.5" />}
        <span>{isTesting ? t('snmpTesting') : t('snmpTestButton')}</span>
      </button>

      {result && !result.reachable && (
        <div className="p-3 rounded-xl border bg-rose-50 dark:bg-rose-950/40 border-rose-300 dark:border-rose-800 text-rose-800 dark:text-rose-300 text-xs space-y-1">
          <div className="flex items-center gap-2 font-semibold">
            <XCircle className="w-4 h-4 text-rose-500 shrink-0" />
            <span>{t('snmpTestFailed')}</span>
          </div>
          <p className="text-[11px] leading-relaxed">{result.error}</p>
        </div>
      )}

      {result && result.reachable && (
        <div className="p-3 rounded-xl border bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 text-xs space-y-2">
          <div className="flex items-center gap-2 font-semibold">
            <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
            <span>
              {t('snmpTestOk')} ({result.responseMs} ms)
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] font-mono">
            <div>
              <span className="opacity-70 block">{t('cpu')}</span>
              {result.metrics.cpu}%
            </div>
            <div>
              <span className="opacity-70 block">{t('ram')}</span>
              {result.metrics.ram}%
            </div>
            <div>
              <span className="opacity-70 block">{t('uptime')}</span>
              {result.metrics.uptime}
            </div>
            <div>
              <span className="opacity-70 block">{t('ports')}</span>
              {result.portsUp}/{result.physicalPortCount}
            </div>
          </div>

          <p className="text-[11px] leading-relaxed opacity-90 break-words">{result.sysDescr}</p>

          {result.vlans.length > 0 && (
            <p className="text-[11px]">
              {t('snmpFoundVlans')}: {result.vlans.map(v => `${v.id} (${v.name})`).join(', ')}
            </p>
          )}

          {/* Metrics the agent refused, so a 0% reading on the dashboard is explained */}
          {result.missing.length > 0 && (
            <p className="text-[11px] text-amber-700 dark:text-amber-400">
              {t('snmpMissingMetrics')}: {result.missing.join(', ')}
            </p>
          )}
        </div>
      )}
    </div>
  );
};
