import { Component, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { Toaster } from 'sonner';
import { router } from '@/app/router/router';
import { bootstrapAuth } from '@/shared/api/auth-bootstrap';
import { useThemeStore } from '@/shared/lib/theme';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        if ((error as { status?: number })?.status === 401) return false;
        return failureCount < 1;
      },
      refetchOnWindowFocus: false,
    },
  },
});

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            height: '100dvh',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '12px',
            fontFamily: 'sans-serif',
            color: '#374151',
          }}
        >
          <p style={{ fontWeight: 600, fontSize: '16px' }}>Something went wrong</p>
          <p style={{ fontSize: '13px', color: '#6b7280' }}>
            {(this.state.error as Error).message}
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '6px 16px',
              border: '1px solid #d1d5db',
              borderRadius: '6px',
              cursor: 'pointer',
              background: '#fff',
              fontSize: '13px',
            }}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

/**
 * On first render, silently attempt to restore the session from the HttpOnly
 * refresh cookie before mounting the router. This prevents a flash-redirect to
 * /login on every page reload when the user still has a valid session.
 */
export function AppProviders() {
  const [ready, setReady] = useState(false);
  const resolvedTheme = useThemeStore((s) => s.resolved);

  useEffect(() => {
    bootstrapAuth().finally(() => setReady(true));
  }, []);

  if (!ready) {
    // Minimal full-screen loader — avoids flash of /login
    return (
      <div
        style={{
          display: 'flex',
          height: '100dvh',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--bg-page)',
        }}
      >
        <svg
          width="22"
          height="22"
          viewBox="0 0 22 22"
          fill="none"
          aria-label="Loading OpsHub"
        >
          <rect width="22" height="22" rx="5" fill="#2563eb" opacity="0.7" />
          <path
            d="M11 5.5C7.96 5.5 5.5 7.96 5.5 11s2.46 5.5 5.5 5.5 5.5-2.46 5.5-5.5S14.04 5.5 11 5.5Zm0 8.25a2.75 2.75 0 1 1 0-5.5 2.75 2.75 0 0 1 0 5.5Z"
            fill="white"
          />
        </svg>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
        <Toaster richColors position="top-right" theme={resolvedTheme} />
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

