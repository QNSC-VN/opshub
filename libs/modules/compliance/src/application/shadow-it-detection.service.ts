import { Injectable, Logger } from '@nestjs/common';
import { AppConfigService, InjectDrizzle, type DrizzleDB } from '@platform';
import { Client } from '@microsoft/microsoft-graph-client';
import { ClientSecretCredential } from '@azure/identity';
import { TokenCredentialAuthenticationProvider } from '@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials/index.js';
import { newId } from '@shared-kernel';
import { eq, and } from 'drizzle-orm';
import { complianceFindings, softwareCatalog } from '../../../../../db/schema';

// ── Graph types ───────────────────────────────────────────────────────────────

interface GraphDetectedApp {
  id: string;
  displayName: string | null;
  version: string | null;
  sizeInByte: number | null;
  deviceCount: number | null;
}

// ── Service ───────────────────────────────────────────────────────────────────

/**
 * Shadow IT Detection — cross-references Intune detected apps against the
 * software catalog. Creates compliance findings for blacklisted and un-catalogued
 * applications found on managed devices.
 */
@Injectable()
export class ShadowItDetectionService {
  private readonly logger = new Logger(ShadowItDetectionService.name);

  constructor(
    private readonly config: AppConfigService,
    @InjectDrizzle() private readonly db: DrizzleDB,
  ) {}

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
   * Fetches the tenant-wide list of detected apps from Intune and creates
   * findings for:
   *   - blacklisted apps (severity: high)
   *   - apps in 'review' status (severity: medium)
   *
   * Returns counts of new findings created.
   */
  async detectShadowIt(): Promise<{ scanned: number; newFindings: number }> {
    if (!this.isEnabled()) return { scanned: 0, newFindings: 0 };

    const client = this.buildClient();
    const catalog = await this.loadCatalog();

    let url: string | undefined = '/deviceManagement/detectedApps?$top=100&$select=id,displayName,version,sizeInByte,deviceCount';
    let totalScanned = 0;
    let totalFindings = 0;

    while (url) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const page: { value: GraphDetectedApp[]; '@odata.nextLink'?: string } = await client.api(url).get();
      const apps = page.value ?? [];

      totalScanned += apps.length;
      totalFindings += await this.processBatch(apps, catalog);

      url = page['@odata.nextLink'];
    }

    this.logger.log(`Shadow IT scan complete: ${totalScanned} apps scanned, ${totalFindings} new findings`);
    return { scanned: totalScanned, newFindings: totalFindings };
  }

  private async loadCatalog(): Promise<Map<string, 'whitelisted' | 'blacklisted' | 'review'>> {
    const rows = await this.db
      .select({ name: softwareCatalog.name, listing: softwareCatalog.listing })
      .from(softwareCatalog);

    const map = new Map<string, 'whitelisted' | 'blacklisted' | 'review'>();
    for (const row of rows) {
      map.set(row.name.toLowerCase(), row.listing);
    }
    return map;
  }

  private async processBatch(
    apps: GraphDetectedApp[],
    catalog: Map<string, 'whitelisted' | 'blacklisted' | 'review'>,
  ): Promise<number> {
    let newFindings = 0;

    for (const app of apps) {
      const name = app.displayName ?? 'Unknown';
      const listing = catalog.get(name.toLowerCase());

      // Skip whitelisted software — no action needed
      if (listing === 'whitelisted') continue;

      const severity = listing === 'blacklisted' ? 'high' : 'medium';
      const sourceKey = `shadow-it:${app.id}`;

      // Deduplicate — skip if an open finding already exists for this app
      const existing = await this.db
        .select({ id: complianceFindings.id })
        .from(complianceFindings)
        .where(
          and(
            eq(complianceFindings.source, sourceKey),
            eq(complianceFindings.status, 'open'),
          ),
        )
        .limit(1);

      if (existing.length > 0) continue;

      await this.db.insert(complianceFindings).values({
        id: newId(),
        softwareName: name,
        softwareVersion: app.version ?? null,
        severity,
        source: sourceKey,
        status: 'open',
        detectedAt: new Date(),
      });

      newFindings++;
    }

    return newFindings;
  }

  /** Query findings raised by shadow IT detection (source starts with 'shadow-it:'). */
  async listShadowItFindings(limit = 50): Promise<typeof complianceFindings.$inferSelect[]> {
    const { like } = await import('drizzle-orm');
    return this.db
      .select()
      .from(complianceFindings)
      .where(like(complianceFindings.source, 'shadow-it:%'))
      .orderBy(complianceFindings.detectedAt)
      .limit(limit);
  }
}
