/* eslint-disable */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import { AuthProvider, useAuth } from './context/AuthContext.tsx';
import { AppProvider } from './context/AppContext.tsx';
import { App } from './App.tsx';
import { Login } from './pages/Login.tsx';
import { LoadingScreen } from './components/LoadingScreen.tsx';
import { ApiError } from './services/apiClient.ts';
import './index.css';

const isAuthError = (error: unknown): boolean => {
  if (!error) return false;
  if (error instanceof ApiError) {
    return error.status === 401 || error.status === 403;
  }
  const status = (error as any)?.status;
  return status === 401 || status === 403;
};

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 30, // 30 seconds default
      refetchOnWindowFocus: true, // focus revalidation
      retry: (failureCount, error) => {
        // Do not retry 401 or 403 as transient network failures
        if (isAuthError(error)) {
          return false;
        }
        return failureCount < 1;
      },
    },
    mutations: {
      retry: (_failureCount, error) => {
        if (isAuthError(error)) {
          return false;
        }
        return false;
      },
    },
  },
});

const AuthenticatedApp = () => {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return <LoadingScreen />;
  }

  if (!user) {
    return <Login />;
  }

  return (
    <AppProvider key={user.id}>
      <App />
    </AppProvider>
  );
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AuthenticatedApp />
        <Toaster
          position="top-center"
          toastOptions={{
            duration: 3000,
            style: {
              padding: '16px',
              fontSize: '1.1rem',
            },
          }}
        />
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>
);
