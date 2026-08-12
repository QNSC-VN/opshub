import { useState } from 'react';
import { PageHeader, TabPanel, Tabs } from '@/shared/ui';
import { usePermissions } from '@/shared/hooks/use-permissions';
import { CyclesTab } from './cycles-tab';
import { MyReviewsTab } from './my-reviews-tab';
import { ReviewsTab } from './reviews-tab';

/**
 * Performance reviews — the fourth module whose API had no screen.
 *
 * THREE TABS, ONE OF WHICH EVERYBODY SEES. "My reviews" is self-scoped: `/me` and `/me/to-review` are
 * keyed on the caller's own id, so an employee with no permission codes reaches their own review and a
 * manager reaches the ones assigned to them. Cycles and the full review list need `performance.read`, so
 * they are not rendered for somebody who would only get a 403.
 *
 * The tab that OPENS is the one that matters to the caller: their own queue unless they administer the
 * cycles, in which case the cycle list is the way in.
 */

type PerformanceTab = 'mine' | 'cycles' | 'reviews';

export function PerformancePage() {
  const { can } = usePermissions();
  const canRead = can('performance.read');

  const tabs: { value: PerformanceTab; label: string }[] = [
    { value: 'mine', label: 'My reviews' },
    ...(canRead
      ? ([
          { value: 'cycles', label: 'Cycles' },
          { value: 'reviews', label: 'All reviews' },
        ] as const)
      : []),
  ];

  const [tab, setTab] = useState<PerformanceTab>(canRead ? 'cycles' : 'mine');

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Performance"
        description="Review cycles, who reviews whom, the goals a review is judged against, and who is still uncovered."
      />

      <Tabs items={tabs} value={tab} onChange={setTab} idPrefix="performance" />

      {/* One panel at a time: all three would fire every query, including two nobody asked for. */}
      <TabPanel idPrefix="performance" value={tab}>
        {tab === 'mine' && <MyReviewsTab />}
        {tab === 'cycles' && <CyclesTab />}
        {tab === 'reviews' && <ReviewsTab />}
      </TabPanel>
    </div>
  );
}
