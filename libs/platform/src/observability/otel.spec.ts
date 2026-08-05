/**
 * Unit tests for the trace sampler.
 *
 * These exist because the variable they cover is inert in rally: `OTEL_SAMPLING_PROBABILITY`
 * is declared in its env schema and passed from Terraform with a comment about head sampling
 * and production cost, and nothing reads it — so rally samples every trace regardless of the
 * value. A knob that is configured, documented and ignored is worse than no knob, because it
 * reads as a cost control that is being applied.
 *
 * The sampler is the one part of the OTel bootstrap that can be tested: the rest of the file
 * runs at import time and starts an SDK. So the decision logic is a pure function, and this
 * asserts the decisions rather than the construction — `shouldSample` is called directly,
 * because "an instance of ParentBasedSampler was returned" would pass just as well against a
 * sampler configured with the wrong probability.
 */
import { SamplingDecision } from '@opentelemetry/sdk-trace-base';
import { ROOT_CONTEXT, SpanKind, trace, TraceFlags, type SpanContext } from '@opentelemetry/api';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SAMPLING_PROBABILITY, resolveSampler } from './otel';

/** Ask a sampler for its decision on a ROOT span (no parent in context). */
function decideRoot(sampler: ReturnType<typeof resolveSampler>, traceId: string) {
  return sampler.shouldSample(
    ROOT_CONTEXT,
    traceId,
    'GET /v1/assets',
    SpanKind.SERVER,
    {},
    [],
  ).decision;
}

/** Ask a sampler for its decision on a span whose PARENT arrived already sampled (or not). */
function decideWithParent(
  sampler: ReturnType<typeof resolveSampler>,
  traceId: string,
  parentSampled: boolean,
) {
  const parent: SpanContext = {
    traceId,
    spanId: '0000000000000001',
    traceFlags: parentSampled ? TraceFlags.SAMPLED : TraceFlags.NONE,
  };
  const ctx = trace.setSpanContext(ROOT_CONTEXT, parent);
  return sampler.shouldSample(ctx, traceId, 'GET /v1/assets', SpanKind.SERVER, {}, []).decision;
}

/**
 * A deterministic supply of VALID, full-entropy trace ids.
 *
 * Both properties were learned the hard way while writing this file:
 *
 *  - VALID: the all-zeroes id is invalid per the OTel spec and every sampler rejects it, so
 *    a first version "proved" a low probability drops spans when it had only proved that.
 *  - FULL ENTROPY across all 16 bytes: a second version used sequential ids
 *    (`0…001`, `0…002`), and the ratio sampler folds the id by XOR-ing its 4-byte chunks —
 *    so those all fold to tiny values, landed under every threshold, and 100% were sampled
 *    at a probability of 0.01.
 *
 * Seeded xorshift rather than `Math.random`, so a failure reproduces exactly. Filling all 32
 * hex characters means this makes no assumption about HOW the SDK folds an id into a
 * decision — only that it does.
 */
function traceIds(count: number): string[] {
  let state = 0x9e3779b9;
  const nextHex8 = (): string => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state.toString(16).padStart(8, '0');
  };
  return Array.from({ length: count }, () =>
    `${nextHex8()}${nextHex8()}${nextHex8()}${nextHex8()}`,
  );
}

/** Fraction of `ids` this sampler keeps as ROOT spans. */
function sampledFraction(sampler: ReturnType<typeof resolveSampler>, ids: string[]): number {
  const kept = ids.filter(
    (id) => decideRoot(sampler, id) === SamplingDecision.RECORD_AND_SAMPLED,
  ).length;
  return kept / ids.length;
}

const IDS = traceIds(2000);
/** One arbitrary valid id, for assertions that do not depend on which id it is. */
const ANY_TRACE_ID = IDS[0];

describe('resolveSampler', () => {
  it('keeps every root span when nothing is configured', () => {
    expect(sampledFraction(resolveSampler({}), IDS)).toBe(1);
  });

  it('defaults to a probability of 1', () => {
    expect(DEFAULT_SAMPLING_PROBABILITY).toBe(1);
  });

  // THE assertion that fails against rally's arrangement: a configured probability has to
  // change what happens, or the variable is decoration. Stated as a proportion because that
  // is the actual contract — which specific ids survive is the SDK's business.
  it('applies a configured probability instead of ignoring it', () => {
    const half = sampledFraction(resolveSampler({ OTEL_SAMPLING_PROBABILITY: '0.5' }), IDS);
    // Wide bounds: this asserts the knob is WIRED, not that the SDK's hash is uniform.
    // Rally's arrangement — the value read and discarded — scores exactly 1 here.
    expect(half).toBeGreaterThan(0.3);
    expect(half).toBeLessThan(0.7);
  });

  it('drops nearly everything at a very low probability', () => {
    const rare = sampledFraction(resolveSampler({ OTEL_SAMPLING_PROBABILITY: '0.01' }), IDS);
    expect(rare).toBeLessThan(0.05);
  });

  it('is monotonic: a lower probability never keeps more', () => {
    // Catches a sampler wired with the probability inverted, which every single-value
    // assertion above would still pass.
    const fractions = ['0', '0.1', '0.5', '0.9', '1'].map((p) =>
      sampledFraction(resolveSampler({ OTEL_SAMPLING_PROBABILITY: p }), IDS),
    );
    for (let i = 1; i < fractions.length; i++) {
      expect(fractions[i]).toBeGreaterThanOrEqual(fractions[i - 1]);
    }
  });

  it('drops everything at 0', () => {
    expect(sampledFraction(resolveSampler({ OTEL_SAMPLING_PROBABILITY: '0' }), IDS)).toBe(0);
  });

  /**
   * The reason for ParentBasedSampler rather than the ratio sampler alone. Without it a
   * request arriving from another service with a sampled parent would be re-judged against
   * our ratio and usually dropped, so distributed traces would come back with holes that
   * look like broken instrumentation rather than sampling.
   */
  describe('parent decisions win over the local ratio', () => {
    it('keeps a span whose parent was sampled, even at a low probability', () => {
      const sampler = resolveSampler({ OTEL_SAMPLING_PROBABILITY: '0.01' });
      expect(decideWithParent(sampler, ANY_TRACE_ID, true)).toBe(
        SamplingDecision.RECORD_AND_SAMPLED,
      );
    });

    it('drops a span whose parent was NOT sampled, even on a trace id it would keep', () => {
      const sampler = resolveSampler({ OTEL_SAMPLING_PROBABILITY: '0.01' });
      expect(decideWithParent(sampler, ANY_TRACE_ID, false)).toBe(SamplingDecision.NOT_RECORD);
    });
  });

  /**
   * A bad value must not stop telemetry silently. Every one of these falls back to full
   * fidelity rather than to zero — a typo in a deploy variable should cost money, not
   * visibility, because the second failure is the one nobody notices.
   */
  describe('malformed values fall back to keeping everything', () => {
    it.each([
      ['not-a-number', 'not-a-number'],
      ['empty string', ''],
      ['whitespace', '   '],
    ])('%s', (_label, value) => {
      expect(sampledFraction(resolveSampler({ OTEL_SAMPLING_PROBABILITY: value }), IDS)).toBe(1);
    });
  });

  /**
   * Out-of-range is CLAMPED, not thrown. This runs at import time, before the Nest config
   * module validates anything, so throwing would take the process down on boot — a worse
   * outcome than a clamped sampler for a variable that only controls telemetry volume.
   */
  describe('out-of-range values are clamped', () => {
    it('treats a probability above 1 as 1', () => {
      expect(sampledFraction(resolveSampler({ OTEL_SAMPLING_PROBABILITY: '5' }), IDS)).toBe(1);
    });

    it('treats a negative probability as 0', () => {
      expect(sampledFraction(resolveSampler({ OTEL_SAMPLING_PROBABILITY: '-1' }), IDS)).toBe(0);
    });
  });
});
