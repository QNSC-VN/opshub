import { Injectable, Logger } from '@nestjs/common';
import { AppConfigService, InjectDrizzle, type DrizzleDB } from '@platform';
import { Client } from '@microsoft/microsoft-graph-client';
import { ClientSecretCredential } from '@azure/identity';
import { TokenCredentialAuthenticationProvider } from '@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials/index.js';
import { newId } from '@shared-kernel';
import { desc, sql, gte } from 'drizzle-orm';
import { secureScoreSnapshots, baselineChecks } from '../../../../../db/schema';

// ── Graph types ───────────────────────────────────────────────────────────────

interface GraphSecureScore {
  id: string;
  createdDateTime: string;
  currentScore: number;
  maxScore: number;
  enabledServices?: string[];
}

interface GraphSecureScoreControl {
  id: string;
  title: string;
  category: string;
  implementationStatus: 'implemented' | 'notImplemented' | 'planned' | 'ignored' | 'unknown' | null;
  controlScore: number;
  maxScore: number;
}

interface GraphDeviceConfiguration {
  id: string;
  displayName: string;
  '@odata.type': string;
}

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable()
export class GraphSecureScoreService {
  private readonly logger = new Logger(GraphSecureScoreService.name);

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
   * Pull the latest Secure Score from Graph and persist a snapshot.
   * Only inserts if no snapshot exists for today's date yet.
   */
  async syncSecureScore(): Promise<{ score: number; maxScore: number; percentage: number } | null> {
    if (!this.isEnabled()) return null;

    const client = this.buildClient();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const res: { value: GraphSecureScore[] } = await client
      .api('/security/secureScores?$top=1')
      .get();

    const latest = res.value?.[0];
    if (!latest) return null;

    const scoreDate = latest.createdDateTime.split('T')[0];
    const percentage = latest.maxScore > 0
      ? (latest.currentScore / latest.maxScore) * 100
      : 0;

    // Upsert: skip if snapshot for this date already exists
    await this.db
      .insert(secureScoreSnapshots)
      .values({
        id: newId(),
        score: String(latest.currentScore),
        maxScore: String(latest.maxScore),
        percentageScore: String(percentage.toFixed(2)),
        scoreDate,
      })
      .onConflictDoNothing();

    this.logger.log(`Secure Score synced: ${latest.currentScore}/${latest.maxScore} (${percentage.toFixed(1)}%)`);
    return { score: latest.currentScore, maxScore: latest.maxScore, percentage };
  }

  /**
   * Sync top improvement actions as baseline checks.
   * Maps Graph control profiles to our `baseline_checks` table.
   */
  async syncBaselineChecks(): Promise<number> {
    if (!this.isEnabled()) return 0;

    const client = this.buildClient();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const res: { value: GraphSecureScoreControl[] } = await client
      .api('/security/secureScoreControlProfiles?$top=100')
      .get();

    const controls = res.value ?? [];
    const now = new Date();

    // Delete stale checks from previous sync cycle
    await this.db.delete(baselineChecks);

    const rows = controls.map((c) => {
      const status = this.mapControlStatus(c.implementationStatus);
      const category = this.mapControlCategory(c.category);
      return {
        id: newId(),
        category,
        checkName: c.title,
        status,
        expectedValue: String(c.maxScore),
        actualValue: String(c.controlScore),
        details: c.category,
        checkedAt: now,
      };
    });

    if (rows.length > 0) {
      await this.db.insert(baselineChecks).values(rows);
    }

    this.logger.log(`Baseline checks synced: ${rows.length} controls`);
    return rows.length;
  }

  private mapControlStatus(status: string | null): string {
    switch (status) {
      case 'implemented': return 'pass';
      case 'notImplemented': return 'fail';
      case 'planned': return 'warning';
      case 'ignored': return 'warning';
      default: return 'not_applicable';
    }
  }

  private mapControlCategory(category: string): string {
    const lower = category?.toLowerCase() ?? '';
    if (lower.includes('asr') || lower.includes('attack')) return 'asr';
    if (lower.includes('firewall') || lower.includes('network')) return 'firewall';
    if (lower.includes('encrypt')) return 'encryption';
    if (lower.includes('device') || lower.includes('endpoint')) return 'endpoint';
    if (lower.includes('identity') || lower.includes('account')) return 'identity';
    return 'other';
  }

  // ── Read queries (for controller) ─────────────────────────────────────────

  async getScoreHistory(days = 30): Promise<Array<{ scoreDate: string; percentageScore: string }>> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffDate = cutoff.toISOString().split('T')[0];

    return this.db
      .select({ scoreDate: secureScoreSnapshots.scoreDate, percentageScore: secureScoreSnapshots.percentageScore })
      .from(secureScoreSnapshots)
      .where(gte(secureScoreSnapshots.scoreDate, cutoffDate))
      .orderBy(secureScoreSnapshots.scoreDate)
      .limit(days);
  }

  async getLatestScore(): Promise<{ score: string; maxScore: string; percentageScore: string; scoreDate: string } | null> {
    const rows = await this.db
      .select()
      .from(secureScoreSnapshots)
      .orderBy(desc(secureScoreSnapshots.scoreDate))
      .limit(1);
    return rows[0] ?? null;
  }

  async getBaselineChecks(category?: string): Promise<typeof baselineChecks.$inferSelect[]> {
    const query = this.db
      .select()
      .from(baselineChecks)
      .orderBy(baselineChecks.category, baselineChecks.checkName);

    if (category) {
      return query.where(sql`${baselineChecks.category} = ${category}`);
    }
    return query;
  }

  async getBaselineSummary(): Promise<Record<string, { pass: number; fail: number; warning: number; total: number }>> {
    const rows = await this.db
      .select({ category: baselineChecks.category, status: baselineChecks.status })
      .from(baselineChecks);

    const summary: Record<string, { pass: number; fail: number; warning: number; total: number }> = {};
    for (const row of rows) {
      if (!summary[row.category]) {
        summary[row.category] = { pass: 0, fail: 0, warning: 0, total: 0 };
      }
      const cat = summary[row.category];
      cat.total++;
      if (row.status === 'pass') cat.pass++;
      else if (row.status === 'fail') cat.fail++;
      else if (row.status === 'warning') cat.warning++;
    }
    return summary;
  }
}
