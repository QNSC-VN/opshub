import { Injectable } from '@nestjs/common';
import { metrics } from '@opentelemetry/api';
import {
  bulkhead,
  BulkheadRejectedError,
  circuitBreaker,
  ConsecutiveBreaker,
  ExponentialBackoff,
  handleAll,
  type IPolicy,
  retry,
  timeout,
  TimeoutStrategy,
  wrap,
} from 'cockatiel';

// ── OTel metrics instruments (module-scoped singletons) ──────────────────────
const meter = metrics.getMeter('opshub-api');
const callsCounter = meter.createCounter('resilience.calls.total', {
  description: 'Total outcomes of resilience-wrapped calls',
});
const durationHistogram = meter.createHistogram('resilience.calls.duration_ms', {
  description: 'Duration of resilience-wrapped calls',
  unit: 'ms',
  advice: { explicitBucketBoundaries: [10, 50, 100, 250, 500, 1000, 2500, 5000, 10000] },
});

/**
 * Pre-configured resilience policies for external and internal calls.
 *
 * Use `resilience.execute(operationName, policy, fn)` to get automatic metrics.
 * Use the bare policy (`.external`, `.database` etc.) when you need more control.
 *
 * Presets:
 *   external  — 3 retries + 10s timeout   (Graph API, third-party services)
 *   database  — 2 retries + 5s timeout    + circuit-breaker after 5 consecutive failures
 *   cache     — 0 retries + 1s timeout    (fast-fail, not worth retrying)
 *   background — 5 retries + 30s timeout  (low-urgency async work)
 */
@Injectable()
export class ResilienceService {
  /** External API: 3 retries with jittered backoff, 10 s ceiling */
  readonly external: IPolicy = wrap(
    retry(handleAll, {
      maxAttempts: 3,
      backoff: new ExponentialBackoff({ initialDelay: 200, maxDelay: 2_000 }),
    }),
    timeout(10_000, TimeoutStrategy.Cooperative),
  );

  /** Database: 2 retries, 5 s ceiling, circuit-breaker trips after 5 consecutive failures */
  readonly database: IPolicy = wrap(
    retry(handleAll, {
      maxAttempts: 2,
      backoff: new ExponentialBackoff({ initialDelay: 100, maxDelay: 1_000 }),
    }),
    circuitBreaker(handleAll, {
      halfOpenAfter: 10_000,
      breaker: new ConsecutiveBreaker(5),
    }),
    timeout(5_000, TimeoutStrategy.Cooperative),
  );

  /** Cache: no retries, 1 s fast-fail (treat cache as optional) */
  readonly cache: IPolicy = timeout(1_000, TimeoutStrategy.Cooperative);

  /** Background jobs: 5 retries, 30 s ceiling */
  readonly background: IPolicy = wrap(
    retry(handleAll, {
      maxAttempts: 5,
      backoff: new ExponentialBackoff({ initialDelay: 500, maxDelay: 10_000 }),
    }),
    timeout(30_000, TimeoutStrategy.Cooperative),
  );

  /** @deprecated use named preset or execute() — kept for backward compat */
  get internal(): IPolicy { return this.database; }

  // ── Instrumented executor ─────────────────────────────────────────────────

  /**
   * Execute `fn` under `policy` and record OTel metrics.
   *
   * @param operation  Friendly name used as the `operation` attribute in metrics
   * @param policy     One of the named presets (this.external, this.database, …)
   * @param fn         The async work to protect
   *
   * @example
   *   const user = await this.resilience.execute(
   *     'graph.getUser',
   *     this.resilience.external,
   *     () => this.graphClient.getUser(id),
   *   );
   */
  async execute<T>(operation: string, policy: IPolicy, fn: () => Promise<T>): Promise<T> {
    const start = Date.now();
    const attrs = { operation };
    try {
      const result = await policy.execute(fn);
      callsCounter.add(1, { ...attrs, outcome: 'success' });
      durationHistogram.record(Date.now() - start, attrs);
      return result;
    } catch (err) {
      const outcome = err instanceof BulkheadRejectedError ? 'bulkhead_rejected' : 'failure';
      callsCounter.add(1, { ...attrs, outcome });
      durationHistogram.record(Date.now() - start, attrs);
      throw err;
    }
  }

  // ── Bulkhead factory ──────────────────────────────────────────────────────

  /**
   * Create a bulkhead policy that limits concurrent executions.
   * Useful for isolating resource-intensive operations (e.g. large exports)
   * from normal request traffic.
   *
   * @param maxConcurrent  Max in-flight calls (excess → queued or rejected)
   * @param maxQueue       Max queued calls before BulkheadRejectedError is thrown
   */
  createBulkhead(maxConcurrent: number, maxQueue: number): IPolicy {
    return bulkhead(maxConcurrent, maxQueue);
  }

  /** One-off timeout-only policy (no retries). */
  withTimeout(ms: number): IPolicy {
    return timeout(ms, TimeoutStrategy.Cooperative);
  }
}
