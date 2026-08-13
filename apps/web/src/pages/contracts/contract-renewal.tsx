import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/shared/api/client';
import { apiErrorMessage } from '@/shared/api/errors';
import {
  EntityPicker,
  FormActions,
  FormField,
  Input,
  Modal,
  StatusBadge,
  humanizeStatus,
  statusTone,
} from '@/shared/ui';
import { formatDate, isoInstantFromDate, todayIso } from '@/shared/lib/format';
import type { Contract } from './contract.types';

/**
 * Renewal, and the employment history it produces.
 *
 * Split from `contract-modals.tsx` because that file crossed the largest-file ratchet, and this is the seam
 * the domain already had: the other file drafts, activates and terminates ONE contract, and these two are
 * about the CHAIN — swapping one contract for the next, and reading the sequence back.
 */

/**
 * Renewing a contract.
 *
 * A RENEWAL IS A SWAP, NOT AN EDIT. The incoming contract is drafted first, separately, because its terms are
 * a new agreement — then this hands the two ids to the service, which expires the outgoing one and activates
 * the incoming one in a single transaction. That order is what `uq_employee_active_contract` enforces, and it
 * is why a renewal cannot leave somebody with two live contracts or none.
 *
 * THE PICKER ONLY OFFERS DRAFTS FOR THE SAME EMPLOYEE. The service refuses anything else — a contract cannot
 * renew itself, and a renewal must be for the same person — so the choice is narrowed to what would be
 * accepted rather than left to a refusal.
 */
export function RenewContractModal({
  contract,
  onClose,
  onSuccess,
}: {
  contract: Contract;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [incomingContractId, setIncomingContractId] = useState('');
  const [signedAt, setSignedAt] = useState(todayIso());
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: async () => {
      const { error: err } = await api.POST('/v1/contracts/{id}/renew', {
        params: { path: { id: contract.id } },
        body: {
          incomingContractId,
          // An INSTANT: `signedAt` is `z.string().datetime()`, and a bare date is a 422.
          signedAt: signedAt ? isoInstantFromDate(signedAt) : undefined,
        },
      });
      if (err) throw new Error(apiErrorMessage(err, 'Failed to renew the contract.'));
    },
    onSuccess: () => {
      toast.success('Contract renewed');
      onSuccess();
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  /** Drafts for THIS employee, which is the only thing the service will accept as an incoming contract. */
  async function draftOptions(term: string) {
    const { data } = await api.GET('/v1/contracts', {
      params: {
        query: {
          employeeId: contract.employeeId,
          status: 'draft' as never,
          limit: 50,
          offset: 0,
        },
      },
    });
    return (data?.data ?? [])
      .filter(
        (row) =>
          row.id !== contract.id &&
          (!term || row.reference.toLowerCase().includes(term.toLowerCase())),
      )
      .map((row) => ({
        value: row.id,
        label: row.reference,
        hint: `${humanizeStatus(row.contractType)} · from ${formatDate(row.startDate)}`,
      }));
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Renew ${contract.reference}`}
      description="Expires this contract and activates the incoming one in one transaction, so the employee is never left with two live contracts or none."
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError('');
          mutation.mutate();
        }}
        className="flex flex-col gap-4 p-5"
      >
        <FormField
          label="Incoming contract"
          htmlFor="renew-incoming"
          required
          hint="A DRAFT for the same employee. Draft it first if it does not exist yet — its terms are a new agreement."
        >
          <EntityPicker
            id="renew-incoming"
            value={incomingContractId}
            onChange={(value) => setIncomingContractId(value)}
            queryKey={`contract-drafts:${contract.employeeId}`}
            fetchOptions={draftOptions}
            placeholder="Search draft references…"
            emptyMessage="No drafts for this employee yet"
          />
        </FormField>

        <FormField
          label="Signed on"
          htmlFor="renew-signed-at"
          hint="Activation needs a signature date: an unsigned contract cannot come into force."
        >
          <Input
            id="renew-signed-at"
            type="date"
            max={todayIso()}
            value={signedAt}
            onChange={(e) => setSignedAt(e.target.value)}
          />
        </FormField>

        {error && <p className="text-xs text-danger">{error}</p>}
        <FormActions loading={mutation.isPending} onClose={onClose} submitLabel="Renew contract" />
      </form>
    </Modal>
  );
}

/**
 * Everything this employee has ever been contracted on.
 *
 * WHY IT IS THE HISTORY AND NOT THE CURRENT ROW. "What was this person's notice period in March" and "how
 * many fixed terms have they had" are both questions about superseded contracts, and `supersededById` is the
 * chain that answers them — so the panel lists all of them, newest first, with the one in force marked.
 */
export function ContractHistoryPanel({ employeeId }: { employeeId: string }) {
  const history = useQuery({
    queryKey: ['contracts', 'history', employeeId],
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/contracts/employees/{employeeId}/history', {
        params: { path: { employeeId } },
      });
      if (error || !data) throw new Error('Failed to load the employment history');
      return data;
    },
  });
  const rows = history.data ?? [];

  return (
    <div className="flex flex-col gap-2">
      {history.isLoading && <p className="text-xs text-fg-subtle">Loading…</p>}
      {history.isError && <p className="text-xs text-danger">Failed to load the history.</p>}
      {!history.isLoading && !history.isError && rows.length === 0 && (
        <p className="text-xs text-fg-subtle">No contracts recorded</p>
      )}

      {rows.map((row) => (
        <article
          key={row.id}
          aria-label={`Contract ${row.reference}`}
          className="rounded-md border border-border bg-surface px-2.5 py-1.5"
        >
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-xs font-medium text-fg">{row.reference}</span>
            <StatusBadge tone={statusTone(row.status)}>{humanizeStatus(row.status)}</StatusBadge>
            <span className="ml-auto text-xs text-fg-subtle">
              {formatDate(row.startDate)} – {row.endDate ? formatDate(row.endDate) : 'open-ended'}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-fg-subtle">
            {humanizeStatus(row.contractType)}
            {/* The chain, stated: this row was replaced BY a specific contract, which is what makes the
                sequence readable rather than a list of overlapping dates. */}
            {row.supersededById && ' · superseded by a later contract'}
            {row.terminatedOn && ` · terminated ${formatDate(row.terminatedOn)}`}
          </p>
        </article>
      ))}
    </div>
  );
}
