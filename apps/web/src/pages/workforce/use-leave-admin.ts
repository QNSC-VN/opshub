import { useQuery } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import { STALE } from '@/shared/api/cache';
import type { components } from '@/shared/api/generated/api';

/**
 * The reads behind leave balances, the holiday calendar and the accrual policies.
 *
 * Keys start `['workforce', 'leave', …]` with the leave list, because these numbers ARE that list read a
 * different way: approving a request moves the balance, and setting an entitlement changes what the same
 * request would be allowed. One prefix means one invalidation instead of a balance that disagrees with the
 * requests it was computed from.
 */

export type LeaveBalance = components['schemas']['LeaveBalanceResponseDto'];
export type LeavePolicy = components['schemas']['LeavePolicyResponseDto'];
export type Holiday = components['schemas']['HolidayResponseDto'];
export type CarryOverResult = components['schemas']['CarryOverResultResponseDto'];

/** The leave types an entitlement can be set for. */
export const LEAVE_TYPES = ['annual', 'sick', 'unpaid', 'parental', 'other'] as const;

/**
 * Balances for one employee and year.
 *
 * `employeeId` OMITTED means the caller's own — the API narrows to the actor without `workforce.read`, and
 * asking for somebody else without it is a 403 rather than a silently substituted set of your own numbers.
 * So this hook passes it only when a reader has deliberately picked a person.
 */
export function useLeaveBalances(params: { employeeId?: string; year: number }) {
  const { employeeId, year } = params;
  return useQuery<LeaveBalance[]>({
    queryKey: ['workforce', 'leave', 'balance', employeeId ?? 'me', year],
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/workforce/leave/balance', {
        params: { query: { employeeId, year } },
      });
      if (error || !data) throw new Error('Failed to load the leave balances');
      return data;
    },
  });
}

/**
 * The accrual policies, as reference data.
 *
 * Each carries the accrual method and the carry-over cap and expiry — the three facts that explain why a
 * balance says what it says. Read from the API so the explanation on screen is the rule the arithmetic
 * actually used, not a paraphrase of it.
 */
export function useLeavePolicies() {
  return useQuery<LeavePolicy[]>({
    queryKey: ['workforce', 'leave', 'policies'],
    staleTime: STALE.REFERENCE,
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/workforce/leave/policies');
      if (error || !data) throw new Error('Failed to load the leave policies');
      return data;
    },
  });
}

/**
 * The public holiday calendar for a year.
 *
 * Unowned reference data every employee needs — the API marks it `SharedRead` for that reason — and it is
 * what makes a leave request cost the right number of days, so it belongs on the same screen as the balances
 * it explains.
 */
export function useHolidays(year: number) {
  return useQuery<Holiday[]>({
    queryKey: ['workforce', 'leave', 'holidays', year],
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/workforce/holidays', {
        params: { query: { year } },
      });
      if (error || !data) throw new Error('Failed to load the holiday calendar');
      return data;
    },
  });
}
