/**
 * Which outbound targets the product refuses, and why each one matters.
 *
 * `webhook_subscriptions.url` was `z.string().url()` and nothing else, and the relay that calls it runs
 * in a task whose security group allows egress to `0.0.0.0/0` on every protocol. A caller holding
 * `webhook.manage` could register a subscription pointing into the VPC and every queued event became a
 * POST to it — and the failure text comes back through the deliveries endpoint, so an HTTP status leaks
 * to whoever owns the subscription. That is enough to map which internal hosts answer.
 *
 * The cases below are the addresses an attacker actually reaches for, not a sample of the RFC. Each name
 * says what is behind it, because "blocked range" alone does not tell the next reader whether the entry
 * can be relaxed.
 */
import { describe, expect, it } from 'vitest';
import {
  describeUnsafeResolvedTarget,
  describeUnsafeTarget,
  isSafeOutboundUrl,
} from './outbound-url';

describe('describeUnsafeTarget', () => {
  it('allows an ordinary public https endpoint', () => {
    expect(describeUnsafeTarget('https://hooks.example.com/opshub')).toBeNull();
    expect(isSafeOutboundUrl('https://hooks.example.com/opshub?x=1')).toBe(true);
  });

  it.each([
    ['http://hooks.example.com/x', 'plaintext — the payload would be on the wire in clear'],
    ['file:///etc/passwd', 'a non-network scheme'],
    ['gopher://example.com/x', 'a scheme no webhook receiver speaks'],
  ])('refuses %s (%s)', (url) => {
    expect(describeUnsafeTarget(url)).toMatch(/protocol .* is not allowed/);
  });

  it.each([
    ['https://169.254.169.254/latest/meta-data/', 'the cloud instance metadata endpoint'],
    [
      'https://169.254.170.2/v2/credentials',
      'the ECS task credential endpoint — IAM keys live here',
    ],
    ['https://127.0.0.1:3001/v1/employees', 'the API talking to itself, unauthenticated'],
    ['https://10.0.4.17:5432/', 'RDS'],
    ['https://172.20.1.9:6379/', 'the cache'],
    ['https://192.168.1.1/', 'a home or office router'],
    ['https://100.64.0.1/', 'carrier-grade NAT, which VPC add-ons hand out'],
  ])('refuses %s (%s)', (url) => {
    expect(describeUnsafeTarget(url)).not.toBeNull();
  });

  it.each([
    ['https://localhost/x'],
    ['https://LOCALHOST/x'],
    ['https://db.internal/x'],
    ['https://cache.local/x'],
    ['https://metadata.google.internal/x'],
  ])('refuses the local hostname %s', (url) => {
    // Not every inward target looks like an address. Case-insensitively, because the host is
    // case-insensitive and `LOCALHOST` would otherwise walk through a lowercase-only set.
    expect(describeUnsafeTarget(url)).not.toBeNull();
  });

  it.each([
    ['https://[::1]/x', 'IPv6 loopback'],
    ['https://[fd00::1]/x', 'IPv6 unique-local'],
    ['https://[fe80::1]/x', 'IPv6 link-local'],
    [
      'https://[::ffff:10.0.0.1]/x',
      'an IPv4-mapped address, which is how a v4 target evades a v4 check',
    ],
  ])('refuses %s (%s)', (url) => {
    expect(describeUnsafeTarget(url)).not.toBeNull();
  });

  it('allows a public IPv6 address', () => {
    // The v6 rules are prefix-based, so this is the case that catches a prefix written too broadly.
    expect(describeUnsafeTarget('https://[2606:4700::1111]/x')).toBeNull();
  });

  it('refuses something that is not a URL at all', () => {
    expect(describeUnsafeTarget('not a url')).toBe('not a valid URL');
  });

  it('says WHY, because the message reaches whoever typed the address', () => {
    // "Invalid URL" on a perfectly well-formed address is the kind of refusal that gets reported as a
    // bug. The range's label is in the text.
    expect(describeUnsafeTarget('https://169.254.169.254/x')).toContain('link-local');
  });
});

describe('describeUnsafeResolvedTarget', () => {
  /** A stub resolver, so these cases do not depend on anybody else's DNS zone. */
  const resolvesTo =
    (...addresses: string[]) =>
    () =>
      Promise.resolve(addresses.map((address) => ({ address })));

  it('rejects a name that resolves inward, which the string check cannot see', async () => {
    /*
     * THE POINT OF HAVING TWO CHECKS. A perfectly ordinary hostname, syntactically flawless, whose A
     * record points at the VPC. That is the bypass: pass validation when the subscription is saved, then
     * re-point the name. Nothing about the stored URL changes.
     */
    const problem = await describeUnsafeResolvedTarget(
      'https://hooks.example.com/x',
      resolvesTo('10.0.4.17'),
    );
    expect(problem, 'a name resolving into the VPC was accepted').not.toBeNull();
    expect(problem).toContain('resolves to 10.0.4.17');
  });

  it('checks EVERY address, not just the first', async () => {
    // A name with one public record and one private one would otherwise pass while Node connected to
    // whichever it preferred — and which it prefers is not ours to decide.
    const problem = await describeUnsafeResolvedTarget(
      'https://hooks.example.com/x',
      resolvesTo('93.184.216.34', '169.254.169.254'),
    );
    expect(problem).toContain('169.254.169.254');
  });

  it('allows a name that resolves publicly', async () => {
    expect(
      await describeUnsafeResolvedTarget(
        'https://hooks.example.com/x',
        resolvesTo('93.184.216.34'),
      ),
    ).toBeNull();
  });

  it('still applies the string rules first', async () => {
    // No lookup needed, and none wanted: an `http://` target is refused before any DNS traffic.
    expect(await describeUnsafeResolvedTarget('http://example.com/x')).toMatch(/protocol/);
  });

  it('does not re-resolve a literal address', async () => {
    // Already judged by the string check; a lookup would ask the same question and could hang.
    expect(await describeUnsafeResolvedTarget('https://93.184.216.34/x')).toBeNull();
  });

  it('treats an unresolvable host as deliverable, not as unsafe', async () => {
    /*
     * A DNS failure is the delivery's own problem: it produces the ordinary retry and a real error
     * message. Calling it a security refusal would relabel every transient DNS blip and bury the cause.
     */
    const problem = await describeUnsafeResolvedTarget('https://gone.example.com/x', () =>
      Promise.reject(new Error('ENOTFOUND')),
    );
    expect(problem).toBeNull();
  });
});
