/**
 * PaginationFooter — "26–50 of 312", previous, next.
 *
 * Reads the API's own `pageInfo` (`{ total, limit, offset, hasNextPage }`) rather than counting
 * rows, because the row array is one page and cannot know what follows it. `hasNextPage` comes
 * from the server for the same reason: deriving it as `offset + limit < total` is right until a
 * row is inserted between two requests.
 *
 * Renders NOTHING when everything fits on one page — a pager under a five-row table is furniture.
 */
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from './button';

export interface PageInfo {
  total: number;
  limit: number;
  offset: number;
  hasNextPage: boolean;
}

export interface PaginationFooterProps {
  pageInfo: PageInfo | undefined;
  onOffsetChange: (offset: number) => void;
  /** What is being counted: "employees", "findings". Pluralised by the caller's word. */
  noun?: string;
}

export function PaginationFooter({ pageInfo, onOffsetChange, noun }: PaginationFooterProps) {
  if (!pageInfo) return null;
  const { total, limit, offset, hasNextPage } = pageInfo;
  if (total === 0) return null;

  const onlyPage = offset === 0 && !hasNextPage;
  const first = offset + 1;
  // The last row on THIS page: `offset + limit` overshoots on the final page.
  const last = Math.min(offset + limit, total);
  const label = noun ? `${noun} ` : '';

  return (
    <div className="flex items-center justify-between gap-4 px-1 pt-3 text-xs text-fg-muted">
      <span>
        {onlyPage ? (
          <>
            {total} {label}
            {total === 1 ? 'result' : 'results'}
          </>
        ) : (
          <>
            {first}–{last} of {total} {label}
          </>
        )}
      </span>

      {!onlyPage && (
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            // `Math.max` rather than trusting the arithmetic: a negative offset is a 422 from the
            // API, so the button that would produce one is simply disabled and clamped.
            onClick={() => onOffsetChange(Math.max(0, offset - limit))}
            disabled={offset === 0}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOffsetChange(offset + limit)}
            disabled={!hasNextPage}
          >
            Next
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
}
