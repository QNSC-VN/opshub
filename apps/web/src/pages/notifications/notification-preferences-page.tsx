/**
 * NotificationPreferencesPage
 *
 * Allows the authenticated user to configure per-event-type notification
 * delivery channels (in-app and email).
 *
 * API:
 *   GET    /v1/notifications/preferences            → list explicit overrides
 *   PUT    /v1/notifications/preferences/:type      → upsert a preference
 *   DELETE /v1/notifications/preferences/:type      → reset to default
 *
 * Design decisions:
 *   - Preferences are shown as a grouped table with toggle switches.
 *   - Unset (default) rows show both channels as ON; a visual indicator
 *     differentiates "explicitly enabled" from "default enabled".
 *   - A global wildcard (*) row at the top acts as a master kill-switch.
 *   - Optimistic UI: toggle is updated immediately, rolled back on error.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Bell, Mail, RotateCcw, BellOff } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/shared/api/client';
import type { components } from '@/shared/api/generated/api';

type PreferenceDto = components['schemas']['PreferenceResponseDto'];

// ── Event type catalog ────────────────────────────────────────────────────────
// Grouped by domain for display. The '*' wildcard is rendered separately.

interface EventEntry {
  type: string;
  label: string;
}

interface EventGroup {
  group: string;
  events: EventEntry[];
}

const EVENT_GROUPS: EventGroup[] = [
  {
    group: 'Requests',
    events: [
      { type: 'request.approved', label: 'Request approved' },
      { type: 'request.rejected', label: 'Request rejected' },
      { type: 'request.cancelled', label: 'Request cancelled' },
      { type: 'request.comment_added', label: 'Comment added on request' },
    ],
  },
  {
    group: 'Access',
    events: [
      { type: 'access_request.submitted', label: 'Access request submitted' },
      { type: 'access_request.approved', label: 'Access request approved' },
      { type: 'access_request.rejected', label: 'Access request rejected' },
      { type: 'access_grant.revoked', label: 'Access grant revoked' },
    ],
  },
  {
    group: 'Assets',
    events: [
      { type: 'asset.assigned', label: 'Asset assigned to you' },
      { type: 'asset.unassigned', label: 'Asset unassigned from you' },
      { type: 'asset.retired', label: 'Asset retired' },
    ],
  },
  {
    group: 'Compliance',
    events: [
      { type: 'compliance.finding_acknowledged', label: 'Finding acknowledged' },
      { type: 'compliance.finding_resolved', label: 'Finding resolved' },
      { type: 'compliance.software_added', label: 'Software added' },
    ],
  },
  {
    group: 'Workforce',
    events: [
      { type: 'workforce.leave_requested', label: 'Leave requested' },
      { type: 'workforce.leave_cancelled', label: 'Leave cancelled' },
      { type: 'workforce.overtime_logged', label: 'Overtime logged' },
      { type: 'workforce.onboarding_submitted', label: 'Onboarding submitted' },
      { type: 'workforce.offboarding_submitted', label: 'Offboarding submitted' },
    ],
  },
];

// ── Toggle switch ─────────────────────────────────────────────────────────────

interface ToggleProps {
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
  label?: string;
}

function Toggle({ checked, disabled = false, onChange, label }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={[
        'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1',
        disabled ? 'cursor-not-allowed opacity-40' : '',
        checked ? 'bg-accent' : 'bg-surface-hover',
      ].join(' ')}
    >
      <span
        className={[
          'pointer-events-none block h-4 w-4 rounded-full bg-surface shadow-sm transition-transform',
          checked ? 'translate-x-4' : 'translate-x-0',
        ].join(' ')}
      />
    </button>
  );
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

function usePreferences() {
  return useQuery<PreferenceDto[]>({
    queryKey: ['notification-preferences'],
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/notifications/preferences');
      if (error || !data) throw new Error('Failed to load preferences');
      return data as PreferenceDto[];
    },
  });
}

// ── Preference row logic ──────────────────────────────────────────────────────

/**
 * Merge explicit prefs with the "all-on" default.
 * Returns {inApp, email, isDefault} for any event type.
 */
function resolve(
  type: string,
  explicitPrefs: PreferenceDto[],
  wildcard: PreferenceDto | undefined,
): { inApp: boolean; email: boolean; isDefault: boolean } {
  const exact = explicitPrefs.find((p) => p.type === type);
  if (exact) return { inApp: exact.inApp, email: exact.email, isDefault: false };
  // Apply wildcard override if present
  if (wildcard) return { inApp: wildcard.inApp, email: wildcard.email, isDefault: false };
  return { inApp: true, email: true, isDefault: true };
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function NotificationPreferencesPage() {
  const qc = useQueryClient();
  const { data: prefs, isLoading } = usePreferences();
  const [pending, setPending] = useState<Set<string>>(new Set());

  const explicit = prefs ?? [];
  const wildcard = explicit.find((p) => p.type === '*');

  const invalidate = () => qc.invalidateQueries({ queryKey: ['notification-preferences'] });

  async function handleToggle(type: string, channel: 'inApp' | 'email', newValue: boolean) {
    if (pending.has(`${type}-${channel}`)) return;

    // Resolve current values
    const current = resolve(type, explicit, wildcard);
    const nextInApp = channel === 'inApp' ? newValue : current.inApp;
    const nextEmail = channel === 'email' ? newValue : current.email;

    setPending((s) => new Set(s).add(`${type}-${channel}`));

    // Optimistically update query cache
    qc.setQueryData<PreferenceDto[]>(['notification-preferences'], (old = []) => {
      const filtered = old.filter((p) => p.type !== type);
      return [
        ...filtered,
        { type, inApp: nextInApp, email: nextEmail, updatedAt: new Date().toISOString() },
      ];
    });

    const { error } = await api.PUT('/v1/notifications/preferences/{type}', {
      params: { path: { type } },
      body: { inApp: nextInApp, email: nextEmail },
    });

    setPending((s) => {
      const next = new Set(s);
      next.delete(`${type}-${channel}`);
      return next;
    });

    if (error) {
      toast.error('Failed to save preference');
      invalidate(); // rollback
    }
  }

  async function handleReset(type: string) {
    const { error } = await api.DELETE('/v1/notifications/preferences/{type}', {
      params: { path: { type } },
    });
    if (error) {
      toast.error('Failed to reset preference');
      return;
    }
    toast.success('Reset to default');
    invalidate();
  }

  async function handleWildcard(channel: 'inApp' | 'email', newValue: boolean) {
    const currentWildcard = wildcard ?? { inApp: true, email: true };
    const nextInApp = channel === 'inApp' ? newValue : currentWildcard.inApp;
    const nextEmail = channel === 'email' ? newValue : currentWildcard.email;

    // Optimistically
    qc.setQueryData<PreferenceDto[]>(['notification-preferences'], (old = []) => {
      const filtered = old.filter((p) => p.type !== '*');
      return [
        ...filtered,
        { type: '*', inApp: nextInApp, email: nextEmail, updatedAt: new Date().toISOString() },
      ];
    });

    const { error } = await api.PUT('/v1/notifications/preferences/{type}', {
      params: { path: { type: '*' } },
      body: { inApp: nextInApp, email: nextEmail },
    });

    if (error) {
      toast.error('Failed to update global preference');
      invalidate();
    }
  }

  async function resetWildcard() {
    const { error } = await api.DELETE('/v1/notifications/preferences/{type}', {
      params: { path: { type: '*' } },
    });
    if (error) {
      toast.error('Failed to reset');
      return;
    }
    invalidate();
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      {/* Header */}
      <div>
        <h1 className="text-lg font-semibold tracking-tight text-fg">Notification Preferences</h1>
        <p className="mt-0.5 text-sm text-fg-muted">
          Choose how you receive notifications for each event type. Defaults are both in-app and
          email enabled.
        </p>
      </div>

      {isLoading && (
        <div className="rounded-xl border border-border bg-surface px-5 py-10 text-center text-sm text-fg-subtle">
          Loading…
        </div>
      )}

      {!isLoading && (
        <>
          {/* Global override */}
          <div className="rounded-xl border border-blue-100 bg-accent-muted/60 p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  {wildcard && (!wildcard.inApp || !wildcard.email) ? (
                    <BellOff className="h-4 w-4 text-warning" strokeWidth={1.75} />
                  ) : (
                    <Bell className="h-4 w-4 text-accent" strokeWidth={1.75} />
                  )}
                  <p className="text-sm font-semibold text-fg">Global override</p>
                </div>
                <p className="mt-0.5 text-xs text-fg-muted">
                  Disabling a channel here overrides all per-event settings below. Use this as a
                  master mute switch.
                </p>
              </div>
              <div className="flex items-center gap-6 shrink-0 pt-0.5">
                <div className="flex flex-col items-center gap-1">
                  <Bell className="h-3.5 w-3.5 text-fg-muted" strokeWidth={1.75} />
                  <span className="text-[10px] text-fg-subtle">In-app</span>
                  <Toggle
                    checked={wildcard?.inApp ?? true}
                    onChange={(v) => handleWildcard('inApp', v)}
                    label="Global in-app toggle"
                  />
                </div>
                <div className="flex flex-col items-center gap-1">
                  <Mail className="h-3.5 w-3.5 text-fg-muted" strokeWidth={1.75} />
                  <span className="text-[10px] text-fg-subtle">Email</span>
                  <Toggle
                    checked={wildcard?.email ?? true}
                    onChange={(v) => handleWildcard('email', v)}
                    label="Global email toggle"
                  />
                </div>
                {wildcard && (
                  <button
                    onClick={resetWildcard}
                    className="flex items-center gap-1 text-xs text-fg-subtle hover:text-fg-muted pt-4"
                    title="Reset global override"
                  >
                    <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.75} />
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Per-event groups */}
          {EVENT_GROUPS.map((grp) => (
            <div
              key={grp.group}
              className="rounded-xl border border-border bg-surface overflow-hidden"
            >
              {/* Group header */}
              <div className="grid grid-cols-[1fr_80px_80px_36px] items-center gap-2 border-b border-border bg-surface-muted px-5 py-2.5">
                <p className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
                  {grp.group}
                </p>
                <div className="flex items-center justify-center gap-1">
                  <Bell className="h-3.5 w-3.5 text-fg-subtle" strokeWidth={1.75} />
                  <span className="text-[10px] text-fg-subtle">In-app</span>
                </div>
                <div className="flex items-center justify-center gap-1">
                  <Mail className="h-3.5 w-3.5 text-fg-subtle" strokeWidth={1.75} />
                  <span className="text-[10px] text-fg-subtle">Email</span>
                </div>
                <div />
              </div>

              {/* Rows */}
              <div className="divide-y divide-border">
                {grp.events.map(({ type, label }) => {
                  const resolved = resolve(type, explicit, wildcard);
                  // Global wildcard disables the per-row toggles
                  const blockedByWildcard = !!wildcard && (!wildcard.inApp || !wildcard.email);
                  const inAppDisabled = !!wildcard && !wildcard.inApp;
                  const emailDisabled = !!wildcard && !wildcard.email;

                  return (
                    <div
                      key={type}
                      className={`grid grid-cols-[1fr_80px_80px_36px] items-center gap-2 px-5 py-3 ${blockedByWildcard ? 'opacity-60' : ''}`}
                    >
                      <div>
                        <p className="text-sm text-fg">{label}</p>
                        <p className="text-[10px] font-mono text-fg-subtle">{type}</p>
                      </div>
                      <div className="flex justify-center">
                        <Toggle
                          checked={resolved.inApp}
                          disabled={inAppDisabled || pending.has(`${type}-inApp`)}
                          onChange={(v) => handleToggle(type, 'inApp', v)}
                          label={`${label} in-app toggle`}
                        />
                      </div>
                      <div className="flex justify-center">
                        <Toggle
                          checked={resolved.email}
                          disabled={emailDisabled || pending.has(`${type}-email`)}
                          onChange={(v) => handleToggle(type, 'email', v)}
                          label={`${label} email toggle`}
                        />
                      </div>
                      <div className="flex justify-center">
                        {!resolved.isDefault && (
                          <button
                            onClick={() => handleReset(type)}
                            title="Reset to default"
                            className="rounded p-1 text-fg-subtle hover:text-fg-muted"
                          >
                            <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.75} />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
