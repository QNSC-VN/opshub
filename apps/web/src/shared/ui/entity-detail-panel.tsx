import type { ReactNode } from 'react';
import { ActivityTimeline } from './activity-timeline';
import { DescriptionList, type DescriptionItem } from './description-list';
import { SlideOver, SlideOverSection } from './slide-over';

export interface EntityDetailPanelProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  /** Approve/reject/cancel — the actions that belong to the record, top right. */
  headerActions?: ReactNode;
  /** The label/value pairs. `DescriptionList` renders the em dash for absent ones. */
  items: DescriptionItem[];
  /**
   * What the activity timeline asks about. Omit to leave the timeline out entirely — a record with
   * no audit trail should not show an empty "Activity" heading.
   */
  activity?: { resourceId: string; resourceType: string };
  /** Extra sections between the details and the activity — an upload widget, a linked list. */
  children?: ReactNode;
  width?: 'md' | 'lg';
}

/**
 * EntityDetailPanel — the record drawer: details, then anything specific, then the audit trail.
 *
 * WHY THIS EXISTS
 * ---------------
 * Six copies of the same three-part drawer: `SlideOver` → `SlideOverSection title="Details"` with a
 * label/value grid → a hairline → `SlideOverSection title="Activity"` with `ActivityTimeline`. Four of
 * them are in the workforce page alone, one per tab, and they had drifted in the way copies do — two
 * were `width="md"` and two `width="lg"`, the hairline was `mx-5 h-px bg-surface-muted` in five of them
 * and missing in the sixth, and one rendered the Activity heading for a record type with no audit
 * entries.
 *
 * The ORDER is the point, not just the markup: what this is, then what is special about it, then what
 * happened to it. Fixing that order here is what stops the seventh drawer inventing its own.
 *
 * The free-text fields (a note, a reason, a justification) belong in `items` with `wide: true` rather
 * than in a bespoke box below the grid — that is how five of the six were doing it, and it left the
 * same field styled two different ways depending on which drawer you opened.
 */
export function EntityDetailPanel({
  open,
  onClose,
  title,
  description,
  headerActions,
  items,
  activity,
  children,
  width = 'md',
}: EntityDetailPanelProps) {
  return (
    <SlideOver
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      width={width}
      headerActions={headerActions}
    >
      <SlideOverSection title="Details">
        <DescriptionList items={items} />
      </SlideOverSection>

      {children && (
        <>
          <Hairline />
          {children}
        </>
      )}

      {activity && (
        <>
          <Hairline />
          <SlideOverSection title="Activity">
            <ActivityTimeline
              resourceId={activity.resourceId}
              resourceType={activity.resourceType}
            />
          </SlideOverSection>
        </>
      )}
    </SlideOver>
  );
}

/** The section divider, in one place rather than in each drawer's copy of it. */
function Hairline() {
  return <div className="mx-5 h-px bg-surface-muted" />;
}
