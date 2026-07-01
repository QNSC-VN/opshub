import { Injectable, Logger } from '@nestjs/common';
import { AppConfigService, InjectDrizzle, type DrizzleDB } from '@platform';
import { Client } from '@microsoft/microsoft-graph-client';
import { ClientSecretCredential } from '@azure/identity';
import { TokenCredentialAuthenticationProvider } from '@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials/index.js';
import { newId } from '@shared-kernel';
import { complianceFindings } from '../../../../../db/schema';
import { eq } from 'drizzle-orm';

/**
 * Minimal typed subset of a Graph managedDevice response.
 * Full schema: https://learn.microsoft.com/graph/api/resources/intune-devices-manageddevice
 */
interface GraphDevice {
  id: string;
  deviceName: string | null;
  operatingSystem: string | null;
  osVersion: string | null;
  complianceState: 'compliant' | 'noncompliant' | 'unknown' | 'notApplicable' | 'inGracePeriod' | 'configManager' | null;
  isEncrypted: boolean;
  userId: string | null;
  userPrincipalName: string | null;
  lastSyncDateTime: string | null;
}

interface PageCollection<T> {
  value: T[];
  '@odata.nextLink'?: string;
  '@odata.deltaLink'?: string;
}

@Injectable()
export class GraphSyncService {
  private readonly logger = new Logger(GraphSyncService.name);

  /** In-memory delta link — persists across cron invocations within a single process. */
  private deltaLink: string | null = null;

  constructor(
    private readonly config: AppConfigService,
    @InjectDrizzle() private readonly db: DrizzleDB,
  ) {}

  /** True when all three Graph env vars are set. */
  isEnabled(): boolean {
    const tenantId = this.config.get('ENTRA_TENANT_ID');
    const clientId = this.config.get('ENTRA_CLIENT_ID');
    const clientSecret = this.config.get('GRAPH_CLIENT_SECRET');
    return Boolean(tenantId && clientId && clientSecret);
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
   * Runs a Graph delta sync of managed devices from Intune.
   * On first run: fetches all devices. Subsequent runs: only changed records.
   */
  async syncDevices(): Promise<{ devices: number; findings: number }> {
    if (!this.isEnabled()) return { devices: 0, findings: 0 };

    const client = this.buildClient();

    const select = 'id,deviceName,operatingSystem,osVersion,complianceState,isEncrypted,userId,userPrincipalName,lastSyncDateTime';
    const startUrl = this.deltaLink
      ?? `/deviceManagement/managedDevices/delta?$select=${select}`;

    let url: string | undefined = startUrl;
    let totalDevices = 0;
    let totalFindings = 0;

    while (url) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const page: PageCollection<GraphDevice> = await client.api(url).get();
      const devices = page.value ?? [];

      totalDevices += devices.length;
      totalFindings += await this.processDeviceBatch(devices);

      if (page['@odata.deltaLink']) {
        this.deltaLink = page['@odata.deltaLink'];
      }

      url = page['@odata.nextLink'];
    }

    this.logger.log(`Graph sync complete: ${totalDevices} devices, ${totalFindings} new findings`);
    return { devices: totalDevices, findings: totalFindings };
  }

  private async processDeviceBatch(devices: GraphDevice[]): Promise<number> {
    let findings = 0;

    for (const device of devices) {
      const issues: string[] = [];

      if (device.complianceState === 'noncompliant') issues.push('noncompliant');
      if (!device.isEncrypted) issues.push('unencrypted');

      if (issues.length === 0) continue;

      // Deduplicate — each device+issue combo gets at most one open finding.
      const sourceKey = `intune:${device.id}:${issues.sort().join(',')}`;
      const existing = await this.db
        .select({ id: complianceFindings.id })
        .from(complianceFindings)
        .where(eq(complianceFindings.source, sourceKey))
        .limit(1);

      if (existing.length > 0) continue;

      await this.db.insert(complianceFindings).values({
        id: newId(),
        softwareName: device.deviceName ?? `device:${device.id}`,
        softwareVersion: device.osVersion ?? null,
        severity: issues.includes('noncompliant') ? 'high' : 'medium',
        source: sourceKey,
        detectedAt: new Date(),
      });

      findings++;
    }

    return findings;
  }
}
