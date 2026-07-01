import { Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '@platform';
import { Client } from '@microsoft/microsoft-graph-client';
import { ClientSecretCredential } from '@azure/identity';
import { TokenCredentialAuthenticationProvider } from '@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials/index.js';

/**
 * Integrates with Entra PIM (Privileged Identity Management) via Microsoft Graph.
 * All methods are no-ops when Graph credentials are not configured.
 *
 * Graph endpoint:
 *   POST /roleManagement/directory/roleAssignmentScheduleRequests
 *   https://learn.microsoft.com/graph/api/rbacapplication-post-roleassignmentschedulerequests
 */
@Injectable()
export class GraphPimService {
  private readonly logger = new Logger(GraphPimService.name);

  constructor(private readonly config: AppConfigService) {}

  isEnabled(): boolean {
    return Boolean(
      this.config.get('ENTRA_TENANT_ID') &&
        this.config.get('ENTRA_CLIENT_ID') &&
        this.config.get('GRAPH_CLIENT_SECRET'),
    );
  }

  private buildClient(): Client {
    const tenantId = this.config.get('ENTRA_TENANT_ID')!;
    const clientId = this.config.get('ENTRA_CLIENT_ID')!;
    const clientSecret = this.config.get('GRAPH_CLIENT_SECRET')!;

    const credential = new ClientSecretCredential(tenantId, clientId, clientSecret);
    const authProvider = new TokenCredentialAuthenticationProvider(credential, {
      scopes: ['https://graph.microsoft.com/.default'],
    });
    return Client.initWithMiddleware({ authProvider });
  }

  /**
   * Activates a PIM role assignment for a user.
   *
   * @param principalEntraOid - The user's Entra object ID (from employees.entraOid)
   * @param roleDefinitionId  - The Entra role definition GUID
   *                            (e.g. "62e90394-69f5-4237-9190-012177145e10" = Global Admin)
   *                            or the role display name (we resolve it if not a GUID)
   * @param expiresAt         - When the elevation should auto-revoke
   * @param justification     - Business justification recorded in Entra PIM audit
   */
  async elevateRole(
    principalEntraOid: string,
    roleDefinitionId: string,
    expiresAt: Date,
    justification: string,
  ): Promise<void> {
    if (!this.isEnabled()) return;

    const client = this.buildClient();

    const body = {
      action: 'adminAssign',
      justification,
      roleDefinitionId,
      directoryScopeId: '/',
      principalId: principalEntraOid,
      scheduleInfo: {
        startDateTime: new Date().toISOString(),
        expiration: {
          type: 'afterDateTime',
          endDateTime: expiresAt.toISOString(),
        },
      },
    };

    try {
      await client.api('/roleManagement/directory/roleAssignmentScheduleRequests').post(body);
      this.logger.log(
        `PIM elevation: principal=${principalEntraOid} role=${roleDefinitionId} expires=${expiresAt.toISOString()}`,
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`PIM elevation failed for ${principalEntraOid}: ${msg}`);
      // Best-effort: DB grant is already written. Ops can retry via Azure Portal.
      // TODO: upgrade to Outbox-driven retry for production SLA guarantee.
    }
  }

  /**
   * Revokes a PIM role assignment by removing the schedule request.
   * Best-effort — failure is logged but doesn't throw.
   */
  async revokeRole(
    principalEntraOid: string,
    roleDefinitionId: string,
    justification: string,
  ): Promise<void> {
    if (!this.isEnabled()) return;

    const client = this.buildClient();

    const body = {
      action: 'adminRemove',
      justification,
      roleDefinitionId,
      directoryScopeId: '/',
      principalId: principalEntraOid,
      scheduleInfo: {
        startDateTime: new Date().toISOString(),
        expiration: { type: 'noExpiration' },
      },
    };

    try {
      await client.api('/roleManagement/directory/roleAssignmentScheduleRequests').post(body);
      this.logger.log(`PIM revoked: principal=${principalEntraOid} role=${roleDefinitionId}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`PIM revoke failed for ${principalEntraOid}: ${msg}`);
    }
  }
}
