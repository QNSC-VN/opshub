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
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';

const enabled = process.env['OTEL_ENABLED'] === 'true';

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
