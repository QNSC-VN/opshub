import { Inject, Injectable } from '@nestjs/common';
import {
  ConflictException,
  NotFoundException,
  PreconditionFailedException,
  ErrorCodes,
} from '@platform';
import { AuditService } from '@modules/audit';
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

@Injectable()
export class ComplianceService {
  constructor(
    @Inject(COMPLIANCE_REPOSITORY) private readonly repo: IComplianceRepository,
    private readonly audit: AuditService,
  ) {}

  // ── Software catalog ───────────────────────────────────────────────────────

  async addSoftware(
    input: UpsertSoftwareInput,
    actor: { sub: string; email: string },
  ): Promise<SoftwareCatalogEntry> {
    const existing = await this.repo.findSoftwareByName(input.name);
    if (existing) {
      throw new ConflictException(ErrorCodes.CONFLICT, 'Software with this name already exists');
    }
    const entry = await this.repo.createSoftware(input);
    void this.audit.record({
      actorId: actor.sub,
      actorEmail: actor.email,
      action: 'software.added',
      resourceType: 'software_catalog',
      resourceId: entry.id,
      metadata: { name: entry.name, listing: entry.listing },
    });
    return entry;
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
    const updated = await this.repo.updateSoftware(id, patch);
    if (!updated) throw new NotFoundException(ErrorCodes.SOFTWARE_NOT_FOUND, 'Software not found');
    void this.audit.record({
      actorId: actor.sub,
      actorEmail: actor.email,
      action: 'software.updated',
      resourceType: 'software_catalog',
      resourceId: id,
      changes: patch,
    });
    return updated;
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
    const updated = await this.repo.setFindingStatus(id, status, actor.sub, note);
    if (!updated) throw new NotFoundException(ErrorCodes.FINDING_NOT_FOUND, 'Finding not found');
    void this.audit.record({
      actorId: actor.sub,
      actorEmail: actor.email,
      action: `finding.${status}`,
      resourceType: 'compliance_finding',
      resourceId: id,
    });
    return updated;
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
    const updated = await this.repo.setFindingStatus(id, 'acknowledged', null, null);
    if (!updated) throw new NotFoundException(ErrorCodes.FINDING_NOT_FOUND, 'Finding not found');
    void this.audit.record({
      actorId: actor.sub,
      actorEmail: actor.email,
      action: 'finding.acknowledged',
      resourceType: 'compliance_finding',
      resourceId: id,
    });
    return updated;
  }
}
