import { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock, LogIn, LogOut, Wifi, WifiOff } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/shared/lib/utils';
import { getToken } from '@/shared/api/auth-store';

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

const headers = () => ({ Authorization: `Bearer ${getToken() ?? ''}`, 'Content-Type': 'application/json' });

async function fetchStatus(): Promise<AttendanceStatus> {
  const res = await fetch('/v1/workforce/attendance/status', { headers: headers() });
  if (!res.ok) throw new Error('Failed to load attendance status');
  return res.json() as Promise<AttendanceStatus>;
}

async function clockIn(isRemote: boolean): Promise<void> {
  const res = await fetch('/v1/workforce/attendance/clock-in', {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ isRemote }),
  });
  if (!res.ok) throw new Error('Clock-in failed');
}

async function clockOut(): Promise<void> {
  const res = await fetch('/v1/workforce/attendance/clock-out', {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error('Clock-out failed');
}

// ── Elapsed timer ─────────────────────────────────────────────────────────────

function useElapsed(clockedInAt: string | null) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!clockedInAt) { setElapsed(0); return; }
    const start = new Date(clockedInAt).getTime();

    function tick() {
      setElapsed(Math.floor((Date.now() - start) / 1000));
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [clockedInAt]);

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
    refetchInterval: 60_000,
  });

  const isClockedIn = statusQ.data?.isClockedIn ?? false;
  const current = statusQ.data?.current ?? null;
  const elapsed = useElapsed(isClockedIn ? current?.clockedInAt ?? null : null);

  const clockInMut = useMutation({
    mutationFn: () => clockIn(isRemote),
    onSuccess: () => {
      toast.success('Clocked in');
      void qc.invalidateQueries({ queryKey: ['attendance'] });
    },
    onError: () => toast.error('Failed to clock in'),
  });

  const clockOutMut = useMutation({
    mutationFn: clockOut,
    onSuccess: () => {
      toast.success('Clocked out');
      void qc.invalidateQueries({ queryKey: ['attendance'] });
    },
    onError: () => toast.error('Failed to clock out'),
  });

  const isPending = clockInMut.isPending || clockOutMut.isPending;

  return (
    <div className={cn(
      'flex flex-col gap-3 rounded-xl border p-4 transition-colors',
      isClockedIn
        ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-900/40 dark:bg-emerald-950/20'
        : 'border-border bg-surface',
    )}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Clock className={cn('h-4 w-4', isClockedIn ? 'text-emerald-600' : 'text-fg-subtle')} strokeWidth={1.75} />
          <span className="text-xs font-medium uppercase tracking-wider text-fg-subtle">Attendance</span>
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
          <p className="text-2xl font-bold tabular-nums text-emerald-700 dark:text-emerald-400">{elapsed}</p>
          <p className="text-xs text-fg-subtle">
            Clocked in at {current ? new Date(current.clockedInAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
          </p>
        </div>
      ) : (
        <p className="text-sm text-fg-muted">Not clocked in</p>
      )}

      {/* Actions */}
      {!isClockedIn && (
        <label className="flex cursor-pointer items-center gap-2 text-xs text-fg-muted">
          <input
            type="checkbox"
            checked={isRemote}
            onChange={(e) => setIsRemote(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-border accent-accent"
          />
          {isRemote ? <Wifi className="h-3 w-3 text-blue-500" /> : <WifiOff className="h-3 w-3 text-fg-subtle" />}
          Working remotely
        </label>
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
          <><LogOut className="h-4 w-4" /> Clock out</>
        ) : (
          <><LogIn className="h-4 w-4" /> Clock in</>
        )}
      </button>
    </div>
  );
}
