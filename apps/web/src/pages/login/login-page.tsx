import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';
import { api } from '@/shared/api/client';
import { useAuthStore } from '@/shared/api/auth-store';

function OpsHubMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <rect width="32" height="32" rx="7" fill="#2563eb" />
      <path
        d="M16 7C11.03 7 7 11.03 7 16s4.03 9 9 9 9-4.03 9-9-4.03-9-9-9Zm0 13.5A4.5 4.5 0 1 1 16 11.5a4.5 4.5 0 0 1 0 9Z"
        fill="white"
      />
    </svg>
  );
}

/**
 * Dev-only login page — only reached when VITE_ENTRA_TENANT_ID / CLIENT_ID are
 * not configured. In production the router's beforeLoad calls triggerLogin() and
 * redirects the user straight to Microsoft before this page ever renders.
 */
export function LoginPage() {
  const navigate = useNavigate();
  const setToken = useAuthStore((s) => s.setToken);
  const [email, setEmail] = useState('admin@opshub.local');
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const { data, error } = await api.POST('/v1/auth/dev-login', { body: { email } });
    setLoading(false);
    if (error || !data) {
      toast.error('Login failed. Is the API running on :3000?');
      return;
    }
    setToken(data.accessToken);
    navigate({ to: '/' });
  }

  return (
    <div className="flex min-h-[100dvh]">
      {/* Left: brand panel (always dark) */}
      <div className="hidden w-[400px] shrink-0 flex-col justify-between bg-sidebar p-10 lg:flex">
        <div className="flex items-center gap-3">
          <OpsHubMark size={32} />
          <span className="text-base font-semibold tracking-tight text-sidebar-fg-active">OpsHub</span>
        </div>
        <div className="flex flex-col gap-6">
          <div>
            <h1 className="text-2xl font-semibold leading-snug tracking-tight text-sidebar-fg-active">
              Internal Ops Platform
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-sidebar-fg">
              One portal for IT and HR to manage the full lifecycle of employees,
              devices, software, access, and time.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {['People', 'Devices', 'Access', 'Compliance', 'Workforce'].map((tag) => (
              <span
                key={tag}
                className="rounded-md border border-sidebar-border px-2.5 py-1 text-xs text-sidebar-fg"
              >
                {tag}
              </span>
            ))}
          </div>
        </div>
        <p className="text-xs text-sidebar-label">
          Development environment — set VITE_ENTRA_TENANT_ID to enable SSO.
        </p>
      </div>

      {/* Right: dev login form */}
      <div className="flex flex-1 flex-col items-center justify-center bg-surface px-6 py-12">
        <div className="mb-8 flex items-center gap-2.5 lg:hidden">
          <OpsHubMark size={28} />
          <span className="text-base font-semibold tracking-tight text-fg">OpsHub</span>
        </div>

        <div className="w-full max-w-[360px]">
          <div className="mb-7">
            <h2 className="text-lg font-semibold tracking-tight text-fg">Dev sign in</h2>
            <p className="mt-1 text-sm text-fg-muted">
              No password required. Uses seeded employees only.
            </p>
          </div>

          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="login-email" className="text-xs font-medium text-fg-muted">Email</label>
              <input
                id="login-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-9 w-full rounded-md border border-border bg-surface px-3 text-sm text-fg placeholder:text-fg-subtle transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                placeholder="user@opshub.local"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="mt-1 h-9 w-full rounded-md bg-accent text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-accent/40 focus:ring-offset-1 focus:ring-offset-surface"
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
