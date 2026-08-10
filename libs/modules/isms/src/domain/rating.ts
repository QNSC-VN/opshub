/**
 * The ISMS rating scale.
 *
 * ONE PLACE FOR THE BOUNDS. The register scores risks on likelihood × impact and the information
 * asset register rates confidentiality, integrity and availability — all on the same 1..5 scale, so
 * a risk about an asset and the asset itself are read against one yardstick rather than two.
 *
 * These bounds appeared in four independent places before this file: `RATING_MIN`/`RATING_MAX` in
 * `information-asset.service.ts`, `const rating` in `information-asset.dto.ts`, `const factor` in
 * `risk.dto.ts`, and the `BETWEEN 1 AND 5` CHECKs in migrations 0019 and 0022. The migrations cannot
 * import TypeScript, so those stay — but they are now the ONLY other copy, and both name this file.
 *
 * Changing the scale means changing this file, both migrations, and
 * `ACCEPTANCE_APPROVAL_THRESHOLD` — which is expressed in scale units and silently changes meaning
 * if the scale moves under it.
 */
export const RATING_MIN = 1;
export const RATING_MAX = 5;

/** Whether a value is a legal point on the scale. The CHECKs in words. */
export function isRating(value: number): boolean {
  return Number.isInteger(value) && value >= RATING_MIN && value <= RATING_MAX;
}
