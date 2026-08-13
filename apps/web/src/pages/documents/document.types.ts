import type { components } from '@/shared/api/generated/api';

/**
 * The controlled-document vocabulary, from the generated spec.
 */

export type ControlledDocument = components['schemas']['DocumentResponseDto'];
export type DocumentVersion = components['schemas']['DocumentVersionResponseDto'];
export type AcknowledgedBy = components['schemas']['AcknowledgedByResponseDto'];
export type OutstandingAcknowledgement =
  components['schemas']['OutstandingAcknowledgementResponseDto'];

/**
 * The categories a document can be filed under.
 *
 * Not a display concern: `isms_policy` and `qms_procedure` are what make the library searchable by
 * the system that owns the document, which is the question an auditor arrives with.
 */
export const DOCUMENT_CATEGORIES = [
  'isms_policy',
  'qms_procedure',
  'work_instruction',
  'hr_handbook',
  'contract_template',
] as const;

/**
 * The version lifecycle: draft → in_review → approved → published, then superseded by the next one.
 *
 * A PUBLISHED VERSION IS IMMUTABLE. ISO 9001 and 27001 both require knowing which revision was in force
 * on a given date, and an in-place edit destroys exactly that — so the only way to change a published
 * document is a NEW draft on top of it. That is why this screen offers "New draft" and never "Edit" on
 * anything published.
 */
export const VERSION_STATUSES = [
  'draft',
  'in_review',
  'approved',
  'published',
  'superseded',
] as const;

/**
 * Which action each version state allows, mirroring the service.
 *
 * `submit` hands the draft to `RequestEngine` — the approval is not modelled in the documents service at
 * all, so this screen shows the request it created rather than an approve button of its own. `publish`
 * needs `documents.publish`, a different permission from `documents.manage`: the person who drafts a policy
 * is not automatically the person who puts it in force.
 */
export const VERSION_NEXT_ACTIONS: Record<
  string,
  readonly ('edit' | 'submit' | 'publish' | 'acknowledge')[]
> = {
  draft: ['edit', 'submit'],
  in_review: [],
  approved: ['publish'],
  published: ['acknowledge'],
  superseded: [],
};
