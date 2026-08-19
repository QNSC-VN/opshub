import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PackageSearch } from 'lucide-react';
import { api } from '@/shared/api/client';
import {
  DataTable,
  Input,
  PaginationFooter,
  RowAction,
  RowActions,
  SegmentedControl,
  StatusBadge,
  humanizeStatus,
  type DataTableColumn,
} from '@/shared/ui';
import type { BadgeTone } from '@/shared/ui';
import type { SoftwareListing } from '@/shared/api/types';
import { useListState } from '@/shared/hooks/use-list-state';
import { usePermissions } from '@/shared/hooks/use-permissions';
import { ReclassifySoftwareModal } from './compliance-modals';
import type { SoftwareResponse } from '@/shared/api/types';
import { orDash } from '@/shared/lib/format';

/**
 * The software catalogue: what is allowed on managed devices, what is banned, and what nobody has decided.
 *
 * ITS OWN FILE, like `shadow-it-tab.tsx` beside it. The page was 436 lines and this tab grew a filter, a
 * search box and a write path; `compliance-page.tsx` is composition, and the ratchet that split its resolve
 * dialog out says the same thing about a tab with its own state and mutation.
 *
 * THE LISTING WAS READ-ONLY, which left the shadow-IT flow half-built: a scan reports software running on a
 * device that is not whitelisted, and until now nothing on this screen could whitelist it or ban it. The
 * decision is the point of the catalogue.
 *
 * A DECISION CARRIES ITS REASON. `notes` is offered with the listing rather than as a separate edit, for
 * the same reason a risk acceptance demands a justification: "why is this banned" is the question asked six
 * months later, and a blacklist entry nobody can account for gets quietly reversed.
 */

/*
 * `listing` IS THIS SCREEN'S OWN VOCABULARY, so the tone map stays local — `compliance-page.tsx` says why:
 * these four words appear here alone, and a shared lookup nobody can attribute to a caller is worse than a
 * local one. It moved with the tab rather than being left behind for one caller.
 */
/**
 * EXHAUSTIVE OVER THE API'S ENUM, and the `Record` is what enforces it.
 *
 * This carried a fourth key, `unknown`, that `software_listing` has never had — the column is NOT NULL
 * over whitelisted/blacklisted/review. Typing the map as `Record<SoftwareListing, BadgeTone>` means a
 * value the API gains is a missing-key error here, and a value it does not have is an excess-property
 * error, instead of both being silently fine.
 */
const LISTING_TONE: Record<SoftwareListing, BadgeTone> = {
  whitelisted: 'green',
  blacklisted: 'red',
  review: 'amber',
};

/**
 * The API takes one `listing` value or none, so "All" is the empty string rather than a fourth code.
 *
 * `unknown` was offered here too, and the API's `z.enum` refused it — so the filter answered 422 and
 * the tab showed a load failure for a choice the tab itself provided.
 */
const LISTING_FILTERS: { value: SoftwareListing | ''; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'whitelisted', label: 'Whitelisted' },
  { value: 'blacklisted', label: 'Blacklisted' },
  { value: 'review', label: 'Review' },
];

export function SoftwareCatalogTab() {
  const qc = useQueryClient();
  const { can } = usePermissions();
  const canManage = can('compliance.manage');

  // Paged, where this tab previously asked for `limit: 100` and showed a total — which silently
  // truncated any catalogue with more entries than that.
  const list = useListState();
  // Typed, not `string`: the state feeds the query parameter, so an unlisted value is a compile
  // error here rather than a 422 at run time.
  const [listing, setListing] = useState<SoftwareListing | ''>('');
  const [reclassifying, setReclassifying] = useState<SoftwareResponse | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['compliance', 'software', listing, list.search, list.offset, list.limit],
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/compliance/software', {
        params: {
          query: {
            // BOTH FILTERS ARE THE API'S, and neither was being sent. A catalogue that pages cannot be
            // searched by scrolling, and reclassifying an entry means finding it first.
            listing: listing || undefined,
            search: list.search || undefined,
            limit: list.limit,
            offset: list.offset,
          },
        },
      });
      if (error || !data) throw new Error('Failed to load software catalog');
      return data;
    },
  });

  const columns: DataTableColumn<SoftwareResponse>[] = [
    {
      key: 'name',
      header: 'Name',
      cell: (r) => <span className="font-medium text-fg">{r.name}</span>,
    },
    { key: 'publisher', header: 'Publisher', cell: (r) => orDash(r.publisher) },
    {
      key: 'listing',
      header: 'Listing',
      cell: (r) => (
        <StatusBadge tone={LISTING_TONE[r.listing]}>{humanizeStatus(r.listing)}</StatusBadge>
      ),
    },
    {
      key: 'notes',
      header: 'Notes',
      cell: (r) => (
        <span className="text-xs text-fg-subtle" title={r.notes ?? ''}>
          {orDash(r.notes)}
        </span>
      ),
      className: 'max-w-xs truncate',
      hideOnMobile: true,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (r) =>
        canManage ? (
          <RowActions>
            <RowAction tone="accent" onClick={() => setReclassifying(r)}>
              Reclassify
            </RowAction>
          </RowActions>
        ) : null,
    },
  ];

  return (
    <div className="space-y-3">
      {reclassifying && (
        <ReclassifySoftwareModal
          entry={reclassifying}
          onClose={() => setReclassifying(null)}
          onSuccess={() => {
            void qc.invalidateQueries({ queryKey: ['compliance', 'software'] });
          }}
        />
      )}

      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl
          label="Filter by listing"
          options={LISTING_FILTERS.map((option) => ({ ...option }))}
          value={listing}
          onChange={(value) => {
            setListing(value);
            // Narrowing the set invalidates the offset — page 3 of the blacklist may not exist.
            list.resetPaging();
          }}
        />
        <div className="min-w-0 flex-1 sm:max-w-xs">
          <Input
            type="search"
            value={list.search}
            onChange={(e) => list.setSearch(e.target.value)}
            placeholder="Search software…"
            aria-label="Search software"
          />
        </div>
      </div>

      <DataTable
        columns={columns}
        rows={data?.data}
        isLoading={isLoading}
        isError={isError}
        errorMessage="Failed to load software catalog."
        emptyMessage="No software entries found"
        emptyIcon={PackageSearch}
      />
      <PaginationFooter
        pageInfo={data?.pageInfo}
        onOffsetChange={list.goToOffset}
        noun="software"
      />
    </div>
  );
}
