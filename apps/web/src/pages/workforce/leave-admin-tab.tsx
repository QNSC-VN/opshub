import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CalendarPlus, Repeat2, Trash2, UserCog } from 'lucide-react';
import { api } from '@/shared/api/client';
import { apiErrorMessage } from '@/shared/api/errors';
import { activeEmployeeOptions } from '@/shared/api/picker-sources';
import { formatDate } from '@/shared/lib/format';
import { usePermissions } from '@/shared/hooks/use-permissions';
import {
  Badge,
  Button,
  ConfirmDialog,
  EntityPicker,
  Input,
  PanelAction,
  TabToolbar,
  humanizeStatus,
} from '@/shared/ui';
import { HolidayList, LeaveBalancePanel } from './leave-balance-panel';
import { DeclareHolidayModal, RunCarryOverModal, SetEntitlementModal } from './leave-admin-modals';
import { useHolidays, useLeavePolicies } from './use-leave-admin';

/**
 * Leave balances, the holiday calendar and the accrual policies — the half of TMS that existed only in the
 * API until now.
 *
 * WHY THIS IS ONE TAB AND NOT TWO. The self-service question ("how many days do I have") and the HR one
 * ("what has this person been granted") are the same numbers read about different people, and the API says
 * so: `/leave/balance` narrows to the caller without `workforce.read` and answers for anybody with it. So the
 * tab shows the reader's own balances by default, and a person picker appears only for somebody who may look
 * up others — rather than two screens whose arithmetic could drift.
 *
 * EVERY ADMIN ACTION IS `workforce.manage`, NOT `workforce.approve`. Declaring an allowance, running the
 * carry-over and declaring a holiday all decide what EVERY employee may take; approving one request is a
 * different act with a different permission, and it lives on the Leave tab.
 */
export function LeaveAdminTab() {
  const qc = useQueryClient();
  const { can } = usePermissions();
  const canRead = can('workforce.read');
  const canManage = can('workforce.manage');

  const [year, setYear] = useState(new Date().getFullYear());
  const [employeeId, setEmployeeId] = useState('');
  const [modal, setModal] = useState<'entitlement' | 'carry-over' | 'holiday' | null>(null);
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null);

  const policies = useLeavePolicies();
  const holidays = useHolidays(year);
  const invalidate = () => qc.invalidateQueries({ queryKey: ['workforce'] });

  const removeHoliday = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await api.DELETE('/v1/workforce/holidays/{id}', {
        params: { path: { id } },
      });
      if (error) throw new Error(apiErrorMessage(error, 'Failed to remove the holiday.'));
    },
    onSuccess: () => {
      toast.success('Holiday removed');
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="flex flex-col gap-5">
      <TabToolbar
        filter={
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs text-fg-subtle">
              Year
              <Input
                type="number"
                min={2000}
                max={2100}
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
                className="w-24"
              />
            </label>
            {/* Only for somebody who may read another employee's records. Without the permission the API
                narrows to the caller anyway, so offering the picker would be offering a 403. */}
            {canRead && (
              <div className="w-64">
                <EntityPicker
                  ariaLabel="Balances for employee"
                  value={employeeId}
                  onChange={(value) => setEmployeeId(value)}
                  queryKey="active-employees"
                  fetchOptions={activeEmployeeOptions}
                  placeholder="My balances — search to pick someone"
                />
              </div>
            )}
          </div>
        }
        action={
          canManage ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setModal('entitlement')}>
                <UserCog className="h-4 w-4" strokeWidth={2} />
                Set entitlement
              </Button>
              <Button variant="outline" size="sm" onClick={() => setModal('carry-over')}>
                <Repeat2 className="h-4 w-4" strokeWidth={2} />
                Run carry-over
              </Button>
              <Button variant="primary" size="sm" onClick={() => setModal('holiday')}>
                <CalendarPlus className="h-4 w-4" strokeWidth={2} />
                Declare a holiday
              </Button>
            </div>
          ) : undefined
        }
      />

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-medium text-fg">
          {employeeId ? 'Balances' : 'My balances'} for {year}
        </h3>
        <LeaveBalancePanel employeeId={employeeId || undefined} year={year} />
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-medium text-fg">Public holidays in {year}</h3>
        <HolidayList year={year} />
        {/* Removal sits here rather than on the list rows so the reference list stays readable for the
            employees who only read it — the ones who cannot remove anything. */}
        {canManage && (holidays.data ?? []).length > 0 && (
          <div className="flex flex-wrap items-center gap-1">
            {(holidays.data ?? []).map((holiday) => (
              <PanelAction
                key={holiday.id}
                tone="danger"
                onClick={() => setRemoving({ id: holiday.id, name: holiday.name })}
              >
                <Trash2 className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
                {formatDate(holiday.date)}
              </PanelAction>
            ))}
          </div>
        )}
      </section>

      {/* The policies, as reference: they are why a balance says what it says, and they are read-only —
          changing an accrual method is a migration, not a form. */}
      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-medium text-fg">Accrual policies</h3>
        {policies.isError && <p className="text-xs text-danger">Failed to load the policies.</p>}
        <div className="flex flex-col gap-1">
          {(policies.data ?? []).map((policy) => (
            <div
              key={policy.leaveType}
              className="rounded-md border border-border bg-surface px-2.5 py-1.5"
            >
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs font-medium text-fg">
                  {humanizeStatus(policy.leaveType)}
                </span>
                <Badge tone="neutral">{humanizeStatus(policy.accrualMethod)}</Badge>
                {policy.isDefault && <Badge tone="blue">Default</Badge>}
              </div>
              <p className="mt-0.5 text-xs text-fg-subtle">
                Carry over up to {policy.carryOverMaxDays} day(s), expiring{' '}
                {policy.carryOverExpiryMonths} month(s) into the next year
                {policy.note && ` · ${policy.note}`}
              </p>
            </div>
          ))}
        </div>
      </section>

      <ConfirmDialog
        open={!!removing}
        onCancel={() => setRemoving(null)}
        onConfirm={() => {
          if (removing) removeHoliday.mutate(removing.id);
          setRemoving(null);
        }}
        title="Remove this holiday?"
        description={`${removing?.name ?? ''} stops being a non-working day, so leave spanning it will cost a day more. Requests already approved keep the cost they were approved with.`}
        confirmLabel="Remove holiday"
      />

      {modal === 'entitlement' && (
        <SetEntitlementModal onClose={() => setModal(null)} onSuccess={invalidate} />
      )}
      {modal === 'carry-over' && (
        <RunCarryOverModal onClose={() => setModal(null)} onSuccess={invalidate} />
      )}
      {modal === 'holiday' && (
        <DeclareHolidayModal onClose={() => setModal(null)} onSuccess={invalidate} />
      )}
    </div>
  );
}
