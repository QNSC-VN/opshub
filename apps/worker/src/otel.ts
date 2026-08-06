/**
 * OpenTelemetry bootstrap for the WORKER — must be the very first import in main.ts, so
 * auto-instrumentation patches pg, ioredis and the AWS SDK before any module loads them.
 * The relays are precisely the code whose latency and failures no request trace covers.
 *
 * Shared implementation, from `@qnsc-vn/observability/otel` — see apps/api/src/otel.ts for
 * why the subpath rather than the package root, and for what the local copy this replaced
 * had drifted behind.
 *
 * The default service name differs from the api's, which is the whole reason this file
 * exists separately rather than both apps importing one shared bootstrap: with a single
 * default, a worker whose `OTEL_SERVICE_NAME` was unset would report itself as the api and
 * its spans would land under the wrong service. The stack does set it per service, so this
 * is the local-development default — but a default that is wrong only when configuration is
 * missing is the kind that goes unnoticed.
 */
import { shutdownOtel, startOtel } from '@qnsc-vn/observability/otel';

export { shutdownOtel };

startOtel({ defaultServiceName: 'opshub-worker' });
