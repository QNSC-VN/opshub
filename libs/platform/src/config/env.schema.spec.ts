import { describe, it, expect } from 'vitest';
import { generateKeyPairSync, createPublicKey } from 'node:crypto';
import { EnvSchema } from './env.schema';

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();

/** Minimum that satisfies the rest of the schema, so each block tests one thing. */
function env(overrides: Record<string, string | undefined> = {}) {
  return {
    DATABASE_URL: 'postgres://u:p@localhost:5432/opshub',
    JWT_PRIVATE_KEY: privatePem,
    COOKIE_SECRET: 'y'.repeat(32),
    ...overrides,
  };
}

describe('EnvSchema — JWT key pair', () => {
  // The point of the derivation: a mismatched pair is the one failure a key pair cannot
  // otherwise have (signing succeeds, every verification rejects) and nothing upstream
  // can detect it, because both halves are individually valid.
  it('derives JWT_PUBLIC_KEY from JWT_PRIVATE_KEY when it is not supplied', () => {
    const result = EnvSchema.safeParse(env());
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.JWT_PUBLIC_KEY).toBe(publicPem);
  });

  it('derives a key that actually matches the private half', () => {
    const result = EnvSchema.safeParse(env());
    if (!result.success) throw new Error('expected parse to succeed');
    const fromPrivate = createPublicKey(result.data.JWT_PRIVATE_KEY)
      .export({ type: 'spki', format: 'pem' })
      .toString();
    expect(result.data.JWT_PUBLIC_KEY).toBe(fromPrivate);
  });

  it('honours an explicitly supplied JWT_PUBLIC_KEY', () => {
    const result = EnvSchema.safeParse(env({ JWT_PUBLIC_KEY: publicPem }));
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.JWT_PUBLIC_KEY).toBe(publicPem);
  });

  it('accepts a base64-encoded private key and still derives from it', () => {
    const result = EnvSchema.safeParse(
      env({ JWT_PRIVATE_KEY: Buffer.from(privatePem).toString('base64') }),
    );
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.JWT_PUBLIC_KEY).toBe(publicPem);
  });

  // A public key pasted into the private slot is well-formed PEM, so it passes the
  // field-level refine and would otherwise fail much later, at the first sign().
  it('fails naming JWT_PRIVATE_KEY when a public key is supplied as the private one', () => {
    const result = EnvSchema.safeParse(env({ JWT_PRIVATE_KEY: publicPem }));
    expect(result.success).toBe(false);
    if (result.success) return;
    const issue = result.error.issues.find((i) => i.path.includes('JWT_PRIVATE_KEY'));
    expect(issue?.message).toMatch(/not a PRIVATE key/);
  });

  // ES256 is P-256 specifically. Another curve signs fine and every verifier rejects
  // the result, which presents as a broken deploy with no obvious cause.
  it('rejects an EC key on the wrong curve', () => {
    const p384 = generateKeyPairSync('ec', { namedCurve: 'secp384r1' })
      .privateKey.export({ type: 'pkcs8', format: 'pem' })
      .toString();
    const result = EnvSchema.safeParse(env({ JWT_PRIVATE_KEY: p384 }));
    expect(result.success).toBe(false);
    if (result.success) return;
    const issue = result.error.issues.find((i) => i.path.includes('JWT_PRIVATE_KEY'));
    expect(issue?.message).toMatch(/must be an EC P-256 key for ES256/);
  });

  it('rejects an RSA key', () => {
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 })
      .privateKey.export({ type: 'pkcs8', format: 'pem' })
      .toString();
    expect(EnvSchema.safeParse(env({ JWT_PRIVATE_KEY: rsa })).success).toBe(false);
  });

  it('still rejects a JWT_PRIVATE_KEY that is not PEM at all', () => {
    expect(EnvSchema.safeParse(env({ JWT_PRIVATE_KEY: 'not-a-key' })).success).toBe(false);
  });
});

describe('EnvSchema — database credentials', () => {
  const parts = {
    DATABASE_HOST: 'db.internal',
    DATABASE_PORT: '5432',
    DATABASE_NAME: 'opshub',
    DATABASE_USER: 'app_admin',
    DATABASE_PASSWORD: 'pw',
  };

  it('accepts a complete DATABASE_URL', () => {
    expect(EnvSchema.safeParse(env()).success).toBe(true);
  });

  it('accepts the discrete parts with no DATABASE_URL — the deployed path', () => {
    const result = EnvSchema.safeParse({ ...env({ DATABASE_URL: undefined }), ...parts });
    expect(result.success).toBe(true);
    if (!result.success) return;
    // Coerced, so db/database-url.ts receives a number here and a string from raw env.
    expect(result.data.DATABASE_PORT).toBe(5432);
    expect(result.data.DATABASE_SSLMODE).toBe('require');
  });

  // Boot-time failure is the whole point: a stale or half-wired credential that passes
  // startup and dies on the first query presents as a healthy deploy, then 28P01.
  it('rejects neither form being complete, naming what is missing', () => {
    const result = EnvSchema.safeParse(env({ DATABASE_URL: undefined }));
    expect(result.success).toBe(false);
    if (result.success) return;
    const issue = result.error.issues.find((i) => i.path.includes('DATABASE_URL'));
    expect(issue?.message).toMatch(/DATABASE_HOST.*DATABASE_PASSWORD/s);
  });

  it.each([
    'DATABASE_HOST',
    'DATABASE_PORT',
    'DATABASE_NAME',
    'DATABASE_USER',
    'DATABASE_PASSWORD',
  ])('rejects the parts form with %s missing, and says so', (key) => {
    const result = EnvSchema.safeParse({
      ...env({ DATABASE_URL: undefined }),
      ...parts,
      [key]: undefined,
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const issue = result.error.issues.find((i) => i.path.includes('DATABASE_URL'));
    expect(issue?.message).toContain(key);
  });

  it('a complete URL wins, so a stray part cannot make the config invalid', () => {
    const result = EnvSchema.safeParse({ ...env(), DATABASE_HOST: 'db.internal' });
    expect(result.success).toBe(true);
  });
});

describe('EnvSchema — cache URL alias', () => {
  // Infra injects VALKEY_URL; every caller reads REDIS_URL. Kept here because the
  // normalisation now shares a transform with the JWT derivation, so a change to one
  // can silently drop the other.
  it('resolves VALKEY_URL into REDIS_URL', () => {
    const result = EnvSchema.safeParse(env({ VALKEY_URL: 'rediss://cache:6379' }));
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.REDIS_URL).toBe('rediss://cache:6379');
  });

  it('leaves an explicit REDIS_URL alone when no alias is set', () => {
    const result = EnvSchema.safeParse(env({ REDIS_URL: 'redis://localhost:6379' }));
    if (!result.success) throw new Error('expected parse to succeed');
    expect(result.data.REDIS_URL).toBe('redis://localhost:6379');
  });

  it('prefers the infra alias over an explicit REDIS_URL', () => {
    const result = EnvSchema.safeParse(
      env({ REDIS_URL: 'redis://localhost:6379', VALKEY_URL: 'rediss://cache:6379' }),
    );
    if (!result.success) throw new Error('expected parse to succeed');
    expect(result.data.REDIS_URL).toBe('rediss://cache:6379');
  });
});
