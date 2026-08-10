import type {
  assetClassificationHistory,
  classificationLevels,
  informationAssets,
} from '../../../../../db/schema';

export type InformationAsset = typeof informationAssets.$inferSelect;
export type ClassificationLevel = typeof classificationLevels.$inferSelect;
export type ClassificationChange = typeof assetClassificationHistory.$inferSelect;
export type InformationClassification = InformationAsset['classification'];
export type InformationAssetType = InformationAsset['type'];

/**
 * The CIA rating. Separate from the rest of the input because the three move together: an assessment
 * that updates confidentiality without revisiting integrity and availability is half an assessment.
 */
export interface CiaRating {
  confidentiality: number;
  integrity: number;
  availability: number;
}

export interface RegisterAssetInput extends CiaRating {
  reference: string;
  name: string;
  description?: string | null;
  type: InformationAssetType;
  classification: InformationClassification;
  /** Why it carries that classification. Becomes the FIRST history row, so it is required. */
  classificationReason: string;
  ownerId: string;
  custodianId?: string | null;
  personalData?: boolean;
  location?: string | null;
  retentionMonths?: number | null;
  reviewDueOn?: string | null;
}

/**
 * What may be corrected without going through a reclassification.
 *
 * `classification` is absent DELIBERATELY. Changing it writes a history row and, downwards, needs a
 * different permission — routing it through a generic patch would make both of those optional. The
 * CIA rating is here because re-rating is ordinary assessment work; the CHECK still refuses a rating
 * that contradicts the current label, and the service says so with a code first.
 */
export type UpdateAssetInput = Partial<{
  name: string;
  description: string | null;
  type: InformationAssetType;
  ownerId: string;
  custodianId: string | null;
  confidentiality: number;
  integrity: number;
  availability: number;
  personalData: boolean;
  location: string | null;
  retentionMonths: number | null;
  reviewDueOn: string | null;
}>;

export interface InformationAssetFilters {
  type?: InformationAssetType;
  classification?: InformationClassification;
  ownerId?: string;
  /** Personal-data holdings only — the register a data-protection question is answered from. */
  personalDataOnly?: boolean;
  /** Due for review on or before this date. The overdue report is this with today's date. */
  reviewDueOnOrBefore?: string;
  /** Retired assets are excluded unless asked for: the register means the CURRENT inventory. */
  includeRetired?: boolean;
  search?: string;
}

/** A register row with the rank and handling rules its label carries, resolved in one query. */
export interface InformationAssetRow extends InformationAsset {
  classificationRank: number;
  encryptionRequired: boolean;
  /** How many devices are recorded as holding it. Zero is a real answer, not a missing one. */
  deviceCount: number;
}

/**
 * What one device holds — the lost-laptop question.
 *
 * Ordered worst-first by classification rank, because the first line of the answer is the one that
 * decides whether this is an incident.
 */
export interface DeviceHolding {
  informationAssetId: string;
  reference: string;
  name: string;
  classification: InformationClassification;
  classificationRank: number;
  personalData: boolean;
  ownerId: string;
}

/** The register summarised by label, for the screen that opens on "what do we hold". */
export interface ClassificationSummaryLine {
  classification: InformationClassification;
  rank: number;
  assets: number;
  personalDataAssets: number;
  /** Assets at this level held on at least one device. */
  onDevices: number;
}
