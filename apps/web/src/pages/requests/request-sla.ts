import type { RequestItemResponse } from '@/shared/api/types';

/** Hours left before an SLA counts as at risk. */
const AT_RISK_HOURS = 8;

/**
 * SLA state, derived rather than stored.
 *
 * Only an UNDECIDED request can be at risk: once it is approved or rejected the deadline stopped
 * mattering, and showing "due in 2h" beside a decided request reads as work still outstanding.
 * `slaBreachedAt` IS stored, because a breach is a fact about a moment rather than a comparison
 * against now — the SLA cron writes it.
 */
export function isSlaAtRisk(req: RequestItemResponse): boolean {
  if (!req.slaDeadline) return false;
  if (req.status !== 'pending' && req.status !== 'in_review') return false;
  const remaining = new Date(req.slaDeadline).getTime() - Date.now();
  return remaining > 0 && remaining < AT_RISK_HOURS * 3_600_000;
}

export function isSlaBreached(req: RequestItemResponse): boolean {
  return !!req.slaBreachedAt;
}
