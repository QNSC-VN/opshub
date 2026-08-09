import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { RequestRegistry, type DbExecutor, type RequestTypeDef } from '@platform';
import { REQUEST_TYPE } from '@shared-kernel';
import {
  DOCUMENTS_REPOSITORY,
  type IDocumentsRepository,
} from '../domain/ports/documents.repository';

export interface DocumentApprovalPayload extends Record<string, unknown> {
  documentId: string;
  documentCode: string;
  documentTitle: string;
  /** The VERSION under approval — approving a document in the abstract means nothing. */
  versionId: string;
  version: number;
  changeSummary: string | null;
}

/**
 * Approval of one controlled-document version, as a `RequestTypeDef` rather than a status column.
 *
 * This is the roadmap's first architectural claim being cashed in: a document approval is the same
 * shape as an access request or a leave request, so it reuses the engine's separation of duties,
 * delegation, SLA deadline, expiry and audit entry instead of reimplementing them. The module keeps
 * only what the engine cannot know — which version, and what publishing supersedes.
 *
 * SEPARATE FROM PUBLISHING, DELIBERATELY. `onApprove` marks the version `approved`; it does not
 * publish. A policy is routinely approved before the date it takes effect, and collapsing the two
 * would make "approved" and "in force" the same fact — after which nobody can answer which
 * revision applied on a given day. Publishing is an explicit act, with its own permission.
 */
@Injectable()
export class DocumentApprovalTypeDef
  implements RequestTypeDef<DocumentApprovalPayload>, OnModuleInit
{
  readonly type = REQUEST_TYPE.DOCUMENT_APPROVAL;
  /**
   * Approving a controlled document is a quality/security act, not a line-manager one, so it sits
   * behind the same permission that governs the document library itself.
   */
  readonly requiredApprovalPermission = 'documents.approve';
  /**
   * An author must not approve their own policy — that is the whole point of a controlled document,
   * and it is the engine's default rather than something this module has to remember.
   */
  readonly allowSelfApproval = false;
  /** No auto-expiry: an unapproved policy is a standing obligation, not a request that goes stale. */
  readonly defaultExpiryHours = 0;
  readonly slaHours = 120;

  constructor(
    private readonly registry: RequestRegistry,
    @Inject(DOCUMENTS_REPOSITORY) private readonly repo: IDocumentsRepository,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async onApprove(
    payload: DocumentApprovalPayload,
    _requestId: string,
    approverId: string,
    tx: DbExecutor,
  ): Promise<void> {
    // Inside the engine's transaction, so the approval decision and the version's new state commit
    // together — an approved request pointing at a still-in_review version would be unexplainable.
    await this.repo.setVersionStatus(
      payload.versionId,
      'approved',
      { approvedBy: approverId, approvedAt: new Date() },
      tx,
    );
  }

  async onReject(
    payload: DocumentApprovalPayload,
    _requestId: string,
    _approverId: string,
    tx: DbExecutor,
  ): Promise<void> {
    // Rejected, not deleted: the draft and the reason it was refused are part of the record.
    await this.repo.setVersionStatus(payload.versionId, 'rejected', {}, tx);
  }
}
