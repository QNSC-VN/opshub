import { Injectable, Logger } from '@nestjs/common';
import { Client } from '@microsoft/microsoft-graph-client';
import { ClientSecretCredential } from '@azure/identity';
import { TokenCredentialAuthenticationProvider } from '@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials/index.js';
import { AppConfigService } from '@platform';

@Injectable()
export class GraphProvisioningService {
  private readonly logger = new Logger(GraphProvisioningService.name);

  constructor(private readonly config: AppConfigService) {}

  isEnabled(): boolean {
    return !!(
      this.config.get('ENTRA_TENANT_ID') &&
      this.config.get('ENTRA_CLIENT_ID') &&
      this.config.get('GRAPH_CLIENT_SECRET')
    );
  }

  private buildClient(): Client {
    const credential = new ClientSecretCredential(
      this.config.get('ENTRA_TENANT_ID')!,
      this.config.get('ENTRA_CLIENT_ID')!,
      this.config.get('GRAPH_CLIENT_SECRET')!,
    );
    const authProvider = new TokenCredentialAuthenticationProvider(credential, {
      scopes: ['https://graph.microsoft.com/.default'],
    });
    return Client.initWithMiddleware({ authProvider });
  }

  async disableEntraUser(entraOid: string): Promise<void> {
    if (!this.isEnabled()) return;
    try {
      await this.buildClient().api(`/users/${entraOid}`).patch({ accountEnabled: false });
      this.logger.log(`Disabled Entra account OID=${entraOid}`);
    } catch (err) {
      this.logger.error(`Failed to disable Entra account OID=${entraOid}: ${String(err)}`);
      throw err;
    }
  }

  async enableEntraUser(entraOid: string): Promise<void> {
    if (!this.isEnabled()) return;
    try {
      await this.buildClient().api(`/users/${entraOid}`).patch({ accountEnabled: true });
      this.logger.log(`Enabled Entra account OID=${entraOid}`);
    } catch (err) {
      this.logger.error(`Failed to enable Entra account OID=${entraOid}: ${String(err)}`);
      throw err;
    }
  }
}
