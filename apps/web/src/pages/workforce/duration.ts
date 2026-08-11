/**
 * Minutes as `8h 0m`.
 *
 * Its own module because `workforce-shared.tsx` exports COMPONENTS, and mixing a plain function in
 * breaks React Fast Refresh for that file — eslint's `react-refresh/only-export-components` said so,
 * and it is right: a helper is not a component and does not belong in a component file.
 */
export function asHoursAndMinutes(minutes: number): string {
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
