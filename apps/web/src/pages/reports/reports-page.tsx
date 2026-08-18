import { useState } from 'react';
import { PageHeader, SegmentedControl } from '@/shared/ui';
import { Card } from './report-parts';
import { DAYS_OPTIONS } from './report-config';
import { AssetUtilizationChart } from './asset-reports';
import { FindingsChart } from './compliance-reports';
import { CycleTimeChart, QueueTable, SlaChart, ThroughputChart } from './request-reports';
import { WorkforceSummary } from './workforce-reports';

/*
 * Analytics across the four systems.
 *
 * COMPOSITION ONLY: pick a window, lay the panels out. The charts and the panel frame moved to their
 * own modules when this file passed the FE line ceiling — which it did because of the comments
 * explaining the colour change, not because of new behaviour, and the ceiling is right either way.
 */
export function ReportsPage() {
  const [days, setDays] = useState(30);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Reports"
        description="Analytics and KPIs across IT operations, compliance and workforce."
        actions={
          // A window picker is one choice from three, which is a segmented control rather than a
          // select — and it is now announced as "Reporting window" instead of as a bare combobox.
          <SegmentedControl
            label="Reporting window"
            options={DAYS_OPTIONS.map((o) => ({ value: String(o.value), label: o.label }))}
            value={String(days)}
            onChange={(value) => setDays(Number(value))}
          />
        }
      />

      {/* Row 1: Throughput (wide) + Queue depth */}
      <div className="grid grid-cols-3 gap-4">
        <Card title="Request Throughput" className="col-span-2">
          <ThroughputChart days={days} />
        </Card>
        <Card title="Live Queue Depth">
          <QueueTable />
        </Card>
      </div>

      {/* Row 2: SLA compliance + Cycle time */}
      <div className="grid grid-cols-2 gap-4">
        <Card title="SLA Compliance">
          <SlaChart days={days} />
        </Card>
        <Card title="Cycle Time (p50 / p90)">
          <CycleTimeChart days={days} />
        </Card>
      </div>

      {/* Row 3: Asset utilization + Findings donut */}
      <div className="grid grid-cols-2 gap-4">
        <Card title="Asset Utilization">
          <AssetUtilizationChart />
        </Card>
        <Card title="Open Compliance Findings">
          <FindingsChart days={days} />
        </Card>
      </div>

      {/* Row 4: Workforce */}
      <Card title="Workforce Summary">
        <WorkforceSummary days={days} />
      </Card>
    </div>
  );
}
