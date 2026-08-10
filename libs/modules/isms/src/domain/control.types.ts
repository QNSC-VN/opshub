import type { controls, riskControls, soaEntries } from '../../../../../db/schema';

export type Control = typeof controls.$inferSelect;
export type SoaEntry = typeof soaEntries.$inferSelect;
export type RiskControl = typeof riskControls.$inferSelect;
export type ControlTheme = Control['theme'];
export type ControlSource = Control['source'];
export type ImplementationStatus = SoaEntry['status'];

export interface CreateControlInput {
  reference: string;
  title: string;
  description?: string | null;
  theme: ControlTheme;
  source?: ControlSource;
}

export type UpdateControlInput = Partial<Omit<CreateControlInput, 'reference' | 'source'>>;

export interface ControlFilters {
  theme?: ControlTheme;
  source?: ControlSource;
  /** Retired controls are hidden by default — nothing new may reference them. */
  includeRetired?: boolean;
}

/**
 * The SoA decision for one control, supplied whole.
 *
 * Deliberately NOT a patch: applicability, justification and status are one statement, and letting
 * them be updated independently is how an entry ends up excluded with a stale rationale that still
 * argues for inclusion.
 */
export interface SetSoaEntryInput {
  applicable: boolean;
  justification: string;
  status: ImplementationStatus;
  implementationNote?: string | null;
  evidenceDocumentId?: string | null;
  ownerId?: string | null;
  reviewDueOn?: string | null;
}

export interface SoaFilters {
  applicable?: boolean;
  status?: ImplementationStatus;
  ownerId?: string;
  theme?: ControlTheme;
  /** Entries whose review date falls on or before this — the review queue. */
  reviewDueOnOrBefore?: string;
}

/** One row of the SoA, joined to the control it decides about. */
export interface SoaRow extends SoaEntry {
  controlReference: string;
  controlTitle: string;
  controlTheme: ControlTheme;
}

/**
 * SoA coverage, the number an ISO 27001 audit opens with.
 *
 * `undecided` is the count of controls with NO entry at all, which is why the SoA is a separate
 * table: an absent row is a distinct state from any value a column could hold.
 */
export interface SoaCoverage {
  totalControls: number;
  undecided: number;
  applicable: number;
  excluded: number;
  implemented: number;
  partiallyImplemented: number;
  notImplemented: number;
}

/** A risk that no control treats — the gap the risk↔control join exists to expose. */
export interface UntreatedRisk {
  riskId: string;
  reference: string;
  title: string;
  status: string;
  inherentScore: number | null;
  residualScore: number | null;
}
