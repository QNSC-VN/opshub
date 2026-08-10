import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { PaginationQuerySchema } from '@shared-kernel';
import { RATING_MAX, RATING_MIN } from '../../../domain/rating';
import { informationAssetTypeEnum, informationClassificationEnum } from '@db/schema/enums';

const classification = z.enum(informationClassificationEnum.enumValues);
const assetType = z.enum(informationAssetTypeEnum.enumValues);

/** The CIA scale, shared with the risk register's likelihood and impact — see `domain/rating.ts`. */
const rating = z.number().int().min(RATING_MIN).max(RATING_MAX);

/**
 * 10 characters minimum, matching `ck_asset_classification_history_reason`.
 *
 * The history is read by somebody deciding whether a reduction in protection was justified, so "n/a"
 * is worse than nothing: it occupies the space where the justification should be.
 */
const reason = z.string().min(10).max(2000);

export const RegisterInformationAssetSchema = z.object({
  /** Quoted in the register, in risk assessments and in audit findings. */
  reference: z
    .string()
    .min(3)
    .max(40)
    .regex(/^[A-Z][A-Z0-9.-]*$/, 'Use uppercase letters, digits, dots and hyphens, e.g. IA-014'),
  name: z.string().min(3).max(200),
  description: z.string().max(5000).nullable().optional(),
  type: assetType,
  classification,
  /** Becomes the FIRST history row, which is why it is required rather than optional. */
  classificationReason: reason,
  ownerId: z.string().uuid(),
  custodianId: z.string().uuid().nullable().optional(),
  confidentiality: rating,
  integrity: rating,
  availability: rating,
  personalData: z.boolean().optional(),
  location: z.string().max(200).nullable().optional(),
  retentionMonths: z.number().int().positive().nullable().optional(),
  reviewDueOn: z.string().date().nullable().optional(),
});
export class RegisterInformationAssetDto extends createZodDto(RegisterInformationAssetSchema) {}

/**
 * `classification` and `classificationReason` are OMITTED.
 *
 * Changing the label writes history and, downwards, needs a different permission. Leaving it in a
 * generic patch would make both of those depend on the caller choosing the other endpoint.
 */
export const UpdateInformationAssetSchema = RegisterInformationAssetSchema.omit({
  reference: true,
  classification: true,
  classificationReason: true,
})
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Supply at least one field to update');
export class UpdateInformationAssetDto extends createZodDto(UpdateInformationAssetSchema) {}

export const ReclassifySchema = z.object({
  classification,
  /** Why the protection changed. Required in both directions. */
  reason,
});
export class ReclassifyDto extends createZodDto(ReclassifySchema) {}

export const MarkAssetReviewedSchema = z.object({
  /** When the next review is due. Null clears it. */
  reviewDueOn: z.string().date().nullable().optional(),
});
export class MarkAssetReviewedDto extends createZodDto(MarkAssetReviewedSchema) {}

// A device link carries no body: the pair of ids in the path IS the whole fact, and the route is a
// `PUT` for the same reason `PUT /risks/:id/controls/:controlId` is — the natural key makes it
// idempotent, so linking twice is still one link.

export const ListInformationAssetsQuerySchema = z
  .object({
    type: assetType.optional(),
    classification: classification.optional(),
    /** Matches the owner OR the custodian — one question to the person asking it. */
    ownerId: z.string().uuid().optional(),
    /** The personal-data holdings, which is the register a data-protection question starts from. */
    personalDataOnly: z.coerce.boolean().optional(),
    /** Due for review on or before this date. Today's date gives the overdue report. */
    reviewDueOnOrBefore: z.string().date().optional(),
    includeRetired: z.coerce.boolean().optional(),
    search: z.string().max(200).optional(),
  })
  .merge(PaginationQuerySchema);
export class ListInformationAssetsQueryDto extends createZodDto(ListInformationAssetsQuerySchema) {}

// ── Responses ─────────────────────────────────────────────────────────────────

export class ClassificationLevelResponseDto {
  code!: string;
  /** Higher is more protected. THE ordering — the enum's declaration order is not authoritative. */
  rank!: number;
  label!: string;
  handlingRules!: string;
  encryptionRequired!: boolean;
}

export class InformationAssetResponseDto {
  id!: string;
  reference!: string;
  name!: string;
  description!: string | null;
  type!: string;
  classification!: string;
  ownerId!: string;
  custodianId!: string | null;
  confidentiality!: number;
  integrity!: number;
  availability!: number;
  personalData!: boolean;
  location!: string | null;
  retentionMonths!: number | null;
  lastReviewedAt!: string | null;
  reviewDueOn!: string | null;
  retiredAt!: string | null;
  createdAt!: string;
}

export class InformationAssetRowResponseDto extends InformationAssetResponseDto {
  /** Resolved from `isms.classification_levels` in the same query as the row. */
  classificationRank!: number;
  encryptionRequired!: boolean;
  deviceCount!: number;
}

export class ClassificationChangeResponseDto {
  id!: string;
  informationAssetId!: string;
  /** Null on the first row: the asset was classified when it was registered. */
  fromLevel!: string | null;
  toLevel!: string;
  reason!: string;
  changedBy!: string;
  changedAt!: string;
}

export class InformationAssetDeviceResponseDto {
  deviceAssetId!: string;
  assetTag!: string;
  type!: string;
  status!: string;
  assignedTo!: string | null;
}

export class DeviceHoldingResponseDto {
  informationAssetId!: string;
  reference!: string;
  name!: string;
  classification!: string;
  classificationRank!: number;
  personalData!: boolean;
  ownerId!: string;
}

export class ClassificationSummaryResponseDto {
  classification!: string;
  rank!: number;
  assets!: number;
  personalDataAssets!: number;
  onDevices!: number;
}
