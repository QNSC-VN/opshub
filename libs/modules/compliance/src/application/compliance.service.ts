import { Inject, Injectable } from '@nestjs/common';
import {
  ConflictException,
  NotFoundException,
  PreconditionFailedException,
  ErrorCodes,
  InjectDrizzle,
  type DrizzleDB,
} from '@platform';
import {
  AuditService,
  AUDIT_ACTION,
  AUDIT_RESOURCE,
  type ResourceAuditTrail,
} from '@modules/audit';
import {
  COMPLIANCE_REPOSITORY,
  type IComplianceRepository,
} from '../domain/ports/compliance.repository';
import type {
  ComplianceFinding,
  FindingFilters,
  SoftwareCatalogEntry,
  SoftwareFilters,
  UpsertSoftwareInput,
} from '../domain/compliance.types';

/**
 * The software catalogue and the endpoint findings raised against it.
 *
 * AUDIT ENTRIES SHARE THEIR MUTATION'S TRANSACTION. Resolving or accepting the risk on a finding is a
 * DECISION about a security exposure, and it was recorded fire-and-forget: the finding could move to
 * `risk_accepted` with nothing saying who accepted it.
 */
@Injectable()
export class ComplianceService {
  private readonly softwareTrail: ResourceAuditTrail;
  private readonly findingTrail: ResourceAuditTrail;

  constructor(
    @Inject(COMPLIANCE_REPOSITORY) private readonly repo: IComplianceRepository,
    @InjectDrizzle() private readonly db: DrizzleDB,
    audit: AuditService,
  ) {
    this.softwareTrail = audit.forResource(AUDIT_RESOURCE.SOFTWARE_CATALOG);
    this.findingTrail = audit.forResource(AUDIT_RESOURCE.COMPLIANCE_FINDING);
  }

  // ── Software catalog ───────────────────────────────────────────────────────

  async addSoftware(
    input: UpsertSoftwareInput,
    actor: { sub: string; email: string },
  ): Promise<SoftwareCatalogEntry> {
    const existing = await this.repo.findSoftwareByName(input.name);
    if (existing) {
      throw new ConflictException(ErrorCodes.CONFLICT, 'Software with this name already exists');
    }
    return this.db.transaction(async (tx) => {
      const entry = await this.repo.createSoftware(input, tx);
      await this.softwareTrail.record(AUDIT_ACTION.SOFTWARE_ADDED, entry.id, actor, tx, {
        after: { name: entry.name, listing: entry.listing },
      });
      return entry;
    });
  }

  async getSoftware(id: string): Promise<SoftwareCatalogEntry> {
    const entry = await this.repo.findSoftwareById(id);
    if (!entry) throw new NotFoundException(ErrorCodes.SOFTWARE_NOT_FOUND, 'Software not found');
    return entry;
  }

  async updateSoftware(
    id: string,
    patch: Partial<UpsertSoftwareInput>,
    actor: { sub: string; email: string },
  ): Promise<SoftwareCatalogEntry> {
    await this.getSoftware(id);
    return this.db.transaction(async (tx) => {
      const updated = await this.repo.updateSoftware(id, patch, tx);
      if (!updated)
        throw new NotFoundException(ErrorCodes.SOFTWARE_NOT_FOUND, 'Software not found');
      await this.softwareTrail.record(AUDIT_ACTION.SOFTWARE_UPDATED, id, actor, tx, {
        after: patch,
      });
      return updated;
    });
  }

  async listSoftware(
    filters: SoftwareFilters,
    limit: number,
    offset: number,
  ): Promise<{ rows: SoftwareCatalogEntry[]; total: number }> {
    return this.repo.listSoftware(filters, limit, offset);
  }

  // ── Findings ───────────────────────────────────────────────────────────────

  async getFinding(id: string): Promise<ComplianceFinding> {
    const finding = await this.repo.findFindingById(id);
    if (!finding) throw new NotFoundException(ErrorCodes.FINDING_NOT_FOUND, 'Finding not found');
    return finding;
  }

  async listFindings(
    filters: FindingFilters,
    limit: number,
    offset: number,
  ): Promise<{ rows: ComplianceFinding[]; total: number }> {
    return this.repo.listFindings(filters, limit, offset);
  }

  async resolveFinding(
    id: string,
    note: string | null,
    riskAccepted: boolean,
    actor: { sub: string; email: string },
  ): Promise<ComplianceFinding> {
    const finding = await this.getFinding(id);
    if (finding.status === 'resolved' || finding.status === 'risk_accepted') {
      throw new PreconditionFailedException(
        ErrorCodes.FINDING_ALREADY_RESOLVED,
        'Finding is already resolved',
      );
    }
    const status = riskAccepted ? 'risk_accepted' : 'resolved';
    return this.db.transaction(async (tx) => {
      const updated = await this.repo.setFindingStatus(id, status, actor.sub, note, tx);
      if (!updated) throw new NotFoundException(ErrorCodes.FINDING_NOT_FOUND, 'Finding not found');
      // Accepting a risk is a decision about an exposure, so the note travels with the entry.
      await this.findingTrail.record(
        riskAccepted ? AUDIT_ACTION.FINDING_RISK_ACCEPTED : AUDIT_ACTION.FINDING_RESOLVED,
        id,
        actor,
        tx,
        { after: { status, note } },
      );
      return updated;
    });
  }

  async acknowledgeFinding(
    id: string,
    actor: { sub: string; email: string },
  ): Promise<ComplianceFinding> {
    const finding = await this.getFinding(id);
    if (finding.status !== 'open') {
      throw new PreconditionFailedException(
        ErrorCodes.PRECONDITION_FAILED,
        'Only open findings can be acknowledged',
      );
    }
    return this.db.transaction(async (tx) => {
      const updated = await this.repo.setFindingStatus(id, 'acknowledged', null, null, tx);
      if (!updated) throw new NotFoundException(ErrorCodes.FINDING_NOT_FOUND, 'Finding not found');
      await this.findingTrail.record(AUDIT_ACTION.FINDING_ACKNOWLEDGED, id, actor, tx, {
        after: { status: 'acknowledged' },
      });
      return updated;
    });
  }
}
