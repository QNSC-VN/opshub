/**
 * OpenTelemetry bootstrap for the API — must be the very first import in main.ts, so
 * auto-instrumentation patches HTTP, pg, ioredis and the AWS SDK before any module loads
 * them.
 *
 * The implementation is shared, in `@qnsc-vn/observability`. Imported from its `/otel`
 * subpath rather than the package root on purpose: the root barrel reaches Nest and pino,
 * which would then be required BEFORE instrumentation is installed — defeating the reason
 * this import sits at the top of main.ts.
 *
 * This replaced a local copy in libs/platform. That copy had drifted behind the package in
 * ways nobody could see from reading it: no sampler (so `OTEL_SAMPLING_PROBABILITY` was
 * configured and ignored until #110 added one here), no `service.namespace` or
 * `service.instance.id`, no deployment-environment attribute, and no batch tuning. Sharing
 * one implementation is what stops that happening again — and it is why the sampler spec
 * that lived beside the local copy is gone: the behaviour it pinned is the package's now,
 * and duplicating the assertion here would only pin our copy of someone else's decision.
 *
 * Shutdown: call `shutdownOtel()` from the main.ts signal handler BEFORE `app.close()`, so
 * in-flight spans are exported rather than dropped. Do NOT register a second SIGTERM
 * handler here — main.ts owns the shutdown sequence.
 */
import { shutdownOtel, startOtel } from '@qnsc-vn/observability/otel';

export { shutdownOtel };

// `OTEL_SERVICE_NAME` overrides this, and the stack sets it per service
// (`<product>-api`), so the default is the local-development value.
startOtel({ defaultServiceName: 'opshub-api' });
