import { SpanStatusCode, trace } from '@opentelemetry/api';

/**
 * Wraps a service method in a named OTel child span.
 *
 * Usage:
 *   @Span()                   // span name = "ClassName.methodName"
 *   @Span('asset.validate')   // explicit name
 *   async createAsset(...) {}
 *
 * On uncaught exception the span status is set to ERROR and the error is recorded
 * before re-throwing, so it appears in distributed traces.
 */
export function Span(nameOverride?: string): MethodDecorator {
  return (target, propertyKey, descriptor: PropertyDescriptor) => {
    const original = descriptor.value as (...args: unknown[]) => Promise<unknown>;
    const spanName = nameOverride ?? `${target.constructor.name}.${String(propertyKey)}`;
    const tracer = trace.getTracer('opshub-api');

    descriptor.value = async function (...args: unknown[]) {
      return tracer.startActiveSpan(spanName, async (span) => {
        try {
          return await original.apply(this, args);
        } catch (err) {
          span.setStatus({ code: SpanStatusCode.ERROR, message: String(err) });
          span.recordException(err as Error);
          throw err;
        } finally {
          span.end();
        }
      });
    };

    return descriptor;
  };
}
