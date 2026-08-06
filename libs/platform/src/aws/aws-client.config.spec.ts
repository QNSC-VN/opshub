import { describe, it, expect } from 'vitest';
import type { AppConfigService } from '../config/app-config.service';
import { buildAwsClientConfig } from './aws-client.config';

/**
 * The property worth pinning is the negative one: with no `AWS_ENDPOINT_URL`,
 * the returned config must carry NO credentials, so the SDK falls through to the
 * ECS task-role provider chain. A "simplification" that always passes the static
 * keys would send whatever `AWS_ACCESS_KEY_ID` happens to hold in a deployed
 * environment — or the literal `test` fallback — instead of the task role.
 */
function config(env: Record<string, string | undefined>): AppConfigService {
  return { get: (key: string) => env[key] } as unknown as AppConfigService;
}

describe('buildAwsClientConfig', () => {
  it('returns region only when no endpoint override is set', () => {
    const result = buildAwsClientConfig(
      // Credentials present but ignorable: real AWS must use the task role even
      // if static keys are lying around in the environment.
      config({
        AWS_REGION: 'ap-southeast-1',
        AWS_ACCESS_KEY_ID: 'AKIAREAL',
        AWS_SECRET_ACCESS_KEY: 'realsecret',
      }),
    );

    expect(result).toEqual({ region: 'ap-southeast-1' });
    expect(result.credentials).toBeUndefined();
    expect(result.endpoint).toBeUndefined();
  });

  it('passes endpoint and static credentials when targeting an emulator', () => {
    const result = buildAwsClientConfig(
      config({
        AWS_REGION: 'ap-southeast-1',
        AWS_ENDPOINT_URL: 'http://localhost:4567',
        AWS_ACCESS_KEY_ID: 'local',
        AWS_SECRET_ACCESS_KEY: 'localsecret',
      }),
    );

    expect(result).toEqual({
      region: 'ap-southeast-1',
      endpoint: 'http://localhost:4567',
      credentials: { accessKeyId: 'local', secretAccessKey: 'localsecret' },
    });
  });

  it('falls back to LocalStack conventional credentials when only the endpoint is set', () => {
    // The default credential chain has no task role to resolve against an
    // emulator, so the SDK throws at request time unless something is supplied.
    const result = buildAwsClientConfig(
      config({ AWS_REGION: 'ap-southeast-1', AWS_ENDPOINT_URL: 'http://localhost:4567' }),
    );

    expect(result.credentials).toEqual({ accessKeyId: 'test', secretAccessKey: 'test' });
  });
});
