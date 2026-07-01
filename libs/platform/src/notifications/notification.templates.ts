/**
 * In-app notification template registry.
 * Each template maps a type key → (vars) → { title, body }.
 */

// ── Template names ────────────────────────────────────────────────────────────

export type NotificationTemplateName =
  | 'access_request.submitted'
  | 'access_request.approved'
  | 'access_request.denied'
  | 'asset.assigned'
  | 'asset.unassigned'
  | 'employee.offboarded'
  | 'request.sla_breach'
  | 'request.delegation_created'
  | 'request.step_ready'
  | 'request.submitted'
  | 'request.approved'
  | 'request.rejected';

// ── Per-template variable shapes ─────────────────────────────────────────────

export interface NotificationTemplateVars {
  'access_request.submitted': {
    resourceName: string;
    requesterName: string;
  };
  'access_request.approved': {
    resourceName: string;
    approverName: string;
  };
  'access_request.denied': {
    resourceName: string;
    approverName: string;
    reason?: string;
  };
  'asset.assigned': {
    assetName: string;
    assetTag:  string;
  };
  'asset.unassigned': {
    assetName: string;
    assetTag:  string;
  };
  'employee.offboarded': {
    employeeName: string;
  };
  'request.sla_breach': {
    requestType: string;
    requestId: string;
    deadline: string; // ISO string
  };
  'request.delegation_created': {
    delegatorName: string;
    endsAt: string; // ISO string
  };
  'request.step_ready': {
    requestType: string;
    requestId: string;
    completedStep: number;
    nextStep: number;
    totalSteps: number;
  };
  'request.submitted': {
    requestType: string;
    requestId: string;
    requesterEmail: string;
  };
  'request.approved': {
    requestType: string;
    requestId: string;
  };
  'request.rejected': {
    requestType: string;
    requestId: string;
    reason?: string;
  };
}

export interface RenderedNotification {
  title: string;
  body:  string;
}

// ── Template implementations ──────────────────────────────────────────────────

const templates: {
  [K in NotificationTemplateName]: (v: NotificationTemplateVars[K]) => RenderedNotification;
} = {
  'access_request.submitted'(v) {
    return {
      title: 'Access request submitted',
      body:  `Your request for access to "${v.resourceName}" is pending approval.`,
    };
  },
  'access_request.approved'(v) {
    return {
      title: 'Access request approved ✓',
      body:  `${v.approverName} approved your request for "${v.resourceName}".`,
    };
  },
  'access_request.denied'(v) {
    const extra = v.reason ? ` Reason: ${v.reason}` : '';
    return {
      title: 'Access request denied',
      body:  `${v.approverName} denied your request for "${v.resourceName}".${extra}`,
    };
  },
  'asset.assigned'(v) {
    return {
      title: 'Asset assigned to you',
      body:  `${v.assetName} (${v.assetTag}) has been assigned to you.`,
    };
  },
  'asset.unassigned'(v) {
    return {
      title: 'Asset unassigned',
      body:  `${v.assetName} (${v.assetTag}) has been unassigned from you.`,
    };
  },
  'employee.offboarded'(v) {
    return {
      title: 'Offboarding complete',
      body:  `The offboarding process for ${v.employeeName} has been completed.`,
    };
  },
  'request.sla_breach'(v) {
    return {
      title: 'SLA breach warning',
      body:  `Your ${v.requestType} request (${v.requestId}) has exceeded its SLA deadline of ${v.deadline}. Please take action.`,
    };
  },
  'request.delegation_created'(v) {
    return {
      title: 'Approval delegation received',
      body:  `${v.delegatorName} has delegated their approval authority to you until ${v.endsAt}.`,
    };
  },
  'request.step_ready'(v) {
    return {
      title: `Action required: ${v.requestType} approval (step ${v.nextStep}/${v.totalSteps})`,
      body:  `Step ${v.completedStep} has been approved. Your review is now required (step ${v.nextStep} of ${v.totalSteps}).`,
    };
  },
  'request.submitted'(v) {
    return {
      title: `New ${v.requestType} request awaiting review`,
      body:  `${v.requesterEmail} submitted a ${v.requestType} request (${v.requestId}) that requires your approval.`,
    };
  },
  'request.approved'(v) {
    return {
      title: `Your ${v.requestType} request was approved`,
      body:  `Your ${v.requestType} request (${v.requestId}) has been approved.`,
    };
  },
  'request.rejected'(v) {
    const extra = v.reason ? ` Reason: ${v.reason}` : '';
    return {
      title: `Your ${v.requestType} request was rejected`,
      body:  `Your ${v.requestType} request (${v.requestId}) has been rejected.${extra}`,
    };
  },
};

// ── Public API ────────────────────────────────────────────────────────────────

export function renderNotification<K extends NotificationTemplateName>(
  type: K,
  vars: NotificationTemplateVars[K],
): RenderedNotification {
  const fn = templates[type];
  return (fn as (v: NotificationTemplateVars[K]) => RenderedNotification)(vars);
}
