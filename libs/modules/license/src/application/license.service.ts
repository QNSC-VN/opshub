import { Inject, Injectable } from '@nestjs/common';
import { ConflictException, NotFoundException, PreconditionFailedException, ErrorCodes } from '@platform';
import { AuditService } from '@modules/audit';
import {
  LICENSE_REPOSITORY,
  type ILicenseRepository,
} from '../domain/ports/license.repository';
import type {
  SoftwareLicense,
  LicenseAssignment,
  LicenseUtilization,
  CreateLicenseInput,
  UpdateLicenseInput,
  LicenseFilters,
} from '../domain/license.types';

type Actor = { sub: string; email: string };

@Injectable()
export class LicenseService {
  constructor(
    @Inject(LICENSE_REPOSITORY) private readonly repo: ILicenseRepository,
    private readonly audit: AuditService,
  ) {}

  async create(input: CreateLicenseInput, actor: Actor): Promise<SoftwareLicense> {
    const license = await this.repo.create(input);
    await this.audit.record({
      actorId: actor.sub,
      actorEmail: actor.email,
      action: 'license.created',
      resourceType: 'software_license',
      resourceId: license.id,
      metadata: { name: license.name, vendor: license.vendor },
    });
    return license;
  }

  async getById(id: string): Promise<SoftwareLicense> {
    const license = await this.repo.findById(id);
    if (!license) throw new NotFoundException(ErrorCodes.NOT_FOUND, 'License not found');
    return license;
  }

  async list(
    filters: LicenseFilters,
    limit: number,
    offset: number,
  ): Promise<{ rows: SoftwareLicense[]; total: number }> {
    return this.repo.list(filters, limit, offset);
  }

  async update(id: string, input: UpdateLicenseInput, actor: Actor): Promise<SoftwareLicense> {
    await this.getById(id);
    const updated = await this.repo.update(id, input);
    if (!updated) throw new NotFoundException(ErrorCodes.NOT_FOUND, 'License not found');
    await this.audit.record({
      actorId: actor.sub,
      actorEmail: actor.email,
      action: 'license.updated',
      resourceType: 'software_license',
      resourceId: id,
    });
    return updated;
  }

  async delete(id: string, actor: Actor): Promise<void> {
    await this.getById(id);
    const usedSeats = await this.repo.countActiveSeats(id);
    if (usedSeats > 0) {
      throw new PreconditionFailedException(
        ErrorCodes.PRECONDITION_FAILED,
        `Cannot delete license with ${usedSeats} active assignment(s). Revoke all seats first.`,
      );
    }
    await this.repo.delete(id);
    await this.audit.record({
      actorId: actor.sub,
      actorEmail: actor.email,
      action: 'license.deleted',
      resourceType: 'software_license',
      resourceId: id,
    });
  }

  async assign(
    licenseId: string,
    employeeId: string,
    notes: string | null,
    actor: Actor,
  ): Promise<LicenseAssignment> {
    const license = await this.getById(licenseId);

    const existing = await this.repo.findActiveAssignment(licenseId, employeeId);
    if (existing) {
      throw new ConflictException(ErrorCodes.CONFLICT, 'Employee already has an active seat for this license');
    }

    if (license.seatCount != null) {
      const used = await this.repo.countActiveSeats(licenseId);
      if (used >= license.seatCount) {
        throw new PreconditionFailedException(ErrorCodes.PRECONDITION_FAILED, 'No seats available for this license');
      }
    }

    const assignment = await this.repo.assign(licenseId, employeeId, notes);
    await this.audit.record({
      actorId: actor.sub,
      actorEmail: actor.email,
      action: 'license.seat_assigned',
      resourceType: 'license_assignment',
      resourceId: assignment.id,
      metadata: { licenseId, employeeId },
    });
    return assignment;
  }

  async revoke(assignmentId: string, actor: Actor): Promise<void> {
    await this.repo.revoke(assignmentId);
    await this.audit.record({
      actorId: actor.sub,
      actorEmail: actor.email,
      action: 'license.seat_revoked',
      resourceType: 'license_assignment',
      resourceId: assignmentId,
    });
  }

  async listAssignments(licenseId: string, includeRevoked = false): Promise<LicenseAssignment[]> {
    await this.getById(licenseId);
    return this.repo.listAssignments(licenseId, includeRevoked);
  }

  async getUtilization(): Promise<LicenseUtilization[]> {
    return this.repo.getUtilization();
  }
}
