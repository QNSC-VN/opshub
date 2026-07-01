/**
 * Convenience type aliases over the generated openapi-typescript schema types.
 * Import from here instead of directly using components['schemas']['…'] everywhere.
 */
import type { components } from './generated/api';

export type { components };

// Auth
export type AuthResponse = components['schemas']['AuthResponseDto'];
export type MeResponse = components['schemas']['MeResponseDto'];

// Employees
export type EmployeeResponse = components['schemas']['EmployeeResponseDto'];
export type CreateEmployeeDto = components['schemas']['CreateEmployeeDto'];
export type UpdateEmployeeDto = components['schemas']['UpdateEmployeeDto'];

// Assets
export type AssetResponse = components['schemas']['AssetResponseDto'];
export type AssetAssignmentResponse = components['schemas']['AssetAssignmentResponseDto'];

// Access
export type AccessRequestResponse = components['schemas']['AccessRequestResponseDto'];
export type AccessGrantResponse = components['schemas']['AccessGrantResponseDto'];

// Compliance
export type FindingResponse = components['schemas']['FindingResponseDto'];

// Workforce
export type TimesheetResponse = components['schemas']['TimesheetResponseDto'];
export type LeaveResponse = components['schemas']['LeaveResponseDto'];
export type OvertimeResponse = components['schemas']['OvertimeResponseDto'];
export type ShiftLogResponse = components['schemas']['ShiftLogResponseDto'];

// Workforce status/type literals (previously exported as enums from generated)
export type TimesheetStatus = components['schemas']['TimesheetResponseDto']['status'];
export type LeaveType = components['schemas']['LeaveResponseDto']['leaveType'];
export type LeaveStatus = components['schemas']['LeaveResponseDto']['status'];
export type OvertimeStatus = components['schemas']['OvertimeResponseDto']['status'];
export type ShiftType = components['schemas']['ShiftLogResponseDto']['shiftType'];
export type AccessRequestStatus = components['schemas']['AccessRequestResponseDto']['status'];

// Webhooks
export type WebhookSubscriptionResponse = components['schemas']['WebhookSubscriptionResponseDto'];
export type WebhookDeliveryResponse = components['schemas']['WebhookDeliveryResponseDto'];
export type CreateWebhookSubscriptionDto = components['schemas']['CreateWebhookSubscriptionDto'];

// Onboarding / Offboarding
export type OnboardingResponse = components['schemas']['OnboardingResponseDto'];
export type OffboardingResponse = components['schemas']['OffboardingResponseDto'];

// Roles / Permissions / Delegations
export type RoleResponse = components['schemas']['RoleResponseDto'];
export type PermissionResponse = components['schemas']['PermissionResponseDto'];
export type RoleAssignmentResponse = components['schemas']['RoleAssignmentResponseDto'];
export type DelegationResponse = components['schemas']['DelegationResponseDto'];

// Compliance — software listing / finding types (previously exported as enums)
export type SoftwareResponse = components['schemas']['SoftwareResponseDto'];
export type SoftwareListing = 'whitelisted' | 'blacklisted' | 'review' | 'unknown';
export type FindingSeverity = 'critical' | 'high' | 'medium' | 'low';
export type FindingStatus = 'open' | 'acknowledged' | 'resolved' | 'risk_accepted';

// Unified requests inbox
export type RequestItemResponse = components['schemas']['RequestItemResponseDto'];
export type RequestApprovalResponse = components['schemas']['RequestApprovalResponseDto'];
export type RequestStatus = 'pending' | 'in_review' | 'approved' | 'rejected' | 'cancelled' | 'expired';
export type RequestPriority = 'low' | 'normal' | 'high' | 'urgent';

// Audit logs
export type AuditLogResponse = components['schemas']['AuditLogResponseDto'];

// Notifications — not fully typed in generated schema, defined manually
export interface InAppNotification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  resourceType: string | null;
  resourceId: string | null;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
}
export interface NotificationListResult {
  items: InAppNotification[];
  nextCursor: string | null;
}

// Reports
export type RequestSummaryResponse = components['schemas']['RequestSummaryResponseDto'];
export type CycleTimeResponse = components['schemas']['CycleTimeResponseDto'];
export type SlaComplianceResponse = components['schemas']['SlaComplianceResponseDto'];
export type QueueDepthResponse = components['schemas']['QueueDepthResponseDto'];
export type ThroughputResponse = components['schemas']['ThroughputResponseDto'];
export type FindingsSummaryResponse = components['schemas']['FindingsSummaryResponseDto'];
export type AssetUtilizationResponse = components['schemas']['AssetUtilizationResponseDto'];
export type LeaveSummaryResponse = components['schemas']['LeaveSummaryResponseDto'];
export type OvertimeSummaryResponse = components['schemas']['OvertimeSummaryResponseDto'];

// Notification preferences
export type NotificationPreferenceResponse = components['schemas']['PreferenceResponseDto'];
