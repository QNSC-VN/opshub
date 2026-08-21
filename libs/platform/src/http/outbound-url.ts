import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * Whether a URL is a safe target for the product to call OUTWARD.
 *
 * WHY THIS EXISTS. `webhook_subscriptions.url` was `z.string().url()` and nothing more, and the relay
 * runs in the worker task whose security group allows egress to `0.0.0.0/0` on every protocol. So a
 * caller holding `webhook.manage` could register a subscription pointing at the VPC — RDS on 5432, the
 * cache on 6379, the internal ALB, the ECS task-metadata endpoint on 169.254.170.2 — and every queued
 * event became a POST to it.
 *
 * The response body never comes back, so this is blind SSRF. Not entirely blind, though: the relay
 * stores the failure in `webhook_deliveries.last_error` and the deliveries endpoint returns it, so an
 * HTTP status and status text leak to whoever owns the subscription. That is enough to map which
 * internal hosts and ports answer.
 *
 * IT NEEDS A PRIVILEGED PERMISSION, which is why this is hardening rather than an open door. It is worth
 * closing anyway: `webhook.manage` is granted so an operator can wire an integration, not so they can
 * reach the database, and a stolen admin session should not be able to either.
 *
 * WHAT THIS CANNOT DO, stated because a partial defence presented as a complete one is worse than none:
 * a hostname that passes here can resolve to a private address later, or resolve to different addresses
 * on two lookups. Checking the name is not checking the connection. `describeUnsafeResolvedTarget` narrows the
 * window by resolving at delivery time, and closing it entirely means pinning the resolved address into
 * the socket — which is a change to how the relay makes requests, not to how it validates strings.
 */

/** `https` only. A webhook carries product data, and `http` puts it on the wire in clear. */
const ALLOWED_PROTOCOLS = new Set(['https:']);

/**
 * Address ranges that are never a customer's webhook endpoint.
 *
 * Link-local (169.254) covers the cloud metadata endpoints — AWS at 169.254.169.254 and the ECS task
 * credential endpoint at 169.254.170.2, which is where a task's IAM credentials live. The RFC 1918
 * ranges and loopback cover everything inside the VPC. Carrier-grade NAT (100.64/10) is in here because
 * that is the range EKS and some VPC add-ons hand out.
 */
const BLOCKED_V4 = [
  { label: 'loopback', test: (p: number[]) => p[0] === 127 },
  { label: 'any/unspecified', test: (p: number[]) => p[0] === 0 },
  { label: 'private 10/8', test: (p: number[]) => p[0] === 10 },
  { label: 'private 172.16/12', test: (p: number[]) => p[0] === 172 && p[1] >= 16 && p[1] <= 31 },
  { label: 'private 192.168/16', test: (p: number[]) => p[0] === 192 && p[1] === 168 },
  { label: 'link-local / cloud metadata', test: (p: number[]) => p[0] === 169 && p[1] === 254 },
  { label: 'carrier-grade NAT', test: (p: number[]) => p[0] === 100 && p[1] >= 64 && p[1] <= 127 },
  {
    label: 'benchmarking 198.18/15',
    test: (p: number[]) => p[0] === 198 && (p[1] === 18 || p[1] === 19),
  },
];

/** Hostnames that resolve inward without looking like an address. */
const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata.google.internal',
]);

/** `.internal`, `.local` and friends never point outside a private network. */
const BLOCKED_SUFFIXES = ['.internal', '.local', '.localdomain', '.localhost'];

/** Why a target was refused, or null when it is acceptable. */
export function describeUnsafeTarget(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return 'not a valid URL';
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    return `protocol ${url.protocol} is not allowed (https only)`;
  }

  // `URL` keeps IPv6 hosts in brackets; the address itself is what needs checking.
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();

  if (BLOCKED_HOSTNAMES.has(host)) return `${host} is a local hostname`;
  if (BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    return `${host} is inside a private DNS zone`;
  }

  const version = isIP(host);
  if (version === 4) {
    const parts = host.split('.').map(Number);
    const blocked = BLOCKED_V4.find((range) => range.test(parts));
    if (blocked) return `${host} is in a blocked range (${blocked.label})`;
  }
  if (version === 6) {
    /*
     * IPv6 by prefix rather than by parsing. `::1` is loopback, `fc00::/7` is unique-local (so `fc` and
     * `fd`), and `fe80::/10` is link-local. `::ffff:10.0.0.1` is an IPv4-mapped address and is how a
     * v4 target gets past a v4-only check, so the mapped form is refused outright — a real endpoint has
     * no reason to be written that way.
     */
    if (host === '::1' || host === '::') return `${host} is a loopback or unspecified address`;
    if (/^f[cd]/.test(host)) return `${host} is a unique-local address`;
    if (/^fe[89ab]/.test(host)) return `${host} is a link-local address`;
    if (host.startsWith('::ffff:')) return `${host} is an IPv4-mapped address`;
  }

  return null;
}

/** Whether the product may send an outbound request to this URL. */
export function isSafeOutboundUrl(raw: string): boolean {
  return describeUnsafeTarget(raw) === null;
}

/**
 * Refuse a target whose NAME is acceptable but whose ADDRESS is not.
 *
 * The string check above runs when a subscription is saved. This runs when a request is about to be
 * made, because those are different moments and DNS can differ between them: a hostname that resolved
 * publicly at creation can be re-pointed at `10.0.0.5` afterwards, and nothing about the stored URL
 * changes. Validating only at write time protects against a typo, not against an author.
 *
 * EVERY RESOLVED ADDRESS IS CHECKED, not the first. A name with an A record for a public address and a
 * second for a private one would otherwise pass while Node connected to whichever it preferred.
 *
 * A DNS FAILURE IS NOT A REFUSAL. An unresolvable host is the delivery's own problem and produces the
 * ordinary retry-and-dead-letter path with a real error message; treating it as unsafe would relabel
 * every transient DNS blip as a security refusal and hide the actual cause.
 *
 * THE REMAINING WINDOW, said plainly: between this lookup and the socket connecting, the name can be
 * re-resolved by the HTTP client and land somewhere else. Closing that means pinning the address into
 * the connection, which is a change to how requests are made rather than to how they are checked. This
 * turns "anyone with `webhook.manage` can point at the database" into "someone must win a race against
 * their own DNS", and that is worth having while the harder fix waits.
 */
export async function describeUnsafeResolvedTarget(
  raw: string,
  /**
   * The resolver, injectable so a test can be deterministic.
   *
   * The alternative was a spec that resolves a real third-party name known to point at loopback. That
   * proves the same thing and makes the suite depend on somebody else's DNS zone still existing, which is
   * a test that passes until it does not for a reason unrelated to this code.
   */
  resolve: (host: string) => Promise<{ address: string }[]> = (host) => lookup(host, { all: true }),
): Promise<string | null> {
  const staticProblem = describeUnsafeTarget(raw);
  if (staticProblem) return staticProblem;

  const host = new URL(raw).hostname.replace(/^\[|\]$/g, '');
  // A literal address was already judged above; resolving it would only re-ask the same question.
  if (isIP(host)) return null;

  let addresses: { address: string }[];
  try {
    addresses = await resolve(host);
  } catch {
    return null;
  }

  for (const { address } of addresses) {
    const problem = describeUnsafeTarget(
      `https://${address.includes(':') ? `[${address}]` : address}`,
    );
    if (problem)
      return `${host} resolves to ${address}, which ${problem.replace(`${address} `, '')}`;
  }
  return null;
}
