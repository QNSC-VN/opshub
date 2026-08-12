import { useQuery } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import type { AuditAuditor, AuditFinding, UnlinkedFinding } from './audit.types';

/**
 * Every read the internal-audit programme makes.
 *
 * Keys start `['quality', …]` with the rest of QMS ON PURPOSE. Closing an audit moves its findings, and the
 * unlinked-findings report is a statement about the non-conformance register — so one prefix means one
 * invalidation, instead of an audit that says "reported" beside a report that still counts it as outstanding.
 */

export function useAudits(params: {
  status: string;
  openOnly: boolean;
  search: string;
  limit: number;
  offset: number;
}) {
  const { status, openOnly, search, limit, offset } = params;
  return useQuery({
    queryKey: ['quality', 'audits', status, openOnly, search, limit, offset],
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/internal-audits', {
        params: {
          query: {
            status: (status || undefined) as never,
            openOnly: openOnly || undefined,
            search: search || undefined,
            limit,
            offset,
          },
        },
      });
      if (error || !data) throw new Error('Failed to load the audit programme');
      return data;
    },
  });
}

/**
 * The roster.
 *
 * NOT A LIST OF ATTENDEES. This is what the impartiality rule reads: anybody on it audited the engagement,
 * and therefore cannot later certify that a corrective action for one of its findings worked. Which is why
 * removing somebody is a decision and not a tidy-up.
 */
export function useAuditors(auditId: string | null) {
  return useQuery<AuditAuditor[]>({
    queryKey: ['quality', 'auditors', auditId],
    enabled: !!auditId,
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/internal-audits/{id}/auditors', {
        params: { path: { id: auditId! } },
      });
      if (error || !data) throw new Error('Failed to load the roster');
      return data;
    },
  });
}

/** The findings this engagement raised — the §9.2.2(f) evidence that it produced anything. */
export function useAuditFindings(auditId: string | null) {
  return useQuery<AuditFinding[]>({
    queryKey: ['quality', 'audit-findings', auditId],
    enabled: !!auditId,
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/internal-audits/{id}/findings', {
        params: { path: { id: auditId! } },
      });
      if (error || !data) throw new Error('Failed to load the findings');
      return data;
    },
  });
}

/**
 * Findings that belong to no audit.
 *
 * WHY THIS IS A FINDING ABOUT THE PROGRAMME. Every non-conformance raised from an audit source should trace
 * to the engagement that raised it; one that does not is either an audit nobody recorded or a finding
 * attributed to a process that never examined it. Either way the programme cannot show what it covered.
 */
export function useUnlinkedFindings() {
  return useQuery<UnlinkedFinding[]>({
    queryKey: ['quality', 'unlinked-findings'],
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/internal-audits/reports/unlinked-findings');
      if (error || !data) throw new Error('Failed to load the unlinked findings');
      return data;
    },
  });
}
