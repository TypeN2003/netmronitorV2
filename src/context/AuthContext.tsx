import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { User, Role, UserPermissions } from '../types';
import { ApiError, api, setAuthToken, setUnauthorizedHandler } from '../services/api';

/**
 * Authentication against the collector.
 *
 * Passwords are verified server-side with bcrypt; the browser only ever holds a JWT.
 * Every mutating call is async — the previous localStorage build could answer
 * synchronously, a real server cannot.
 */
interface AuthResult {
  success: boolean;
  error?: string;
}

interface AuthContextType {
  currentUser: User | null;
  users: User[];
  /** True until the stored token has been checked against the server. */
  isRestoringSession: boolean;
  login: (emailOrUser: string, pass: string, remember?: boolean) => Promise<AuthResult>;
  register: (
    name: string,
    email: string,
    pass: string,
    department: string
  ) => Promise<AuthResult & { assignedRole?: Role }>;
  requestPasswordReset: (email: string) => Promise<AuthResult & { otp?: string }>;
  resetPassword: (email: string, otp: string, newPass: string) => Promise<AuthResult>;
  changePassword: (currentPass: string, newPass: string) => Promise<AuthResult>;
  logout: () => void;
  refreshUsers: () => Promise<void>;
  updateUserPermissions: (userId: string, perms: Partial<UserPermissions>) => Promise<AuthResult>;
  updateUserRole: (userId: string, role: Role) => Promise<AuthResult>;
  updateUserStatus: (userId: string, status: 'Active' | 'Suspended') => Promise<AuthResult>;
  deleteUser: (userId: string) => Promise<AuthResult>;
  createUser: (user: Omit<User, 'id' | 'createdAt' | 'lastLogin'>) => Promise<AuthResult>;
  activeOtpData: { email: string; otp: string; expiresAt: number } | null;
  isAdmin: boolean;
  isEngineer: boolean;
  isViewer: boolean;
  canAccessUsers: boolean;
  canAccessSettings: boolean;
}

const TOKEN_KEY = 'netmonitor_token';

/** The message shown when the request never reached the collector. */
const describe = (error: unknown): string => {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Unexpected error';
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [isRestoringSession, setIsRestoringSession] = useState<boolean>(true);
  const [activeOtpData, setActiveOtpData] = useState<{ email: string; otp: string; expiresAt: number } | null>(null);

  // "Remember me" puts the token in localStorage (survives the browser closing);
  // otherwise it lives in sessionStorage, so the tab closing ends the session.
  const persistToken = useCallback((token: string | null, remember: boolean): void => {
    localStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(TOKEN_KEY);
    setAuthToken(token);
    if (token) (remember ? localStorage : sessionStorage).setItem(TOKEN_KEY, token);
  }, []);

  const readStoredToken = (): { token: string | null; remembered: boolean } => {
    const remembered = localStorage.getItem(TOKEN_KEY);
    if (remembered) return { token: remembered, remembered: true };
    return { token: sessionStorage.getItem(TOKEN_KEY), remembered: false };
  };

  const clearSession = useCallback((): void => {
    persistToken(null, false);
    setCurrentUser(null);
    setUsers([]);
  }, [persistToken]);

  // Called by the API client on any 401, so an expired token drops straight to Login
  const clearSessionRef = useRef(clearSession);
  clearSessionRef.current = clearSession;
  useEffect(() => {
    setUnauthorizedHandler(() => clearSessionRef.current());
    return () => setUnauthorizedHandler(null);
  }, []);

  const refreshUsers = useCallback(async (): Promise<void> => {
    try {
      setUsers(await api.users.list());
    } catch (error) {
      // Only an Admin may list users; everyone else just has an empty list
      if (!(error instanceof ApiError && error.status === 403)) {
        console.warn('Could not load the user list:', describe(error));
      }
      setUsers([]);
    }
  }, []);

  /** Restore the session on page load: a stored token still has to be accepted by the server. */
  useEffect(() => {
    let cancelled = false;

    const restore = async (): Promise<void> => {
      // Legacy keys from the localStorage-only build; the data lives on the server now
      localStorage.removeItem('netmonitor_current_user');
      localStorage.removeItem('netmonitor_session');
      sessionStorage.removeItem('netmonitor_session');

      const { token } = readStoredToken();
      if (!token) {
        if (!cancelled) setIsRestoringSession(false);
        return;
      }

      setAuthToken(token);
      try {
        const { user } = await api.auth.me();
        if (cancelled) return;
        setCurrentUser(user);
        if (user.role === 'Admin') void refreshUsers();
      } catch {
        // Expired, revoked, or the server was rebuilt: start at Login
        if (!cancelled) clearSession();
      } finally {
        if (!cancelled) setIsRestoringSession(false);
      }
    };

    void restore();
    return () => {
      cancelled = true;
    };
  }, [clearSession, refreshUsers]);

  // ---------------------------------------------------------------- session

  const login = async (emailOrUser: string, pass: string, remember = false): Promise<AuthResult> => {
    try {
      const { token, user } = await api.auth.login(emailOrUser, pass);
      persistToken(token, remember);
      setCurrentUser(user);
      if (user.role === 'Admin') void refreshUsers();
      return { success: true };
    } catch (error) {
      return { success: false, error: describe(error) };
    }
  };

  const register = async (
    name: string,
    email: string,
    pass: string,
    department: string
  ): Promise<AuthResult & { assignedRole?: Role }> => {
    try {
      const { token, user, assignedRole } = await api.auth.register(name, email, pass, department);
      // A fresh registration is a deliberate sign-in, but not a "remember me"
      persistToken(token, false);
      setCurrentUser(user);
      if (user.role === 'Admin') void refreshUsers();
      return { success: true, assignedRole };
    } catch (error) {
      return { success: false, error: describe(error) };
    }
  };

  const requestPasswordReset = async (email: string): Promise<AuthResult & { otp?: string }> => {
    try {
      const { otp, expiresAt } = await api.auth.forgotPassword(email);
      // V1 has no mail transport, so the server hands the code back and the
      // Forgot Password screen shows it. Remove this once SMTP exists.
      setActiveOtpData({ email, otp, expiresAt });
      return { success: true, otp };
    } catch (error) {
      return { success: false, error: describe(error) };
    }
  };

  const resetPassword = async (email: string, otp: string, newPass: string): Promise<AuthResult> => {
    try {
      await api.auth.resetPassword(email, otp, newPass);
      setActiveOtpData(null);
      return { success: true };
    } catch (error) {
      return { success: false, error: describe(error) };
    }
  };

  const changePassword = async (currentPass: string, newPass: string): Promise<AuthResult> => {
    try {
      await api.auth.changePassword(currentPass, newPass);
      return { success: true };
    } catch (error) {
      return { success: false, error: describe(error) };
    }
  };

  const logout = (): void => {
    clearSession();
  };

  // ---------------------------------------------------------------- user administration

  /** Keep `currentUser` in step when an Admin edits their own account. */
  const applyUser = (updated: User): void => {
    setUsers(prev => prev.map(u => (u.id === updated.id ? updated : u)));
    setCurrentUser(prev => (prev && prev.id === updated.id ? updated : prev));
  };

  const updateUserPermissions = async (
    userId: string,
    perms: Partial<UserPermissions>
  ): Promise<AuthResult> => {
    try {
      applyUser(await api.users.update(userId, { permissions: perms }));
      return { success: true };
    } catch (error) {
      return { success: false, error: describe(error) };
    }
  };

  const updateUserRole = async (userId: string, role: Role): Promise<AuthResult> => {
    try {
      applyUser(await api.users.update(userId, { role }));
      return { success: true };
    } catch (error) {
      return { success: false, error: describe(error) };
    }
  };

  const updateUserStatus = async (userId: string, status: 'Active' | 'Suspended'): Promise<AuthResult> => {
    try {
      applyUser(await api.users.update(userId, { status }));
      return { success: true };
    } catch (error) {
      return { success: false, error: describe(error) };
    }
  };

  const deleteUser = async (userId: string): Promise<AuthResult> => {
    try {
      await api.users.remove(userId);
      setUsers(prev => prev.filter(u => u.id !== userId));
      return { success: true };
    } catch (error) {
      return { success: false, error: describe(error) };
    }
  };

  const createUser = async (userData: Omit<User, 'id' | 'createdAt' | 'lastLogin'>): Promise<AuthResult> => {
    if (!userData.password) {
      return { success: false, error: 'A password is required' };
    }
    try {
      const created = await api.users.create({
        name: userData.name,
        email: userData.email,
        password: userData.password,
        role: userData.role,
        department: userData.department,
        status: userData.status,
        permissions: userData.permissions,
      });
      setUsers(prev => [...prev, created]);
      return { success: true };
    } catch (error) {
      return { success: false, error: describe(error) };
    }
  };

  const role = currentUser?.role || 'Viewer';
  const isAdmin = role === 'Admin';
  const isEngineer = role === 'Engineer';
  const isViewer = role === 'Viewer';

  return (
    <AuthContext.Provider
      value={{
        currentUser,
        users,
        isRestoringSession,
        login,
        register,
        requestPasswordReset,
        resetPassword,
        changePassword,
        logout,
        refreshUsers,
        updateUserPermissions,
        updateUserRole,
        updateUserStatus,
        deleteUser,
        createUser,
        activeOtpData,
        isAdmin,
        isEngineer,
        isViewer,
        canAccessUsers: isAdmin,
        canAccessSettings: isAdmin || isEngineer,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
