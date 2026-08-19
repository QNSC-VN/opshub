import { Checkbox } from '@/shared/ui';
import { useState, useEffect } from 'react';
import { ENV } from '@/shared/config/env';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock, LogIn, LogOut, Wifi, WifiOff } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/shared/lib/utils';
import { formatTime } from '@/shared/lib/format';
import { responseErrorMessage } from '@/shared/api/errors';
import { POLL } from '@/shared/api/cache';
import { sessionFetch } from '@/shared/api/session-fetch';

// ── Types ─────────────────────────────────────────────────────────────────────

interface AttendanceStatus {
  isClockedIn: boolean;
  current: {
    id: string;
    employeeId: string;
    clockedInAt: string;
    isRemote: boolean;
    notes: string | null;
  } | null;
}

// ── API ───────────────────────────────────────────────────────────────────────

async function fetchStatus(): Promise<AttendanceStatus> {
  const res = await sessionFetch(`${ENV.API_BASE_URL}/v1/workforce/attendance/status`);
  if (!res.ok) throw new Error('Failed to load attendance status');
  return res.json() as Promise<AttendanceStatus>;
}

async function clockIn(isRemote: boolean): Promise<void> {
  const res = await sessionFetch(`${ENV.API_BASE_URL}/v1/workforce/attendance/clock-in`, {
    method: 'POST',
    body: JSON.stringify({ isRemote }),
  });
  // "You are already clocked in" and "no shift today" are both refusals with a reason; showing a bare
  // "Failed to clock in" left somebody clicking the button again.
  if (!res.ok) throw new Error(await responseErrorMessage(res, 'Clock-in failed.'));
}

async function clockOut(): Promise<void> {
  const res = await sessionFetch(`${ENV.API_BASE_URL}/v1/workforce/attendance/clock-out`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error(await responseErrorMessage(res, 'Clock-out failed.'));
}

// ── Elapsed timer ─────────────────────────────────────────────────────────────

function useElapsed(clockedInAt: string | null) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!clockedInAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [clockedInAt]);

  const elapsed = clockedInAt
    ? Math.max(0, Math.floor((now - new Date(clockedInAt).getTime()) / 1000))
    : 0;

  const h = Math.floor(elapsed / 3600);
  const m = Math.floor((elapsed % 3600) / 60);
  const s = elapsed % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AttendanceClock() {
  const qc = useQueryClient();
  const [isRemote, setIsRemote] = useState(false);

  const statusQ = useQuery({
    queryKey: ['attendance', 'status'],
    queryFn: fetchStatus,
    refetchInterval: POLL.ACTIVITY,
  });

  const isClockedIn = statusQ.data?.isClockedIn ?? false;
  const current = statusQ.data?.current ?? null;
  const elapsed = useElapsed(isClockedIn ? (current?.clockedInAt ?? null) : null);

  const clockInMut = useMutation({
    mutationFn: () => clockIn(isRemote),
    onSuccess: () => {
      toast.success('Clocked in');
      void qc.invalidateQueries({ queryKey: ['attendance'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const clockOutMut = useMutation({
    mutationFn: clockOut,
    onSuccess: () => {
      toast.success('Clocked out');
      void qc.invalidateQueries({ queryKey: ['attendance'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const isPending = clockInMut.isPending || clockOutMut.isPending;

  return (
    <div
      className={cn(
        'flex flex-col gap-3 rounded-xl border p-4 transition-colors',
        isClockedIn
          ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-900/40 dark:bg-emerald-950/20'
          : 'border-border bg-surface',
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Clock
            className={cn('h-4 w-4', isClockedIn ? 'text-emerald-600' : 'text-fg-subtle')}
            strokeWidth={1.75}
          />
          <span className="text-xs font-medium uppercase tracking-wider text-fg-subtle">
            Attendance
          </span>
        </div>
        {isClockedIn && current?.isRemote && (
          <span className="flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
            <WifiOff className="h-3 w-3" /> Remote
          </span>
        )}
      </div>

      {/* Status / timer */}
      {statusQ.isLoading ? (
        <div className="h-8 animate-pulse rounded bg-surface-muted" />
      ) : isClockedIn ? (
        <div className="flex flex-col gap-0.5">
          <p className="text-2xl font-bold tabular-nums text-emerald-700 dark:text-emerald-400">
            {elapsed}
          </p>
          <p className="text-xs text-fg-subtle">Clocked in at {formatTime(current?.clockedInAt)}</p>
        </div>
      ) : (
        <p className="text-sm text-fg-muted">Not clocked in</p>
      )}

      {/* Actions */}
      {/* `size="sm"` keeps this compact in a widget rather than a form. The box itself changes: this
          copy had drifted to `border-border accent-accent` with NO focus ring, so it was the one
          checkbox in the product with no visible keyboard focus. */}
      {!isClockedIn && (
        <Checkbox
          size="sm"
          checked={isRemote}
          onChange={setIsRemote}
          label={
            <span className="inline-flex items-center gap-2">
              {isRemote ? (
                <Wifi className="h-3 w-3 text-blue-500" />
              ) : (
                <WifiOff className="h-3 w-3 text-fg-subtle" />
              )}
              Working remotely
            </span>
          }
        />
      )}

      <button
        onClick={() => (isClockedIn ? clockOutMut.mutate() : clockInMut.mutate())}
        disabled={isPending || statusQ.isLoading}
        className={cn(
          'flex w-full items-center justify-center gap-2 rounded-lg py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
          isClockedIn
            ? 'bg-red-500 text-white hover:bg-red-600'
            : 'bg-emerald-500 text-white hover:bg-emerald-600',
        )}
      >
        {isClockedIn ? (
          <>
            <LogOut className="h-4 w-4" /> Clock out
          </>
        ) : (
          <>
            <LogIn className="h-4 w-4" /> Clock in
          </>
        )}
      </button>
    </div>
  );
}
