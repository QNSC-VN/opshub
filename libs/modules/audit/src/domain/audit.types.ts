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
  /**
   * The actor's email, matched case-insensitively as a SUBSTRING.
   *
   * `actorId` is a UUID, which nobody investigating an incident has to hand — they have an email
   * address. The column is denormalised onto every entry precisely so the trail survives the employee
   * record being deleted, so filtering on it needs no join.
   *
   * A substring rather than an exact match because a domain or a name fragment is the useful query:
   * "everything anyone at that supplier did".
   */
  actorEmail?: string;
  resourceType?: string;
  resourceId?: string;
  action?: string;
}
