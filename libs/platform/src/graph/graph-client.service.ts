import { Injectable, Logger } from '@nestjs/common';
import { ClientSecretCredential } from '@azure/identity';
import { Client } from '@microsoft/microsoft-graph-client';
import { TokenCredentialAuthenticationProvider } from '@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials/index.js';
import { AppConfigService } from '../config/app-config.service';

/**
 * The `.default` scope: "every application permission this app registration has been granted".
 *
 * Client-credentials flow has no user to consent, so a scope list would be a second place to keep the
 * app's permissions in step with its Entra registration. Naming it once means nobody has to.
 */
const GRAPH_SCOPE = 'https://graph.microsoft.com/.default';

/**
 * The one Graph client, and the one answer to whether Graph is configured.
 *
 * FIVE SERVICES BUILT THIS. `GraphPimService`, `GraphProvisioningService`, `GraphSyncService`,
 * `ShadowItDetectionService` and `GraphSecureScoreService` each carried a private `buildClient()` and
 * a public `isEnabled()` — same three env vars, same credential, same scope, in three different
 * spellings of the same boolean (`Boolean(a && b && c)`, `!!(a && b && c)`, and a three-`const`
 * version of it).
 *
 * A NEW CREDENTIAL PER CALL WAS THE REAL COST. `buildClient()` was called per operation, and
 * `ClientSecretCredential` caches its access token IN THE INSTANCE — so a fresh instance every call
 * meant a fresh client-credentials round trip to Entra for every Graph operation. Offboarding one
 * employee disables the account and revokes their sessions: two operations, two token requests, for a
 * token that is valid for an hour and was already in hand. Entra throttles the token endpoint, so this
 * is a rate limit reached at 1/nth of the traffic that should reach it, and the symptom would be a
 * failed offboarding rather than a slow one.
 *
 * So the client is built ONCE and reused. That is safe because the three values come from validated
 * config that cannot change without a restart, and the credential refreshes its own token before
 * expiry — the caching is the SDK's, this just stops throwing it away.
 *
 * `client()` REFUSES RATHER THAN ASSERTS. Every copy of `buildClient()` used `!` on all three values,
 * so calling it unconfigured produced whatever the Azure SDK says about an empty tenant id — a
 * message about the wrong layer. The check and the build now live together, and the failure names the
 * variables somebody has to set.
 */
@Injectable()
export class GraphClientService {
  private readonly logger = new Logger(GraphClientService.name);
  private cached: Client | undefined;

  constructor(private readonly config: AppConfigService) {}

  /**
   * True when all three Graph variables are set.
   *
   * Every caller checks this first, and every Graph-touching path is a no-op without it: Graph is an
   * optional integration, so an unconfigured tenant must be a quiet skip rather than a broken feature.
   */
  isEnabled(): boolean {
    return Boolean(
      this.config.get('ENTRA_TENANT_ID') &&
      this.config.get('ENTRA_CLIENT_ID') &&
      this.config.get('GRAPH_CLIENT_SECRET'),
    );
  }

  /**
   * The shared client. Throws if Graph is not configured — check `isEnabled()` first.
   *
   * The throw is deliberate and is not a fallback to a no-op client: a caller that skipped the check
   * is about to perform a real action (disable an account, elevate a role) and silently doing nothing
   * would report success for work that never happened.
   */
  client(): Client {
    if (this.cached) return this.cached;

    const tenantId = this.config.get('ENTRA_TENANT_ID');
    const clientId = this.config.get('ENTRA_CLIENT_ID');
    const clientSecret = this.config.get('GRAPH_CLIENT_SECRET');
    if (!tenantId || !clientId || !clientSecret) {
      throw new Error(
        'Microsoft Graph is not configured: set ENTRA_TENANT_ID, ENTRA_CLIENT_ID and ' +
          'GRAPH_CLIENT_SECRET, or check isEnabled() before asking for a client.',
      );
    }

    const authProvider = new TokenCredentialAuthenticationProvider(
      new ClientSecretCredential(tenantId, clientId, clientSecret),
      { scopes: [GRAPH_SCOPE] },
    );
    this.cached = Client.initWithMiddleware({ authProvider });
    // Logged once, because that is the point: a second line here means the cache is not holding.
    this.logger.log('Microsoft Graph client initialised');
    return this.cached;
  }
}
