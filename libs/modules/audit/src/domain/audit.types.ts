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
  action: string;
  resourceType: string;
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
