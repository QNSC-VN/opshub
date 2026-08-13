import type { DbExecutor } from '@platform';
import type {
  AccessGrant,
  AccessRequest,
  AccessRequestFilters,
  CreateAccessRequestInput,
} from '../access-request.types';

export const ACCESS_REQUEST_REPOSITORY = Symbol('ACCESS_REQUEST_REPOSITORY');

export interface IAccessRequestRepository {
  create(input: CreateAccessRequestInput, tx?: DbExecutor): Promise<AccessRequest>;
  findById(id: string): Promise<AccessRequest | null>;
  list(
    filters: AccessRequestFilters,
    limit: number,
    offset: number,
  ): Promise<{ rows: AccessRequest[]; total: number }>;

  /** Transition a request to approved + insert its grant (within tx). */
  approve(
    requestId: string,
    reviewerId: string,
    note: string | null,
    grant: Omit<AccessGrant, 'revokedAt'>,
    tx: DbExecutor,
  ): Promise<void>;
  reject(
    requestId: string,
    reviewerId: string,
    note: string | null,
    tx?: DbExecutor,
  ): Promise<void>;
  revokeGrant(grantId: string, tx?: DbExecutor): Promise<void>;
  findGrantById(grantId: string): Promise<AccessGrant | null>;
  listActiveGrants(granteeId: string): Promise<AccessGrant[]>;
}
