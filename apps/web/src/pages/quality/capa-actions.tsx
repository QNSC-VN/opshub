import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/shared/api/client';
import { apiErrorMessage } from '@/shared/api/errors';
import { useCurrentUser } from '@/shared/hooks/use-current-user';
import { usePermissions } from '@/shared/hooks/use-permissions';
import { PanelAction } from '@/shared/ui';
import type { Capa } from './quality.types';
import { CAPA_NEXT_ACTIONS } from './quality.types';
import { CapaAnalysisModal, VerifyCapaModal } from './capa-modals';
import { CapaOutcomeModal, MarkImplementedModal } from './capa-outcome-modals';

/**
 * Every move a CAPA can make from where it is, in one component.
 *
 * WHY THIS IS EXTRACTED. The same CAPA is worked from two places — inside its finding's drawer, where the
 * closure gate is the reason to look, and from the CAPA queue, where the due date is. Two copies of this
 * button row would drift, and the thing that would drift is which transitions are legal.
 *
 * NO ACTION IS OFFERED THAT THE API WOULD ONLY REFUSE:
 *   · the buttons come from `CAPA_NEXT_ACTIONS`, which mirrors the service's transition map;
 *   · `plan` waits until the cause and plan are on the row, because the service refuses a plan built on no
 *     stated cause;
 *   · `verify` and `ineffective` are withheld from the CAPA's own owner, because the effectiveness review
 *     exists so that somebody other than the author agrees it worked (`CAPA_SELF_VERIFICATION`).
 *
 * One rule is deliberately NOT predicted here: an auditor who audited the finding cannot rule on the CAPA
 * (`CAPA_AUDITOR_IMPARTIALITY`). That depends on who was on the audit team, which this screen has no business
 * knowing — so it stays the API's refusal and surfaces as its message.
 */
export function CapaActions({ capa, onDone }: { capa: Capa; onDone?: () => void }) {
  const { can } = usePermissions();
  const me = useCurrentUser();
  const queryClient = useQueryClient();
  const [modal, setModal] = useState<
    'analysis' | 'implemented' | 'verify' | 'ineffective' | 'cancel' | null
  >(null);

  const steps = CAPA_NEXT_ACTIONS[capa.status] ?? [];
  const canManage = can('capa.manage');
  const canVerify = can('capa.verify');
  const analysisComplete = !!capa.rootCause && !!capa.actionPlan;
  const ownedByMe = !!me.data && capa.ownerId === me.data.sub;

  /** Every quality read hangs off one prefix, so a transition refreshes both registers and the reports. */
  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ['quality'] });
    onDone?.();
  }

  /**
   * The transitions that carry no evidence of their own.
   *
   * `plan` accepts the analysis, `start` says work began, `reopen-analysis` returns a failed CAPA to
   * analysis — all three take no body, so a modal would be a dialogue with one possible answer. The reason
   * for the reopening was already recorded when the CAPA was marked ineffective.
   */
  const bodylessMove = useMutation({
    mutationFn: async (step: 'plan' | 'start' | 'reopen-analysis') => {
      const params = { params: { path: { id: capa.id } } };
      const { error } =
        step === 'plan'
          ? await api.POST('/v1/capas/{id}/plan', params)
          : step === 'start'
            ? await api.POST('/v1/capas/{id}/start', params)
            : await api.POST('/v1/capas/{id}/reopen-analysis', params);
      if (error) throw new Error(apiErrorMessage(error, 'Failed to move the CAPA.'));
      return step;
    },
    onSuccess: (step) => {
      toast.success(
        step === 'plan' ? 'Plan accepted' : step === 'start' ? 'CAPA started' : 'Analysis reopened',
      );
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (steps.length === 0) return null;

  return (
    <>
      <div className="flex flex-wrap items-center gap-1">
        {steps.includes('analysis') && canManage && (
          <PanelAction tone="accent" onClick={() => setModal('analysis')}>
            {capa.rootCause ? 'Revise analysis' : 'Record analysis'}
          </PanelAction>
        )}
        {steps.includes('plan') && canManage && analysisComplete && (
          <PanelAction
            onClick={() => bodylessMove.mutate('plan')}
            disabled={bodylessMove.isPending}
          >
            Accept plan
          </PanelAction>
        )}
        {steps.includes('reopen') && canManage && (
          <PanelAction
            tone="accent"
            onClick={() => bodylessMove.mutate('reopen-analysis')}
            disabled={bodylessMove.isPending}
          >
            Reopen analysis
          </PanelAction>
        )}
        {steps.includes('start') && canManage && (
          <PanelAction
            onClick={() => bodylessMove.mutate('start')}
            disabled={bodylessMove.isPending}
          >
            Start work
          </PanelAction>
        )}
        {steps.includes('implemented') && canManage && (
          <PanelAction onClick={() => setModal('implemented')}>Mark implemented</PanelAction>
        )}
        {steps.includes('verify') && canVerify && !ownedByMe && (
          <PanelAction tone="success" onClick={() => setModal('verify')}>
            Verify effective
          </PanelAction>
        )}
        {steps.includes('ineffective') && canVerify && !ownedByMe && (
          <PanelAction tone="danger" onClick={() => setModal('ineffective')}>
            Not effective
          </PanelAction>
        )}
        {steps.includes('cancel') && canManage && (
          <PanelAction tone="danger" onClick={() => setModal('cancel')}>
            Cancel
          </PanelAction>
        )}
      </div>

      {/* Said rather than shown as a disabled button, because the reason is the point of the rule. */}
      {steps.includes('verify') && ownedByMe && (
        <p className="mt-1.5 text-xs text-fg-subtle">
          You own this CAPA, so somebody else signs off its effectiveness review.
        </p>
      )}

      {modal === 'analysis' && (
        <CapaAnalysisModal capa={capa} onClose={() => setModal(null)} onSuccess={refresh} />
      )}
      {modal === 'implemented' && (
        <MarkImplementedModal capa={capa} onClose={() => setModal(null)} onSuccess={refresh} />
      )}
      {modal === 'verify' && (
        <VerifyCapaModal capa={capa} onClose={() => setModal(null)} onSuccess={refresh} />
      )}
      {(modal === 'ineffective' || modal === 'cancel') && (
        <CapaOutcomeModal
          capa={capa}
          outcome={modal === 'ineffective' ? 'ineffective' : 'cancel'}
          onClose={() => setModal(null)}
          onSuccess={refresh}
        />
      )}
    </>
  );
}
