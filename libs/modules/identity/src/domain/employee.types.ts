import type { employeeStatusEnum } from '../../../../../db/schema';

export type EmployeeStatus = (typeof employeeStatusEnum.enumValues)[number];

export interface Employee {
  id: string;
  entraOid: string | null;
  email: string;
  displayName: string;
  department: string | null;
  jobTitle: string | null;
  managerId: string | null;
  roles: string[];
  status: EmployeeStatus;
  /** S3 object key for the profile photo; null until an avatar is uploaded. */
  photoStorageKey: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateEmployeeInput {
  email: string;
  displayName: string;
  department?: string | null;
  jobTitle?: string | null;
  managerId?: string | null;
  /**
   * Only set by the Entra SSO JIT-provisioning path (roles from the token's
   * App Role claim). The directory/employee HTTP endpoints never set this —
   * role assignment is governed by the authz module.
   */
  roles?: string[];
  entraOid?: string | null;
}

export interface UpdateEmployeeInput {
  displayName?: string;
  department?: string | null;
  jobTitle?: string | null;
  managerId?: string | null;
}

export interface EmployeeFilters {
  status?: EmployeeStatus;
  department?: string;
  search?: string;
}
