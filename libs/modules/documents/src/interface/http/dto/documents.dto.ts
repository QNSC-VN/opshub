import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { PaginationQuerySchema } from '@shared-kernel';
import { documentCategoryEnum } from '@db/schema/enums';

const category = z.enum(documentCategoryEnum.enumValues);

export const CreateDocumentSchema = z.object({
  /**
   * Human-facing code (`POL-001`). Constrained to an uppercase pattern because it is quoted in
   * audits and cited by controls, and a library where `pol-1` and `POL-001` coexist is unusable.
   */
  code: z
    .string()
    .min(2)
    .max(32)
    .regex(/^[A-Z][A-Z0-9-]*$/, 'Use uppercase letters, digits and hyphens, e.g. POL-001'),
  title: z.string().min(3).max(240),
  category,
  ownerId: z.string().uuid(),
  body: z.string().max(200_000).optional(),
});
export class CreateDocumentDto extends createZodDto(CreateDocumentSchema) {}

export const ListDocumentsQuerySchema = z
  .object({
    category: category.optional(),
    ownerId: z.string().uuid().optional(),
    includeRetired: z.coerce.boolean().optional(),
  })
  .merge(PaginationQuerySchema);
export class ListDocumentsQueryDto extends createZodDto(ListDocumentsQuerySchema) {}

export const CreateDraftSchema = z.object({
  body: z.string().max(200_000).optional(),
  /** What changed — required reading for anyone who has to re-acknowledge. */
  changeSummary: z.string().max(2000).optional(),
});
export class CreateDraftDto extends createZodDto(CreateDraftSchema) {}

export const PublishVersionSchema = z.object({
  /** When the content stops being authoritative. Drives the review sweep. */
  reviewDueOn: z.string().date().optional(),
});
export class PublishVersionDto extends createZodDto(PublishVersionSchema) {}

export class DocumentResponseDto {
  id!: string;
  code!: string;
  title!: string;
  category!: string;
  ownerId!: string;
  retiredAt!: string | null;
  createdAt!: string;
}

export class DocumentVersionResponseDto {
  id!: string;
  documentId!: string;
  version!: number;
  body!: string | null;
  changeSummary!: string | null;
  status!: string;
  /** Engine request driving the approval, once submitted. */
  requestId!: string | null;
  approvedBy!: string | null;
  approvedAt!: string | null;
  publishedAt!: string | null;
  reviewDueOn!: string | null;
  supersededAt!: string | null;
  createdAt!: string;
}

export class OutstandingAcknowledgementResponseDto {
  documentId!: string;
  code!: string;
  title!: string;
  category!: string;
  versionId!: string;
  version!: number;
  publishedAt!: string;
}

export class AcknowledgementResponseDto {
  /** True when this employee had already acknowledged this version — the call is idempotent. */
  alreadyAcknowledged!: boolean;
}

export class AcknowledgedByResponseDto {
  employeeId!: string;
  acknowledgedAt!: string;
}
