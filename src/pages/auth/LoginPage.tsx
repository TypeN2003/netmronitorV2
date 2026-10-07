import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { useTheme } from '../../context/ThemeContext';
import { Activity, Lock, Mail, AlertCircle, Sun, Moon, ArrowRight, Loader2 } from 'lucide-react';

export const LoginPage: React.FC = () => {
  const { login } = useAuth();
  const { lang, setLang, t } = useLanguage();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();

  // Credentials are verified by the collector, so nothing is pre-filled here.
  // The first account comes from `npm run db:seed` on the server, or from Register
  // (the first registrant becomes Admin while no Admin exists).
  const [emailOrUser, setEmailOrUser] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);
    try {
      const res = await login(emailOrUser, password, rememberMe);
      if (res.success) navigate('/dashboard');
      else setError(res.error || 'Authentication failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 flex flex-col justify-between p-4 selection:bg-cyan-500/20 selection:text-cyan-300">
      {/* Top Bar with Language and Theme */}
      <div className="max-w-6xl w-full mx-auto flex items-center justify-between py-2">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-cyan-600 to-blue-600 flex items-center justify-center text-white shadow-md shadow-cyan-500/20">
            <Activity className="w-4 h-4 animate-pulse" />
          </div>
          <span className="font-bold tracking-tight text-slate-900 dark:text-white">NetMonitor NOC</span>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center bg-slate-100 dark:bg-slate-800 rounded-lg p-0.5 border border-slate-200 dark:border-slate-700">
            <button
              onClick={() => setLang('th')}
              className={`px-2 py-0.5 text-xs font-semibold rounded ${
                lang === 'th' ? 'bg-white dark:bg-slate-700 text-cyan-600 dark:text-cyan-400' : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              TH
            </button>
            <button
              onClick={() => setLang('en')}
              className={`px-2 py-0.5 text-xs font-semibold rounded ${
                lang === 'en' ? 'bg-white dark:bg-slate-700 text-cyan-600 dark:text-cyan-400' : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              EN
            </button>
          </div>
          <button
            onClick={toggleTheme}
            className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
          >
            {theme === 'dark' ? <Sun className="w-4 h-4 text-amber-600 dark:text-amber-400" /> : <Moon className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Main Login Card */}
      <div className="max-w-md w-full mx-auto my-auto py-8">
        <div className="bg-white dark:bg-slate-800/90 border border-slate-200 dark:border-slate-700/80 rounded-2xl p-6 sm:p-8 shadow-2xl backdrop-blur-md">
          <div className="text-center mb-6">
            <div className="inline-flex w-12 h-12 rounded-xl bg-cyan-50 dark:bg-cyan-950/60 border border-cyan-200 dark:border-cyan-800 text-cyan-600 dark:text-cyan-400 items-center justify-center mb-3">
              <Activity className="w-6 h-6 animate-pulse" />
            </div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-white">{t('loginTitle')}</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-sm mx-auto">{t('loginSubtitle')}</p>
          </div>

          {error && (
            <div className="mb-4 p-3 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/60 text-rose-700 dark:text-rose-300 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 dark:text-rose-400" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">{t('usernameOrEmail')}</label>
              <div className="relative">
                <Mail className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 dark:text-slate-400" />
                <input
                  type="text"
                  required
                  value={emailOrUser}
                  onChange={e => setEmailOrUser(e.target.value)}
                  placeholder="admin@netmonitor.internal"
                  className="w-full bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-slate-700 rounded-lg pl-9 pr-3 py-2 text-xs text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-cyan-500 focus:border-cyan-500 transition-all font-mono"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">{t('password')}</label>
                <Link
                  to="/forgot-password"
                  className="text-xs text-cyan-600 dark:text-cyan-400 hover:text-cyan-700 dark:hover:text-cyan-300 transition-colors hover:underline"
                >
                  {t('forgotPasswordLink')}
                </Link>
              </div>
              <div className="relative">
                <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 dark:text-slate-400" />
                <input
                  type="password"
                  required
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-slate-700 rounded-lg pl-9 pr-3 py-2 text-xs text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-cyan-500 focus:border-cyan-500 transition-all font-mono"
                />
              </div>
            </div>

            <div className="flex items-center">
              <input
                id="remember"
                type="checkbox"
                checked={rememberMe}
                onChange={e => setRememberMe(e.target.checked)}
                className="w-3.5 h-3.5 text-cyan-500 rounded bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-700 focus:ring-0"
              />
              <label htmlFor="remember" className="ml-2 text-xs text-slate-500 dark:text-slate-400">
                {t('rememberMe')}
              </label>
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-2.5 px-4 rounded-lg bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold text-xs tracking-wide shadow-md shadow-cyan-600/30 transition-all flex items-center justify-center gap-2"
            >
              <span>{isSubmitting ? t('signingIn') : t('loginButton')}</span>
              {isSubmitting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <ArrowRight className="w-3.5 h-3.5" />
              )}
            </button>
          </form>

          {/* First-run hint: where the very first account comes from */}
          <div className="mt-6 pt-5 border-t border-slate-200 dark:border-slate-700/80">
            <p className="text-[11px] text-slate-500 dark:text-slate-400 text-center leading-relaxed">
              {t('firstRunHint')}
            </p>
          </div>

          <div className="mt-5 text-center text-xs text-slate-500 dark:text-slate-400">
            {t('noAccount')}{' '}
            <Link to="/register" className="text-cyan-600 dark:text-cyan-400 hover:text-cyan-700 dark:hover:text-cyan-300 font-semibold underline underline-offset-2">
              {t('registerHere')}
            </Link>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="text-center py-4 text-xs text-slate-500 font-mono">
        NetMonitor v4.2-Enterprise · KMUTNB NOC Systems · ISO/IEC 27001 Certified
      </footer>
    </div>
  );
};
