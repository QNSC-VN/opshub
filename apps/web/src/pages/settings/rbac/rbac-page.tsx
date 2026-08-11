import { useState } from 'react';
import { PageHeader, TabPanel, Tabs } from '@/shared/ui';
import { RolesTab } from './roles-tab';
import { AssignmentsTab } from './assignments-tab';
import { DelegationsTab } from './delegations-tab';

/*
 * Role-based access control: the roles, who holds them, and who may decide in whose place.
 *
 * WHAT THIS SCREEN NO LONGER CARRIES
 *
 * Its OWN `formatDate` — a third spelling of a function `@/shared/lib/format` already owned, with its
 * own locale choice; an `inputClass`; three hand-rolled `fixed inset-0` dialogs with no
 * `role="dialog"`, focus trap or Escape; a hand-rolled tab bar with no `tablist`; ten raw table header
 * cells across two tables; a role list built from clickable `<div>`s with no header, no loading state
 * and no empty state; a `dl` grid; and an inline `active ? 'bg-success-bg' : …` for a status the
 * shared tone map already answers.
 *
 * COMPOSITION ONLY. It was 906 lines — the file the FE line ceiling was pinned to after people — and
 * is now four modules plus a shared one.
 */

type RbacTab = 'roles' | 'assignments' | 'delegations';

const RBAC_TABS: { value: RbacTab; label: string }[] = [
  { value: 'roles', label: 'Roles' },
  { value: 'assignments', label: 'Assignments' },
  { value: 'delegations', label: 'Delegations' },
];

export function RbacPage() {
  const [tab, setTab] = useState<RbacTab>('roles');

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Access Control"
        description="Roles and their permissions, role assignments, and approval delegations."
      />

      <Tabs items={RBAC_TABS} value={tab} onChange={setTab} idPrefix="rbac" />

      {/* One panel at a time: mounting all three would fire every tab's queries on load. */}
      <TabPanel idPrefix="rbac" value={tab}>
        {tab === 'roles' && <RolesTab />}
        {tab === 'assignments' && <AssignmentsTab />}
        {tab === 'delegations' && <DelegationsTab />}
      </TabPanel>
    </div>
  );
}
