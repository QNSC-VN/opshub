/**
 * The shared Graph client, and the reason it is shared.
 *
 * Five services each built their own, per call. `ClientSecretCredential` caches its access token IN THE
 * INSTANCE, so a new instance per operation meant a new client-credentials round trip to Entra for
 * every Graph call — for a token valid for an hour that was already in hand. Entra throttles that
 * endpoint, so the symptom of hitting the limit is a FAILED offboarding, not a slow one.
 *
 * So the assertion that matters is not "it returns a client". It is that a second call returns the
 * SAME one, and that an unconfigured tenant refuses in words rather than asserting `!` on an empty
 * string and letting the Azure SDK explain.
 */
import { describe, expect, it, vi } from 'vitest';
import { GraphClientService } from './graph-client.service';

type Env = Partial<Record<'ENTRA_TENANT_ID' | 'ENTRA_CLIENT_ID' | 'GRAPH_CLIENT_SECRET', string>>;

function makeService(env: Env) {
  const config = { get: vi.fn((key: keyof Env) => env[key]) };
  return { service: new GraphClientService(config as never), config };
}

const CONFIGURED: Env = {
  ENTRA_TENANT_ID: 'tenant-1',
  ENTRA_CLIENT_ID: 'client-1',
  GRAPH_CLIENT_SECRET: 'secret-1',
};

describe('GraphClientService', () => {
  it('builds the client once and hands back the same one', () => {
    const { service } = makeService(CONFIGURED);

    const first = service.client();
    const second = service.client();

    /*
     * THE DEFECT, as a test. Identity, not equality: two structurally identical clients wrapping two
     * credentials would each hold their own empty token cache, which is exactly what the five copies
     * of `buildClient()` produced on every call.
     */
    expect(second).toBe(first);
  });

  it('refuses in words when Graph is not configured', () => {
    const { service } = makeService({});

    // The old form was `this.config.get('ENTRA_TENANT_ID')!` three times, so an unconfigured tenant
    // surfaced as whatever the Azure SDK says about an empty string — a message about the wrong layer.
    expect(() => service.client()).toThrow(/ENTRA_TENANT_ID/);
    expect(() => service.client()).toThrow(/isEnabled\(\)/);
  });

  it('refuses on a PARTIAL configuration, not only an empty one', () => {
    // The likeliest real state: the tenant and client id come from the same place, and the secret is
    // the one that is missing in a fresh environment.
    const { service } = makeService({ ENTRA_TENANT_ID: 'tenant-1', ENTRA_CLIENT_ID: 'client-1' });

    expect(service.isEnabled()).toBe(false);
    expect(() => service.client()).toThrow(/GRAPH_CLIENT_SECRET/);
  });

  it.each([
    ['nothing set', {}, false],
    ['secret missing', { ENTRA_TENANT_ID: 't', ENTRA_CLIENT_ID: 'c' }, false],
    ['tenant missing', { ENTRA_CLIENT_ID: 'c', GRAPH_CLIENT_SECRET: 's' }, false],
    ['client id missing', { ENTRA_TENANT_ID: 't', GRAPH_CLIENT_SECRET: 's' }, false],
    [
      'blank secret',
      { ENTRA_TENANT_ID: 't', ENTRA_CLIENT_ID: 'c', GRAPH_CLIENT_SECRET: '' },
      false,
    ],
    ['all three set', CONFIGURED, true],
  ])('isEnabled: %s', (_name, env, expected) => {
    // Every Graph path is a no-op when this is false, so a wrong answer here either breaks an
    // integration that is configured or attempts one that is not.
    expect(makeService(env).service.isEnabled()).toBe(expected);
  });

  it('asks config for each value rather than caching the answer to isEnabled', () => {
    // The CLIENT is cached; the boolean is not. Caching the boolean would make the first caller decide
    // for the process, and the config service is the thing that owns when a value can change.
    const { service, config } = makeService(CONFIGURED);

    service.isEnabled();
    service.isEnabled();

    expect(config.get.mock.calls.length).toBeGreaterThan(3);
  });
});
