import { useState } from 'react';
import { PageHeader, TabPanel, Tabs } from '@/shared/ui';
import { CatalogueTab } from './catalogue-tab';
import { SoaTab } from './soa-tab';

/**
 * Controls and the Statement of Applicability.
 *
 * TWO TABS, AND THE ORDER IS THE ARGUMENT. The SoA is what an audit asks for, so it opens first; the
 * catalogue is where a control that has never been decided gets decided, which is the gap the SoA's
 * "undecided" tile counts. Separating the report from the way to act on it is how an SoA ends up with
 * thirty controls nobody ever considered.
 *
 * Both tabs need `control.read` to reach at all — the route is gated in the nav — and each hides its
 * write actions behind `control.manage` rather than offering buttons that can only 403.
 */

type ControlsTab = 'soa' | 'catalogue';

const CONTROLS_TABS: { value: ControlsTab; label: string }[] = [
  { value: 'soa', label: 'Statement of Applicability' },
  { value: 'catalogue', label: 'Control catalogue' },
];

export function ControlsPage() {
  const [tab, setTab] = useState<ControlsTab>('soa');

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Controls"
        description="Which controls apply here, how far each is implemented, and which risks justify them."
      />

      <Tabs items={CONTROLS_TABS} value={tab} onChange={setTab} idPrefix="controls" />

      {/* One panel at a time: the SoA and the catalogue each fetch a page plus a report. */}
      <TabPanel idPrefix="controls" value={tab}>
        {tab === 'soa' && <SoaTab />}
        {tab === 'catalogue' && <CatalogueTab />}
      </TabPanel>
    </div>
  );
}
