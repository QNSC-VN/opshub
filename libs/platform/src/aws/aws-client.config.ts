import type { AppConfigService } from '../config/app-config.service';

/**
 * Base configuration shared by every AWS SDK v3 client (SQS today; SNS and
 * Secrets Manager are already granted to the task roles in infra).
 * Only the fields the SDK constructors accept in common — feature-specific
 * options (e.g. S3 `forcePathStyle`) stay with their own client.
 */
export interface AwsClientBaseConfig {
  region: string;
  endpoint?: string;
  credentials?: { accessKeyId: string; secretAccessKey: string };
}

/**
 * Single source of truth for building AWS SDK client configuration.
 *
 * Two mutually-exclusive modes, selected by whether `AWS_ENDPOINT_URL` is set:
 *
 *  - **Real AWS (prod / staging)** — `AWS_ENDPOINT_URL` unset. Returns region
 *    only; the SDK resolves credentials from the ECS task-role provider chain.
 *    NEVER injects static keys here (least-privilege).
 *
 *  - **Local dev (LocalStack)** — `AWS_ENDPOINT_URL` set (http://localhost:4566
 *    via docker-compose.dev.yml). The default credential chain has no task role
 *    to resolve, so static credentials are passed explicitly. LocalStack accepts
 *    any value; the conventional `test`/`test` is used as a fallback.
 *
 * Reading from validated config rather than `process.env` is deliberate:
 * `@nestjs/config` only reliably surfaces schema-declared keys, so a raw
 * `process.env` lookup returns undefined in some processes (notably the worker,
 * which is the only AWS client site today).
 *
 * ONE caller at present, which is below the usual bar for extracting a helper.
 * It is shared anyway for two reasons: it is the only place the "no static
 * credentials against real AWS" rule is written down where a reviewer will see
 * it, and it keeps the file identical to rally's so the two repos stay diffable
 * — rally has five callers, and the divergence would only ever be discovered by
 * whoever added opshub's second client.
 *
 * NOTE: `StorageService` deliberately does NOT use this. Object storage selects
 * its backend with the separate `STORAGE_ENDPOINT` / `STORAGE_ACCESS_KEY_ID`
 * family, because the bucket can live in Cloudflare R2 — a different account
 * with different credentials — while SQS stays on AWS.
 */
export function buildAwsClientConfig(config: AppConfigService): AwsClientBaseConfig {
  const region = config.get('AWS_REGION');
  const endpoint = config.get('AWS_ENDPOINT_URL');

  if (!endpoint) {
    return { region };
  }

  return {
    region,
    endpoint,
    credentials: {
      accessKeyId: config.get('AWS_ACCESS_KEY_ID') ?? 'test',
      secretAccessKey: config.get('AWS_SECRET_ACCESS_KEY') ?? 'test',
    },
  };
}
