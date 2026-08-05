/**
 * OpenTelemetry bootstrap — must be registered BEFORE any NestJS imports.
 * Called from main.ts as `import './bootstrap/otel'` at the very top.
 *
 * Only activates when OTEL_ENABLED=true. In test and local dev environments
 * it is disabled by default (no exporter needed).
 *
 * Uses OTLP HTTP exporter — compatible with Grafana Alloy, Jaeger, and
 * OpenTelemetry Collector in front of AWS X-Ray / CloudWatch.
 */
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  AlwaysOnSampler,
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
  type Sampler,
} from '@opentelemetry/sdk-trace-base';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';

const enabled = process.env['OTEL_ENABLED'] === 'true';

/** Default when nothing is configured: keep every trace. */
export const DEFAULT_SAMPLING_PROBABILITY = 1;

/**
 * Build the trace sampler from `OTEL_SAMPLING_PROBABILITY`.
 *
 * Exported and pure so it can be tested, which is the whole reason it is a function.
 *
 * Why this exists at all: opshub maintains its OWN OTel bootstrap, while rally delegates to
 * `@qnsc-vn/observability`. That package already builds this sampler from the same variable —
 * so opshub declared `OTEL_SAMPLING_PROBABILITY` in its env schema and then ignored it, purely
 * because the local copy had drifted behind the shared one. The variable was configured,
 * documented and inert HERE, not in rally.
 *
 * The real fix is to adopt `@qnsc-vn/observability` and delete this file. Until then this
 * closes the gap, and the spec beside it is what makes the closure verifiable.
 *
 * NOTE one deliberate difference from the package: it defaults production to 0.1, this
 * defaults to 1. A default that silently discards 90% of traces is not something to inherit
 * by accident — when the package is adopted, set the probability explicitly per environment
 * rather than relying on either default.
 *
 * `ParentBasedSampler` wrapping the ratio sampler, not the ratio sampler alone. The ratio
 * decision is a function of the trace id, so applying it per span would agree with itself
 * inside one trace — but a request arriving with an already-sampled parent from another
 * service must be kept regardless of our ratio, or distributed traces come back with holes
 * that look like dropped instrumentation. ParentBased honours an incoming decision and only
 * consults the ratio when this service is the ROOT.
 *
 * At probability 1 an explicit `AlwaysOnSampler` is used rather than a ratio of 1. Both keep
 * everything, but the ratio path still computes a decision per root span, and "always on" is
 * what the default should say.
 *
 * An absent, unparseable, or out-of-range value falls back to 1 — toward full fidelity
 * rather than silent data loss, because a typo in a deploy variable must not quietly stop
 * telemetry. Out-of-range is clamped rather than rejected: this runs before the Nest config
 * module validates anything, so throwing here would take the process down at import time.
 */
export function resolveSampler(env: NodeJS.ProcessEnv = process.env): Sampler {
  const raw = env['OTEL_SAMPLING_PROBABILITY'];
  const parsed = raw === undefined || raw.trim() === '' ? NaN : Number(raw);
  const probability = Number.isFinite(parsed)
    ? Math.min(1, Math.max(0, parsed))
    : DEFAULT_SAMPLING_PROBABILITY;

  return probability >= 1
    ? new AlwaysOnSampler()
    : new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(probability) });
}

let _sdk: NodeSDK | undefined;

/**
 * Flush pending spans and shut down the SDK.
 * Called from main.ts signal handler BEFORE app.close() so in-flight spans are
 * exported before DB/cache connections close underneath them.
 */
export async function shutdownOtel(): Promise<void> {
  if (_sdk) {
    await _sdk.shutdown();
  }
}

if (enabled) {
  const serviceName = process.env['OTEL_SERVICE_NAME'] ?? 'opshub-api';
  const serviceVersion = process.env['SERVICE_VERSION'] ?? 'dev';
  const endpoint = process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] ?? 'http://localhost:4318';

  _sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: serviceName,
      [ATTR_SERVICE_VERSION]: serviceVersion,
    }),
    sampler: resolveSampler(),
    traceExporter: new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }),
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({ url: `${endpoint}/v1/metrics` }),
      exportIntervalMillis: 30_000,
    }),
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': { enabled: false },
        '@opentelemetry/instrumentation-dns': { enabled: false },
        '@opentelemetry/instrumentation-net': { enabled: false },
      }),
    ],
  });

  _sdk.start();
}
