import React from 'react';
import { Navigate, Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { ShieldAlert, ArrowLeft, Lock, Loader2 } from 'lucide-react';
import { Role } from '../../types';

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedRoles?: Role[];
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children, allowedRoles }) => {
  const { currentUser, isRestoringSession } = useAuth();
  const { t } = useLanguage();

  // On a page reload the stored token still has to be checked against the server.
  // Without this wait, every refresh would bounce a signed-in user to Login.
  if (isRestoringSession) {
    return (
      <div className="min-h-[80vh] flex flex-col items-center justify-center gap-3 p-4">
        <Loader2 className="w-7 h-7 text-cyan-500 animate-spin" />
        <p className="text-xs text-slate-500 dark:text-slate-400">{t('restoringSession')}</p>
      </div>
    );
  }

  if (!currentUser) {
    return <Navigate to="/login" replace />;
  }

  if (allowedRoles && !allowedRoles.includes(currentUser.role)) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center p-4">
        <div className="bg-white dark:bg-slate-900 border border-rose-200 dark:border-rose-900/60 rounded-2xl max-w-lg w-full p-8 shadow-2xl text-center space-y-4">
          <div className="w-16 h-16 rounded-2xl bg-rose-50 dark:bg-rose-950/60 border border-rose-300 dark:border-rose-800 text-rose-500 mx-auto flex items-center justify-center shadow-lg shadow-rose-500/20">
            <ShieldAlert className="w-8 h-8" />
          </div>

          <div className="space-y-1.5">
            <h2 className="text-xl font-bold text-slate-900 dark:text-white">
              {t('accessDeniedTitle')}
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              {t('accessDeniedMessage')}{' '}
              <span className="font-mono font-bold text-rose-500 uppercase px-1.5 py-0.5 rounded bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800">
                {currentUser.role}
              </span>
            </p>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/60 text-left text-xs space-y-1 font-mono text-slate-600 dark:text-slate-400">
            <div className="flex items-center gap-1.5 text-slate-800 dark:text-slate-200 font-semibold">
              <Lock className="w-3.5 h-3.5 text-rose-500" />
              <span>Security Policy Enforcement:</span>
            </div>
            <div>• Required Clearance: <strong className="text-cyan-500">{allowedRoles.join(' or ')}</strong></div>
            <div>• Current User: <strong className="text-slate-800 dark:text-slate-200">{currentUser.name}</strong> ({currentUser.email})</div>
            <div>• Action: Access Attempt Logged to Syslog Core</div>
          </div>

          <div className="pt-2">
            <Link
              to="/dashboard"
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-semibold text-xs transition-colors shadow-xs"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>{t('returnToDashboard')}</span>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};
