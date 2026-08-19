/**
 * How stale each kind of data may be, and how often anything polls.
 *
 * WHY THESE ARE NAMED
 * -------------------
 * Twenty-six queries set `staleTime` inline, in six values, and every one of them expressed the same
 * decision — how out of date may this be before it is misleading? — as a bare number. Nothing said
 * why 5 minutes rather than 30, so the next query got whichever number the file above it happened to
 * use. Two files had already reached for a constant and named it differently (`STALE`,
 * `URL_STALE_TIME`), both 60_000, in the same product.
 *
 * THE TIERS ARE NAMED FOR THE DATA, NOT THE DURATION. `STALE.REFERENCE` is the answer to "this is a
 * catalogue keyed by an enum"; that it happens to be half an hour is a consequence. A tier named
 * `THIRTY_MINUTES` would have to be re-argued at every call site, which is what the raw numbers were
 * already doing.
 *
 * WHAT NO TIER MEANS. The query client sets `staleTime: STALE.NONE` explicitly, so the twenty-eight
 * queries that specify nothing refetch on mount — the TanStack default, now written down. It reads as
 * an omission otherwise, and "refetch every time this mounts" is a real choice for a list somebody is
 * about to act on.
 */

/**
 * How long a cached answer stays fresh.
 *
 * Order is deliberate: shortest first, so adding a tier means placing it against the others rather
 * than appending to a list.
 */
export const STALE = {
  /**
   * Refetch on mount. The TanStack default, stated.
   *
   * Right for a list a person is about to act on — an approval queue, a register they are editing —
   * where showing a row that has already been decided is worse than a request.
   */
  NONE: 0,

  /**
   * 10s — a surface that answers keystrokes.
   *
   * The command palette searches as you type. Long enough that arrowing back through results does not
   * refetch, short enough that a person who creates something and immediately searches for it finds it.
   */
  LIVE: 10_000,

  /**
   * 30s — something a person is actively watching for.
   *
   * Unread notifications, the audit tail during an investigation. The user is waiting for this to
   * change; a minute of silence reads as nothing happening.
   */
  WATCHED: 30_000,

  /**
   * 1 min — counts, feeds, and presigned URLs.
   *
   * Dashboard tiles and activity timelines: worth being current, not worth a request per mount for a
   * number nobody watches change by the second. Also the ceiling for a presigned attachment URL —
   * deliberately well short of any expiry the API issues, because a cached URL that has expired
   * renders a broken image, which is worse than fetching again.
   */
  ACTIVITY: 60_000,

  /**
   * 5 min — server-side aggregations, and the caller's own identity.
   *
   * Reports are recomputed from the same rows every time; asking twice in five minutes gives the same
   * answer at the cost of the same scan. `auth/me` sits here too: the claims come from a token whose
   * lifetime is longer than this, so a shorter tier would be asking about something that cannot have
   * changed.
   */
  REPORT: 5 * 60_000,

  /**
   * 10 min — a settled record that only a mutation changes.
   *
   * A closed performance cycle, a finding detail opened from a list. Safe because a mutation
   * invalidates its own keys, so the tier governs how long a record survives WITHOUT anybody changing
   * it — not how long a change takes to appear.
   */
  RECORD: 10 * 60_000,

  /**
   * 30 min — reference catalogues keyed by an enum.
   *
   * Severity grades, criticality levels, classification levels, the rating scale, leave policies.
   * These are tables the enum is the key of: they change in a migration, not in a session, and every
   * form on the screen reads them.
   */
  REFERENCE: 30 * 60_000,
} as const;

/**
 * How often a query refetches with nobody touching it.
 *
 * A DIFFERENT DECISION FROM `STALE`, which is why it is a different constant. `staleTime` costs a
 * request when something mounts; `refetchInterval` costs one on a timer for as long as the tab is
 * open, whether or not anybody is looking. Five queries poll, and each is a surface where the change
 * arrives from somewhere else — another person approving, a worker finishing — so waiting for a mount
 * would mean never seeing it.
 */
export const POLL = {
  /** 30s — the audit tail while somebody is reading it. */
  WATCHED: 30_000,
  /** 1 min — queues and clocks: an approval landing, or a shift ticking over. */
  ACTIVITY: 60_000,
} as const;
