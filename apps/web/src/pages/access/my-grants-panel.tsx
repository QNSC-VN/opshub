import { KeyRound, ShieldAlert } from 'lucide-react';
import { Badge, Button, RowActions, humanizeStatus } from '@/shared/ui';
import { formatDateTime, formatTimeUntil } from '@/shared/lib/format';
import { useMyGrants } from './use-access';
import type { AccessGrantResponse } from '@/shared/api/types';

/** Under an hour left. The point at which "renew or lose it" becomes the reader's next decision. */
const EXPIRING_SOON_MS = 3_600_000;

/**
 * The privileged access the reader currently holds.
 *
 * WHY THIS BELONGS AT THE TOP OF THIS SCREEN. The page was entirely about ASKING for elevation and said
 * nothing about what you already have — so the one question standing privileged access raises, "what am I
 * holding right now, and for how much longer", had no answer anywhere in the product. It is also the
 * question an ISO 27001 reviewer asks about A.8.2, and the reason these grants are time-boxed at all.
 *
 * RENDERS ONLY WHEN IT HAS SOMETHING TO SAY, like the supplier register's report banners. Most readers hold
 * nothing, and a permanent "you hold no privileged access" panel would be noise above the list they came
 * for — while its ABSENCE is the ordinary, correct state.
 *
 * REVOKING IS SECURITY'S, NOT THE HOLDER'S, and that asymmetry is the API's: `grants/me/active` is
 * `@SelfScoped` so anybody may read their own, but `grants/{grantId}/revoke` needs
 * `access_request.security_approve`. So a holder without that permission sees the panel read-only. Offering
 * them a button would be offering a 403, and inventing a "request revocation" flow would be inventing an
 * endpoint that does not exist — the honest answer is that the window lapses on its own.
 */
export function MyGrantsPanel({
  canRevoke,
  onRevoke,
}: {
  canRevoke: boolean;
  onRevoke: (grant: AccessGrantResponse) => void;
}) {
  const grants = useMyGrants();
  const rows = grants.data ?? [];
  /*
   * THE MOMENT THE SERVER ANSWERED, not `Date.now()`.
   *
   * The list IS the server's view as of `dataUpdatedAt` — `active` was decided against the database's clock
   * then — so measuring "how long left" from the same instant is the consistent reading. It is also what
   * keeps this render pure: `Date.now()` in a render body is what `react-hooks/purity` refuses, and the
   * minute refetch is what moves this forward.
   */
  const asOf = grants.dataUpdatedAt;

  // Nothing held, still loading, or the read failed: say nothing rather than claim anything. A failure here
  // must not read as "you hold no privileged access".
  if (rows.length === 0) return null;

  return (
    // The supplier register's report-banner idiom, unchanged: same border, same wash, same padding, so a
    // finding on one screen looks like a finding on another.
    <div className="mb-4 rounded-lg border border-warning bg-warning-bg/40 px-3 py-2.5">
      <p className="flex items-center gap-1.5 text-sm font-medium text-warning">
        <ShieldAlert className="h-4 w-4 shrink-0" strokeWidth={2} />
        You hold {rows.length} active privileged {rows.length === 1 ? 'grant' : 'grants'}
      </p>
      {/* Named as the standing exposure it is. Time-boxing is the control; knowing the box is closing is
          what makes it one. */}
      <p className="mt-0.5 text-xs text-fg-muted">
        Each lapses on its own when its window closes.
        {canRevoke && ' Hand one back early if the work is done.'}
      </p>

      <ul className="mt-2 flex flex-col gap-2">
        {rows.map((grant) => {
          const soon = new Date(grant.expiresAt).getTime() - asOf < EXPIRING_SOON_MS;
          return (
            <li
              key={grant.id}
              className="flex items-center gap-2 rounded-md border border-border bg-surface px-2.5 py-1.5"
            >
              <KeyRound
                className="h-4 w-4 shrink-0 text-fg-subtle"
                strokeWidth={1.75}
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-fg">
                  {humanizeStatus(grant.accessType)}
                </p>
                <p className="truncate font-mono text-xs text-fg-subtle">{grant.target}</p>
              </div>
              <span
                className="shrink-0 text-xs text-fg-subtle"
                title={formatDateTime(grant.expiresAt)}
              >
                {formatDateTime(grant.grantedAt)}
              </span>
              {/* The remaining budget, not the absolute instant — see `formatTimeUntil`. Amber under the
                  hour, because that is when it becomes a decision rather than a fact. */}
              <Badge tone={soon ? 'amber' : 'neutral'}>
                {formatTimeUntil(grant.expiresAt, asOf)}
              </Badge>
              {canRevoke && (
                <RowActions>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onRevoke(grant)}
                    aria-label={`Revoke ${humanizeStatus(grant.accessType)} on ${grant.target}`}
                  >
                    Revoke
                  </Button>
                </RowActions>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
