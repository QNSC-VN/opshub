# The OpsHub UI kit

Import from `@/shared/ui`. One path, so a primitive cannot be missed by somebody who did not know
which file it was in — which is exactly how ten screens ended up hand-rolling a dialog while
`Modal` sat here unused.

## The rules

**1. A list screen is `ListPage` + `DataTable` + `PaginationFooter` + `useListState`.**
Never a bare `<table>`. `DataTable` owns loading, error, empty and the `colSpan`; the page owns the
columns and the query. Every list endpoint pages server-side, so `useListState` holds the offset and
resets it when the search or a filter changes.

**2. A status is a TONE, never a class string.**
`<StatusBadge tone={statusTone(x)}>{humanizeStatus(x)}</StatusBadge>`. `statusTone` says what a word
means, `Badge` says what a tone looks like. Raw Tailwind pairs (`bg-orange-50 text-orange-700`) do
not flip in dark mode — one screen had that and was unreadable on a dark background.
A vocabulary used on **one** screen keeps its map in that screen; two or more screens means it
belongs in `status-tone.ts`.

**3. A dialog is `Modal`. A drawer is `SlideOver`. A confirmation is `ConfirmDialog`.**
`Modal` has `role="dialog"`, a focus trap, Escape, scroll lock and focus restore. A hand-rolled
`fixed inset-0` has none of those, and the ten that existed let keyboard users tab into the page
behind them.

**4. Form controls are `FormField` + `Input` / `Textarea` / `Select`.**
`FormField` wires the label, the hint and `aria-describedby`; the controls wire `aria-invalid`.
`Select` is a **native** `<select>` — the platform already gives keyboard support, type-ahead and
the right picker on a phone.

**5. One choice from a small set is `SegmentedControl`; a section switch is `Tabs` + `TabPanel`.**
Both are real ARIA widgets with arrow-key navigation and a roving tab index. A row of buttons is
not either of them.

**6. Label/value pairs are `DescriptionList`; a record drawer is `EntityDetailPanel`.**
`DescriptionList` renders `dl`/`dt`/`dd` and the em dash for absent values, so no page writes
`?? '—'` again. `EntityDetailPanel` fixes the drawer's section ORDER — what this is, what is
special about it, what happened to it — and omits the Activity section entirely for a record type
with no audit trail.

**7. Dates and numbers go through `@/shared/lib/format`.**
`formatDate` treats a `YYYY-MM-DD` as the calendar date it is — `new Date('2026-03-04')` is UTC
midnight and renders as the 3rd for anyone behind UTC. `formatDecimal` handles the strings the
`numeric` columns arrive as.

**8. KPI tiles are `StatCard` inside `StatGrid`.**

## Testing

Component specs live beside the component as `*.spec.tsx` with `// @vitest-environment jsdom` at the
top — **not** a config glob, because Vitest 4 removed `environmentMatchGlobs`. Assert on roles and
behaviour, not classes: a Tailwind change must not fail a test, and a missing `role` must not pass
one.

## Composition

A page file COMPOSES; it does not also contain the forms, tables and drawers. `fe-consistency.
ratchet.test.ts` enforces a line ceiling and it has already earned it: the workforce conversion
produced one 1272-line file and the ratchet refused it. That screen is now six modules —
`workforce-page.tsx` (61 lines) plus a module per tab — and the largest is 343.

Helpers live in their own module, not beside components: eslint's
`react-refresh/only-export-components` is right that mixing them breaks Fast Refresh for the file.

## Conversion status

Converted: `compliance`, `access`, `workforce`.
Still hand-rolled (tables, dialogs, filters): `assets`, `people`, `requests`, `catalog`, `finops`,
`profile`, `settings/rbac`, `settings/webhooks`, `settings/audit-logs`, `dashboard`,
`security-posture`, `reports`.

Ratchet baselines move with each conversion — raw `<button>` 149 → 105, hand-rolled modal files
11 → 8. Lower them by converting, never by editing the number.

Convert a screen when you touch it, and keep this list honest.
