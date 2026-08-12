import { useState } from 'react';
import { ListChecks } from 'lucide-react';
import { Button, ListPage, SegmentedControl } from '@/shared/ui';
import { useListState } from '@/shared/hooks/use-list-state';
import { formatDate, todayIso } from '@/shared/lib/format';
import { CapaCard } from './capa-panel';
import { CAPA_STATUS_FILTERS } from './quality.types';
import { useCapas, useFindingLabels } from './use-quality';

/**
 * The CAPA queue: every corrective action, ordered by whether somebody has to move it.
 *
 * WHY A SECOND SCREEN, when CAPAs already appear in their finding's drawer. The two answer different
 * questions. The finding asks "can this close" — the closure gate, which is why the CAPAs sit there. This one
 * asks "what is late", which nobody can answer by opening findings one at a time. The API has the filters for
 * it (`openOnly`, `dueOnOrBefore`), so the alternative to this screen is a spreadsheet somebody maintains
 * beside the system.
 *
 * NO NEW VOCABULARY. The rows are `CapaCard`, the same card the finding's drawer renders, and the actions are
 * `CapaActions`, the same transition map — so a CAPA looks and behaves identically in both places, and there
 * is one implementation of which move is legal.
 */
export function CapasPage() {
  const list = useListState();
  const [status, setStatus] = useState('');
  const [openOnly, setOpenOnly] = useState(true);
  const [overdueOnly, setOverdueOnly] = useState(false);

  const capas = useCapas({
    status,
    openOnly,
    // The API compares against the due date, so "overdue" is today's date sent as the ceiling rather than a
    // second notion of lateness computed here.
    dueOnOrBefore: overdueOnly ? todayIso() : '',
    limit: list.limit,
    offset: list.offset,
  });

  function applyFilter(apply: () => void) {
    apply();
    list.resetPaging();
  }

  const rows = capas.data?.data ?? [];
  // One cached query per finding on this page, so a row names its finding instead of showing a UUID.
  const findings = useFindingLabels(rows.map((capa) => capa.nonconformanceId));

  return (
    <ListPage
      title="Corrective actions"
      description="Every CAPA, what it found, and whether the actions have been shown to work."
      filters={
        <>
          <SegmentedControl
            label="Filter by status"
            options={CAPA_STATUS_FILTERS.map((option) => ({ ...option }))}
            value={status}
            onChange={(value) => applyFilter(() => setStatus(value))}
          />
          {/* Open by default: a queue that opens on 400 verified CAPAs is a queue nobody uses. */}
          <Button
            variant={openOnly ? 'primary' : 'outline'}
            size="sm"
            aria-pressed={openOnly}
            onClick={() => applyFilter(() => setOpenOnly(!openOnly))}
          >
            Open only
          </Button>
          <Button
            variant={overdueOnly ? 'primary' : 'outline'}
            size="sm"
            aria-pressed={overdueOnly}
            onClick={() => applyFilter(() => setOverdueOnly(!overdueOnly))}
          >
            Due or overdue
          </Button>
        </>
      }
      pageInfo={capas.data?.pageInfo}
      onOffsetChange={list.goToOffset}
      noun="CAPA"
    >
      {capas.isLoading && <p className="text-xs text-fg-subtle">Loading…</p>}
      {capas.isError && <p className="text-sm text-danger">Failed to load the CAPA register.</p>}
      {!capas.isLoading && !capas.isError && rows.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-10 text-center">
          <ListChecks className="h-6 w-6 text-fg-subtle" strokeWidth={1.75} />
          <p className="text-sm text-fg-subtle">No CAPAs match these filters</p>
        </div>
      )}

      <div className="flex flex-col gap-2">
        {rows.map((capa) => {
          const finding = findings.get(capa.nonconformanceId);
          return (
            <CapaCard key={capa.id} capa={capa}>
              {/* The one fact the card cannot carry: this queue is read across findings, so each row has to
                  say which one it answers, and how late it is against its own due date. */}
              <p className="mt-0.5 text-xs text-fg-subtle">
                {finding ? (
                  <>
                    <span className="font-mono">{finding.reference}</span> · {finding.title}
                  </>
                ) : (
                  'Loading the finding…'
                )}
                {capa.implementedAt && ` · implemented ${formatDate(capa.implementedAt)}`}
                {capa.dueOn && capa.dueOn < todayIso() && capa.status !== 'verified' && (
                  <span className="text-warning"> · past due</span>
                )}
              </p>
            </CapaCard>
          );
        })}
      </div>
    </ListPage>
  );
}
