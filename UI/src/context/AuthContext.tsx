/* eslint-disable */
import { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { apiClient, ApiError } from '../services/apiClient';

export interface User {
  id: number;
  username: string;
  display_name: string;
  role: 'office' | 'warehouse' | 'admin';
}

export interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  role: 'office' | 'warehouse' | 'admin' | null;
  isOffice: boolean;
  isWarehouse: boolean;
  isAdmin: boolean;
  hasRole: (roles: string[]) => boolean;
  login: (credentials: { username: string; password: string }) => Promise<void>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

type AuthProviderProps = {
  children: ReactNode;
};

export const AuthProvider = ({ children }: AuthProviderProps) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const queryClient = useQueryClient();
  const userRef = useRef<User | null>(null);
  const isHandlingUnauthorized = useRef(false);

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  const handleUnauthorized = useCallback((_error: ApiError) => {
    // Prevent multiple concurrent 401s from stacking toasts and repeatedly tearing down session
    if (!userRef.current && !isHandlingUnauthorized.current) {
      return;
    }
    if (isHandlingUnauthorized.current) {
      return;
    }
    isHandlingUnauthorized.current = true;
    userRef.current = null;

    void queryClient.cancelQueries();
    queryClient.clear();
    apiClient.resetSession();

    try {
      sessionStorage.clear();
    } catch {
      // ignore environments where sessionStorage is not available
    }

    setUser(null);
    toast.error('انتهت صلاحية الجلسة، يرجى تسجيل الدخول مجدداً.');

    setTimeout(() => {
      isHandlingUnauthorized.current = false;
    }, 500);
  }, [queryClient]);

  const checkAuth = useCallback(async () => {
    try {
      // Bootstrap CSRF and check current user
      const response = await apiClient.get<{ user: User }>('/auth/me', {
        skipAuthHandling: true,
      });
      if (response && response.user) {
        setUser(response.user);
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    apiClient.setOnUnauthorized(handleUnauthorized);
    checkAuth();

    return () => {
      apiClient.setOnUnauthorized(null);
    };
  }, [handleUnauthorized, checkAuth]);

  const login = async (credentials: { username: string; password: string }) => {
    // 1. Send login request
    const response = await apiClient.post<{ user: User; csrf_token: string }>(
      '/auth/login',
      credentials,
      { skipAuthHandling: true }
    );

    // 2. Clear old state, cancel old queries, and start fresh session
    try {
      sessionStorage.clear();
    } catch {
      // ignore
    }
    void queryClient.cancelQueries();
    queryClient.clear();
    apiClient.startSession(response.csrf_token);

    // 3. Set authenticated user
    userRef.current = response.user;
    setUser(response.user);
    toast.success(`مرحباً بك، ${response.user.display_name}`);
  };

  const logout = async () => {
    try {
      await apiClient.post('/auth/logout', {}, { skipAuthHandling: true });
    } catch (err) {
      console.warn('Backend logout request failed or network error:', err);
    } finally {
      userRef.current = null;
      void queryClient.cancelQueries();
      queryClient.clear();
      apiClient.resetSession();
      try {
        sessionStorage.clear();
      } catch {
        // ignore
      }
      setUser(null);
      toast.success('تم تسجيل الخروج بنجاح.');
    }
  };

  const role = user?.role || null;
  const isOffice = role === 'office' || role === 'admin';
  const isWarehouse = role === 'warehouse' || role === 'admin';
  const isAdmin = role === 'admin';

  const hasRole = (roles: string[]) => {
    if (!role) return false;
    if (role === 'admin') return true;
    return roles.includes(role);
  };

  const value: AuthContextType = {
    user,
    isLoading,
    isAuthenticated: !!user,
    role,
    isOffice,
    isWarehouse,
    isAdmin,
    hasRole,
    login,
    logout,
    checkAuth,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
