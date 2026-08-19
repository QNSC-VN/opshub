/**
 * The Resend provider's two safety properties, neither of which was working.
 *
 * IDEMPOTENCY. The provider set `headers: { 'X-Idempotency-Key': … }`, a header of our own invention
 * that Resend does not read — so its native de-duplication never engaged. That matters because it is
 * the one window an outbox cannot close by itself: the provider call succeeds, the transaction then
 * fails to commit, the row stays `pending`, and the retry sends a second real email. Every other
 * duplicate path is covered by the unique index and `FOR UPDATE SKIP LOCKED`; this one is covered only
 * by the provider honouring a key.
 *
 * THE SENDER. It defaulted to `OpsHub <no-reply@opshub.app>` when none was supplied — a domain a given
 * deployment may not own. Mail from an unverified address fails SPF and DKIM at the recipient, which
 * presents as silent non-delivery rather than as a configuration error.
 *
 * The SDK is stubbed rather than mocked at the module level: what matters is the exact shape handed to
 * `emails.send`, and a stub lets the assertions be about that shape.
 */
import { describe, expect, it, vi } from 'vitest';
import { ResendEmailProvider } from './resend.provider';
import type { EmailPayload } from '../email.provider';

/** A provider whose SDK client is a spy, and the recorded calls. */
function makeProvider(sendResult: { error: { message: string } | null } = { error: null }) {
  const send = vi.fn().mockResolvedValue(sendResult);
  const provider = new ResendEmailProvider('re_test_key');
  // The client is created in the constructor; replacing its `emails` is the narrowest seam that keeps
  // the provider's own mapping code under test.
  (provider as unknown as { client: { emails: { send: typeof send } } }).client = {
    emails: { send },
  };
  return { provider, send };
}

const PAYLOAD: EmailPayload = {
  to: 'priya@example.test',
  from: 'OpsHub <ops@verified.test>',
  subject: 'Leave approved',
  html: '<p>Approved.</p>',
  text: 'Approved.',
};

describe('ResendEmailProvider', () => {
  it('passes the idempotency key as the SDK option, not as a header of our own', async () => {
    const { provider, send } = makeProvider();

    await provider.send({ ...PAYLOAD, idempotencyKey: 'notification-email:abc' });

    expect(send).toHaveBeenCalledTimes(1);
    const [body, options] = send.mock.calls[0] as [
      Record<string, unknown>,
      { idempotencyKey?: string },
    ];

    // The SDK turns this into the `Idempotency-Key` header Resend honours.
    expect(options?.idempotencyKey).toBe('notification-email:abc');
    // And the invented header is gone: it did nothing, and leaving it would suggest it did.
    expect(body.headers).toBeUndefined();
  });

  it('omits the options argument entirely when there is no key', async () => {
    const { provider, send } = makeProvider();

    await provider.send(PAYLOAD);

    const [, options] = send.mock.calls[0] as [unknown, unknown];
    // `undefined` rather than `{ idempotencyKey: undefined }`: a caller with no key should produce a
    // plain request, not one carrying an empty idempotency contract.
    expect(options).toBeUndefined();
  });

  it('refuses to send with no sender rather than inventing one', async () => {
    const { provider, send } = makeProvider();

    /*
     * The third line of defence. The env schema refuses to boot a non-dev provider without a sender and
     * `EmailService` supplies it from configuration — but the fallback that used to live here would
     * have quietly overridden both, so its absence is worth asserting directly.
     */
    await expect(provider.send({ ...PAYLOAD, from: undefined })).rejects.toThrow(/MAIL_FROM_EMAIL/);
    expect(send, 'a request was made without a verified sender').not.toHaveBeenCalled();
  });

  it('sends the rendered parts and tags the category', async () => {
    const { provider, send } = makeProvider();

    await provider.send({ ...PAYLOAD, category: 'notification' });

    const [body] = send.mock.calls[0] as [Record<string, unknown>];
    expect(body).toMatchObject({
      from: 'OpsHub <ops@verified.test>',
      to: ['priya@example.test'],
      subject: 'Leave approved',
      html: '<p>Approved.</p>',
      // Both parts, always: a client rendering text-only shows an empty message without it.
      text: 'Approved.',
    });
    expect(body.tags).toEqual([{ name: 'category', value: 'notification' }]);
  });

  it('throws on a provider-side failure, so the relay can retry it', async () => {
    const { provider } = makeProvider({ error: { message: 'domain not verified' } });

    // The relay's retry and dead-lettering both depend on this throwing. Swallowing it would mark the
    // outbox row `sent` for an email that never left.
    await expect(provider.send(PAYLOAD)).rejects.toThrow(/domain not verified/);
  });
});
