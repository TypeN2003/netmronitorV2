import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { Activity, Mail, ArrowRight, CheckCircle2, AlertCircle, KeyRound, ArrowLeft } from 'lucide-react';

export const ForgotPasswordPage: React.FC = () => {
  const { requestPasswordReset } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [generatedOtp, setGeneratedOtp] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);
    try {
      const res = await requestPasswordReset(email);
      if (res.success && res.otp) {
        setGeneratedOtp(res.otp);
      } else {
        setError(res.error || 'Failed to dispatch recovery instructions');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 flex flex-col justify-between p-4 selection:bg-cyan-500/20 selection:text-cyan-300">
      <div className="max-w-md w-full mx-auto my-auto py-8">
        <div className="bg-white dark:bg-slate-800/90 border border-slate-200 dark:border-slate-700/80 rounded-2xl p-6 sm:p-8 shadow-2xl backdrop-blur-md">
          <div className="text-center mb-6">
            <div className="inline-flex w-12 h-12 rounded-xl bg-cyan-50 dark:bg-cyan-950/60 border border-cyan-200 dark:border-cyan-800 text-cyan-600 dark:text-cyan-400 items-center justify-center mb-3">
              <KeyRound className="w-6 h-6" />
            </div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-white">{t('forgotTitle')}</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{t('forgotSubtitle')}</p>
          </div>

          {error && (
            <div className="mb-4 p-3 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/60 text-rose-700 dark:text-rose-300 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 dark:text-rose-400" />
              <span>{error}</span>
            </div>
          )}

          {generatedOtp ? (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 text-emerald-700 dark:text-emerald-300 text-xs">
                <div className="flex items-center gap-2 font-semibold text-emerald-700 dark:text-emerald-300 mb-1">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>{t('resetEmailSent')}</span>
                </div>
                <p className="text-slate-700 dark:text-slate-300 text-[11px] mb-3">
                  Simulation: Recovery link & OTP has been dispatched to <strong>{email}</strong>
                </p>
                <div className="p-2.5 bg-slate-900/80 rounded-lg border border-slate-200 dark:border-slate-700 text-center font-mono">
                  <span className="text-slate-500 dark:text-slate-400 text-[10px] block">SECURITY OTP TOKEN</span>
                  <span className="text-lg font-bold text-cyan-600 dark:text-cyan-400 tracking-wider">{generatedOtp}</span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => navigate(`/reset-password?email=${encodeURIComponent(email)}&otp=${generatedOtp}`)}
                className="w-full py-2.5 px-4 rounded-lg bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-semibold text-xs tracking-wide shadow-md shadow-cyan-600/30 transition-all flex items-center justify-center gap-2"
              >
                <span>{t('proceedToReset')}</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">{t('userEmail')}</label>
                <div className="relative">
                  <Mail className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 dark:text-slate-400" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="admin@netmonitor.internal"
                    className="w-full bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-slate-700 rounded-lg pl-9 pr-3 py-2 text-xs text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-cyan-500 font-mono"
                  />
                </div>
                <span className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 block">
                  Tip: Use default test accounts e.g. <code className="text-cyan-600 dark:text-cyan-400 font-mono">admin@netmonitor.internal</code>
                </span>
              </div>

              <button
                type="submit"
                className="w-full py-2.5 px-4 rounded-lg bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-semibold text-xs tracking-wide shadow-md shadow-cyan-600/30 transition-all flex items-center justify-center gap-2"
              >
                <span>{t('sendResetLink')}</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </form>
          )}

          <div className="mt-5 text-center text-xs text-slate-500 dark:text-slate-400">
            <Link to="/login" className="inline-flex items-center gap-1.5 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors">
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>{t('backToLogin')}</span>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};
