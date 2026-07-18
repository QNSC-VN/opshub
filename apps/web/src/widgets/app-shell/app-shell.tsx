import { useEffect, useState, type ComponentType } from 'react';
import { ENV } from '@/shared/config/env';
import { Link, Outlet, useNavigate } from '@tanstack/react-router';
import {
  LayoutDashboard,
  Laptop,
  ShieldCheck,
  ShieldHalf,
  ScanLine,
  CalendarClock,
  Users,
  LogOut,
  ChevronRight,
  Webhook,
  Inbox,
  BarChart2,
  ShieldAlert,
  UserCog,
  BellRing,
  UserCircle2,
  Search,
  DollarSign,
  Package,
  Sparkles,
  PanelLeftClose,
  PanelLeft,
} from 'lucide-react';
import { AiChatPanel } from '@/widgets/ai-chat/ai-chat-panel';
import { useAuthStore, getToken } from '@/shared/api/auth-store';
import { attemptRefresh } from '@/shared/api/client';
import { resetBootstrap } from '@/shared/api/auth-bootstrap';
import { msalLogoutRedirect } from '@/app/auth/msal';
import { cn } from '@/shared/lib/utils';
import { NotificationBell } from '@/widgets/notifications/notification-bell';
import { CommandPalette } from '@/widgets/command-palette/command-palette';
import { useCommandPaletteStore } from '@/widgets/command-palette/use-command-palette';
import { useCurrentUser } from '@/shared/hooks/use-current-user';
import { usePermissions } from '@/shared/hooks/use-permissions';
import { ThemeToggle } from '@/shared/ui/theme-toggle';
import { FEATURES } from '@/shared/config/features';

interface NavItem {
  to: string;
  label: string;
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  /**
   * Backend permission key required to see this item (matches the keys in
   * db/seed.ts `PERMISSIONS`). Omit = always visible. The `'*'` wildcard held
   * by the `admin` role satisfies every gate via usePermissions().can().
   */
  cap?: string;
  /** Show an "Upgrade" badge when the feature is not available on current plan. */
  upgradeBadge?: boolean;
}

interface NavGroup {
  label?: string;
  items: NavItem[];
}

const navGroups: NavGroup[] = [
  {
    items: [{ to: '/', label: 'Overview', icon: LayoutDashboard }],
  },
  {
    label: 'Directory',
    items: [{ to: '/people', label: 'People', icon: Users, cap: 'employee.read' }],
  },
  {
    label: 'IT Operations',
    items: [
      { to: '/assets', label: 'Assets', icon: Laptop, cap: 'asset.read' },
      { to: '/access', label: 'Access Requests', icon: ShieldCheck, cap: 'access_request.read' },
      { to: '/compliance', label: 'Compliance', icon: ScanLine, cap: 'compliance.read' },
      { to: '/requests', label: 'Inbox', icon: Inbox },
      { to: '/finops', label: 'FinOps', icon: DollarSign, cap: 'compliance.read' },
      {
        to: '/security-posture',
        label: 'Security Posture',
        icon: ShieldHalf,
        cap: 'security.view',
        upgradeBadge: !FEATURES.SECURITY_POSTURE,
      },
    ],
  },
  {
    label: 'Self-Service',
    items: [{ to: '/catalog', label: 'IT Catalog', icon: Package }],
  },
  {
    label: 'Workforce',
    items: [{ to: '/workforce', label: 'Workforce', icon: CalendarClock }],
  },
  {
    label: 'Analytics',
    items: [{ to: '/reports', label: 'Reports', icon: BarChart2, cap: 'reports.read' }],
  },
  {
    label: 'Settings',
    items: [
      { to: '/settings/webhooks', label: 'Webhooks', icon: Webhook, cap: 'webhooks.manage' },
      { to: '/settings/access-control', label: 'Access Control', icon: UserCog, cap: 'rbac.read' },
      { to: '/settings/audit-logs', label: 'Audit Logs', icon: ShieldAlert, cap: 'audit.read' },
      { to: '/settings/notification-preferences', label: 'Notifications', icon: BellRing },
    ],
  },
];

function OpsHubMark() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
      <rect width="22" height="22" rx="5" fill="#2563eb" />
      <path
        d="M11 5.5C7.96 5.5 5.5 7.96 5.5 11s2.46 5.5 5.5 5.5 5.5-2.46 5.5-5.5S14.04 5.5 11 5.5Zm0 8.25a2.75 2.75 0 1 1 0-5.5 2.75 2.75 0 0 1 0 5.5Z"
        fill="white"
      />
    </svg>
  );
}

/** Avatar initials circle for the sidebar user footer. */
function AvatarChip({ name, email }: { name: string; email: string }) {
  const initials = name
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
  const colors = [
    'bg-blue-500',
    'bg-violet-500',
    'bg-emerald-500',
    'bg-amber-500',
    'bg-rose-500',
    'bg-cyan-500',
  ];
  const idx = [...email].reduce((acc, c) => acc + c.charCodeAt(0), 0) % colors.length;
  return (
    <span
      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${colors[idx]} text-[10px] font-semibold text-white`}
    >
      {initials || '?'}
    </span>
  );
}

/** Sidebar bottom — link to My Profile, shows current user name. */
function UserFooter() {
  const { data: me } = useCurrentUser();
  return (
    <Link
      to="/profile"
      className={cn(
        'group flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors',
        'text-sidebar-fg hover:bg-sidebar-hover hover:text-sidebar-fg-active',
      )}
      activeProps={{
        className:
          'group flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm bg-sidebar-active text-sidebar-fg-active',
      }}
    >
      {me ? (
        <AvatarChip name={me.name} email={me.email} />
      ) : (
        <UserCircle2 className="h-4 w-4 shrink-0" strokeWidth={1.75} />
      )}
      <span className="flex-1 truncate text-xs">{me?.name ?? 'My profile'}</span>
    </Link>
  );
}

export function AppShell() {
  const navigate = useNavigate();
  const clear = useAuthStore((s) => s.clear);
  const { data: me } = useCurrentUser();
  const { can } = usePermissions();
  const showPalette = useCommandPaletteStore((s) => s.show);
  const [aiOpen, setAiOpen] = useState(false);
  // Sidebar collapse — persisted so it survives reloads.
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem('opshub.sidebar.collapsed') === 'true',
  );
  const toggleSidebar = () =>
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem('opshub.sidebar.collapsed', String(next));
      return next;
    });

  // ── Global ⌘K / Ctrl+K listener ────────────────────────────────────────────
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        showPalette();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showPalette]);

  async function handleLogout() {
    // Read authMethod from the JWT before clear() nulls the in-memory token.
    let wasSSO = false;
    const token = getToken();
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]!)) as { authMethod?: string };
        wasSSO = payload.authMethod === 'sso';
      } catch {
        /* malformed token — treat as non-SSO */
      }
    }

    // The logout endpoint is @Auth-protected: it identifies the session from the
    // access token, revokes the session row and clears the refresh cookie. A bare
    // fetch without the Authorization header (or with an expired token) 401s, so
    // the server never revokes the session and the HttpOnly refresh cookie
    // survives — the next navigation would then silently re-authenticate. Attach
    // the token and, on 401, refresh once and retry so logout truly revokes.
    const postLogout = (bearer: string | null) =>
      fetch(`${ENV.API_BASE_URL}/v1/auth/logout`, {
        method: 'POST',
        credentials: 'include',
        headers: bearer ? { Authorization: `Bearer ${bearer}` } : undefined,
      });
    try {
      let res = await postLogout(token);
      if (res.status === 401) {
        const fresh = await attemptRefresh();
        if (fresh) res = await postLogout(fresh);
      }
    } catch {
      // best-effort
    }
    clear();
    resetBootstrap();

    if (wasSSO) {
      await msalLogoutRedirect(window.location.origin);
      return;
    }
    navigate({ to: '/login' });
  }

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      {!collapsed && (
        <aside className="flex w-56 shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
          {/* Logo + collapse toggle */}
          <div className="flex h-14 items-center gap-2.5 px-4 shrink-0">
            <OpsHubMark />
            <span className="text-sm font-semibold tracking-tight text-sidebar-fg-active">
              OpsHub
            </span>
            <button
              onClick={toggleSidebar}
              title="Hide sidebar"
              aria-label="Hide sidebar"
              className="ml-auto flex h-7 w-7 items-center justify-center rounded-md text-sidebar-fg transition-colors hover:bg-sidebar-hover hover:text-sidebar-fg-active"
            >
              <PanelLeftClose className="h-4 w-4" strokeWidth={1.75} />
            </button>
          </div>

          {/* Divider */}
          <div className="mx-4 h-px bg-sidebar-border" />

          {/* Nav */}
          <nav className="flex flex-1 flex-col gap-5 overflow-y-auto px-2 py-3">
            {navGroups.map((group, gi) => {
              const visibleItems = group.items.filter(({ cap }) => !cap || can(cap));
              if (visibleItems.length === 0) return null;
              return (
                <div key={gi} className="flex flex-col gap-0.5">
                  {group.label && (
                    <span className="px-2 pb-1 text-[10px] font-medium uppercase tracking-widest text-sidebar-label">
                      {group.label}
                    </span>
                  )}
                  {visibleItems.map(({ to, label, icon: Icon, upgradeBadge }) => (
                    <Link
                      key={to}
                      to={to}
                      activeOptions={{ exact: to === '/' }}
                      className={cn(
                        'group flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors',
                        'text-sidebar-fg hover:bg-sidebar-hover hover:text-sidebar-fg-active',
                      )}
                      activeProps={{
                        className:
                          'group flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm bg-sidebar-active text-sidebar-fg-active',
                      }}
                    >
                      <Icon className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                      <span className="flex-1">{label}</span>
                      {upgradeBadge ? (
                        <span className="rounded px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide bg-surface-muted text-fg-muted">
                          Upgrade
                        </span>
                      ) : (
                        <ChevronRight
                          className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-40"
                          strokeWidth={2}
                        />
                      )}
                    </Link>
                  ))}
                </div>
              );
            })}
          </nav>

          {/* Bottom: user footer */}
          <div className="mx-4 h-px bg-sidebar-border" />
          <div className="p-2 flex flex-col gap-0.5">
            {/* Profile link */}
            <UserFooter />
            {/* Sign out */}
            <button
              onClick={handleLogout}
              className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-sidebar-fg transition-colors hover:bg-sidebar-hover hover:text-sidebar-fg-active"
            >
              <LogOut className="h-4 w-4 shrink-0" strokeWidth={1.75} />
              Sign out
            </button>
          </div>
        </aside>
      )}

      {/* Main content */}
      <main className="flex min-w-0 flex-1 flex-col overflow-auto bg-page">
        {/* Top bar */}
        <div className="sticky top-0 z-20 flex h-12 shrink-0 items-center justify-between border-b border-border bg-surface/85 px-6 backdrop-blur supports-[backdrop-filter]:bg-surface/70">
          <div className="flex items-center gap-2">
            {collapsed && (
              <button
                type="button"
                onClick={toggleSidebar}
                title="Show sidebar"
                aria-label="Show sidebar"
                className="flex h-8 w-8 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
              >
                <PanelLeft className="h-4 w-4" strokeWidth={1.75} />
              </button>
            )}
            {/* ⌘K search trigger */}
            <button
              type="button"
              onClick={() => showPalette()}
              className="flex h-8 items-center gap-2 rounded-md border border-border bg-surface-muted px-3 text-sm text-fg-subtle transition-colors hover:border-border-strong hover:text-fg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
            >
              <Search className="h-3.5 w-3.5" strokeWidth={1.75} />
              <span className="hidden sm:inline">Search…</span>
              <kbd className="hidden rounded border border-border bg-surface px-1.5 py-0.5 text-[10px] text-fg-subtle sm:inline">
                ⌘K
              </kbd>
            </button>
          </div>

          <div className="flex items-center gap-2">
            <ThemeToggle />
            <NotificationBell />
            {FEATURES.AI_ASSISTANT && (
              <button
                type="button"
                onClick={() => setAiOpen(true)}
                title="AI Assistant"
                className="flex h-8 w-8 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
              >
                <Sparkles className="h-4 w-4" strokeWidth={1.75} />
              </button>
            )}
            {/* divider */}
            <div className="h-5 w-px bg-border" />
            <Link
              to="/profile"
              className="flex items-center gap-2 rounded-lg px-2 py-1 text-sm text-fg-muted hover:bg-surface-hover"
            >
              <UserCircle2 className="h-4 w-4 text-fg-subtle" strokeWidth={1.75} />
              <span className="text-xs font-medium text-fg-muted hidden sm:block">
                {me?.name ?? ''}
              </span>
            </Link>
          </div>
        </div>
        <div className="mx-auto w-full max-w-[1600px] px-6 py-7 md:px-8">
          <Outlet />
        </div>
      </main>

      {/* Command palette — rendered outside main so it overlays everything */}
      <CommandPalette />

      {/* AI Assistant panel */}
      {FEATURES.AI_ASSISTANT && <AiChatPanel open={aiOpen} onClose={() => setAiOpen(false)} />}
    </div>
  );
}
