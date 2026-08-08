import type { AuditAction, AuditResource } from './audit-catalogue';

export interface AuditLog {
  id: string;
  actorId: string | null;
  actorEmail: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  changes: unknown;
  metadata: Record<string, unknown>;
  occurredAt: Date;
}

export interface CreateAuditLogInput {
  id: string;
  actorId?: string | null;
  actorEmail?: string | null;
  /** From {@link AUDIT_ACTION}. A literal that is not in the catalogue is a compile error. */
  action: AuditAction;
  /** From {@link AUDIT_RESOURCE}. */
  resourceType: AuditResource;
  resourceId?: string | null;
  changes?: unknown;
  metadata?: Record<string, unknown>;
}

export interface AuditFilters {
  actorId?: string;
  resourceType?: string;
  resourceId?: string;
  action?: string;
}
