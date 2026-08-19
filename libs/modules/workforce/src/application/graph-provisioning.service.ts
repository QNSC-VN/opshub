import { Injectable, Logger } from '@nestjs/common';
import { GraphClientService } from '@platform';

@Injectable()
export class GraphProvisioningService {
  private readonly logger = new Logger(GraphProvisioningService.name);

  constructor(private readonly graph: GraphClientService) {}

  /**
   * True when Graph is configured. Delegated: the answer is a property of the deployment, not of this
   * service, and five copies of it could disagree.
   */
  isEnabled(): boolean {
    return this.graph.isEnabled();
  }

  async disableEntraUser(entraOid: string): Promise<void> {
    if (!this.isEnabled()) return;
    try {
      await this.graph.client().api(`/users/${entraOid}`).patch({ accountEnabled: false });
      this.logger.log(`Disabled Entra account OID=${entraOid}`);
    } catch (err) {
      this.logger.error(`Failed to disable Entra account OID=${entraOid}: ${String(err)}`);
      throw err;
    }
  }

  async enableEntraUser(entraOid: string): Promise<void> {
    if (!this.isEnabled()) return;
    try {
      await this.graph.client().api(`/users/${entraOid}`).patch({ accountEnabled: true });
      this.logger.log(`Enabled Entra account OID=${entraOid}`);
    } catch (err) {
      this.logger.error(`Failed to enable Entra account OID=${entraOid}: ${String(err)}`);
      throw err;
    }
  }
}
