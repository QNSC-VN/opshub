import type { risks, riskTreatments } from '../../../../../db/schema';

export type Risk = typeof risks.$inferSelect;
export type RiskTreatment = typeof riskTreatments.$inferSelect;
export type RiskStatus = Risk['status'];
export type TreatmentDecision = NonNullable<Risk['treatmentDecision']>;
export type TreatmentStatus = RiskTreatment['status'];

/** Likelihood and impact travel together — a half-scored assessment is not a score. */
export interface RiskScore {
  likelihood: number;
  impact: number;
}

export interface IdentifyRiskInput {
  reference: string;
  title: string;
  description: string;
  category: string;
  assetId?: string | null;
  ownerId: string;
  inherent: RiskScore;
  reviewDueOn?: string | null;
}

/**
 * What may still be edited after identification.
 *
 * `reference` is absent deliberately: it is quoted in treatment plans, the Statement of
 * Applicability and audit findings, so renaming it in place orphans every one of those references.
 */
export type UpdateRiskInput = Partial<{
  title: string;
  description: string;
  category: string;
  assetId: string | null;
  ownerId: string;
  inherent: RiskScore;
  reviewDueOn: string | null;
}>;

export interface RiskFilters {
  status?: RiskStatus;
  category?: string;
  ownerId?: string;
  assetId?: string;
  /** Open risks whose review date falls on or before this — the review-due queue. */
  reviewDueOnOrBefore?: string;
  /** Inherent score at or above this. The register's "what actually matters" filter. */
  minInherentScore?: number;
  /**
   * Free text over the reference, title and category.
   *
   * Added for the supplier screen's risk picker. The register grows with every risk an organisation
   * records and has no natural ceiling, so a client-side filter over one page — the compromise
   * `controlOptions` makes, justified there by Annex A being 93 controls — would silently stop finding
   * things exactly when the register became useful.
   */
  search?: string;
}

export interface AddTreatmentInput {
  riskId: string;
  description: string;
  ownerId: string;
  dueOn?: string | null;
}

export type UpdateTreatmentInput = Partial<{
  description: string;
  ownerId: string;
  dueOn: string | null;
  status: TreatmentStatus;
  completedOn: string | null;
}>;
