import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/shared/api/client';
import { apiErrorMessage } from '@/shared/api/errors';
import { activeEmployeeOptions } from '@/shared/api/picker-sources';
import { todayIso } from '@/shared/lib/format';
import {
  EntityPicker,
  FormActions,
  FormError,
  FormField,
  Input,
  Modal,
  Select,
  Textarea,
  humanizeStatus,
} from '@/shared/ui';
import { LEAVE_TYPES, useLeavePolicies } from './use-leave-admin';

/**
 * The three things HR does to leave: declare an allowance, run the carry-over, declare a holiday.
 *
 * All three are `workforce.manage` and none is `workforce.approve`, which is the API's split and the right
 * one: these decide what EVERY employee may take, and that is a different act from deciding one person's
 * request.
 */

/**
 * Declaring an allowance.
 *
 * AN UPSERT, and the form says so. An allowance is corrected more often than created — a mid-year joiner, a
 * policy change — so a second call for the same employee, type and year updates rather than conflicting.
 */
export function SetEntitlementModal({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: () => void;
}) {
  const policies = useLeavePolicies();
  const [form, setForm] = useState({
    employeeId: '',
    leaveType: 'annual' as (typeof LEAVE_TYPES)[number],
    year: new Date().getFullYear(),
    grantedDays: '20',
    carriedOverDays: '',
    note: '',
  });
  const [error, setError] = useState('');

  const policy = policies.data?.find((p) => p.leaveType === form.leaveType);

  const mutation = useMutation({
    mutationFn: async () => {
      const { error: err } = await api.PUT('/v1/workforce/leave/entitlement', {
        body: {
          employeeId: form.employeeId,
          leaveType: form.leaveType,
          year: form.year,
          grantedDays: Number(form.grantedDays),
          carriedOverDays: form.carriedOverDays ? Number(form.carriedOverDays) : undefined,
          note: form.note || undefined,
        },
      });
      if (err) throw new Error(apiErrorMessage(err, 'Failed to set the entitlement.'));
    },
    onSuccess: () => {
      toast.success('Entitlement set');
      onSuccess();
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Set a leave entitlement"
      description="An upsert: setting the same employee, type and year again corrects the allowance rather than failing."
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError('');
          mutation.mutate();
        }}
        className="flex flex-col gap-4 p-5"
      >
        <FormField label="Employee" htmlFor="ent-employee" required>
          <EntityPicker
            id="ent-employee"
            value={form.employeeId}
            onChange={(value) => set('employeeId', value)}
            queryKey="active-employees"
            fetchOptions={activeEmployeeOptions}
            placeholder="Search employees…"
          />
        </FormField>

        <div className="grid grid-cols-3 gap-3">
          <FormField label="Leave type" htmlFor="ent-type" required>
            <Select
              id="ent-type"
              value={form.leaveType}
              onChange={(e) => set('leaveType', e.target.value as typeof form.leaveType)}
            >
              {LEAVE_TYPES.map((code) => (
                <option key={code} value={code}>
                  {humanizeStatus(code)}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Year" htmlFor="ent-year" required>
            <Input
              id="ent-year"
              type="number"
              required
              min={2000}
              max={2100}
              value={form.year}
              onChange={(e) => set('year', Number(e.target.value))}
            />
          </FormField>
          <FormField label="Granted days" htmlFor="ent-granted" required>
            <Input
              id="ent-granted"
              type="number"
              required
              min={0}
              step={0.5}
              value={form.grantedDays}
              onChange={(e) => set('grantedDays', e.target.value)}
            />
          </FormField>
        </div>

        <FormField
          label="Carried over days"
          htmlFor="ent-carried"
          hint="Usually left blank: the carry-over run sets this from last year's closing balance."
        >
          <Input
            id="ent-carried"
            type="number"
            min={0}
            step={0.5}
            value={form.carriedOverDays}
            onChange={(e) => set('carriedOverDays', e.target.value)}
          />
        </FormField>

        {/* The policy that will govern this allowance, read from the API — half days accrue monthly under
            one method and all at once under another, and the balance is unreadable without knowing which. */}
        {policy && (
          <p className="text-xs text-fg-subtle">
            {humanizeStatus(policy.leaveType)} accrues{' '}
            {humanizeStatus(policy.accrualMethod).toLowerCase()}, and carries over up to{' '}
            {policy.carryOverMaxDays} day(s) which expire {policy.carryOverExpiryMonths} month(s)
            into the next year.
          </p>
        )}

        <FormField label="Note" htmlFor="ent-note" hint="Why this allowance differs, if it does.">
          <Textarea
            id="ent-note"
            rows={2}
            value={form.note}
            onChange={(e) => set('note', e.target.value)}
          />
        </FormField>

        <FormError message={error} />
        <FormActions loading={mutation.isPending} onClose={onClose} submitLabel="Set entitlement" />
      </form>
    </Modal>
  );
}

/**
 * Running the carry-over.
 *
 * IDEMPOTENT, AND THAT IS THE HEADLINE. It SETS each carried figure from the previous year's closing balance
 * rather than adding to it, so a second run — or a run after a late correction to last year — lands on the
 * same answer. The result is worth showing rather than a toast: employees with days to carry but no
 * entitlement row are REPORTED, not given a row with a zero grant, because next year's allowance is HR's
 * decision and not this run's.
 */
export function RunCarryOverModal({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [year, setYear] = useState(new Date().getFullYear());
  const [error, setError] = useState('');
  /**
   * The run's own report.
   *
   * `skippedNoTargetRow` carries the employee and leave type, not just a count: those are the people HR has
   * to declare an allowance for before their days can carry, and a bare number leaves nobody to act on.
   */
  const [result, setResult] = useState<{
    applied: number;
    skipped: { employeeId: string; leaveType: string; days: number }[];
  } | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      const { data, error: err } = await api.POST('/v1/workforce/leave/carry-over', {
        body: { year },
      });
      if (err || !data) throw new Error(apiErrorMessage(err, 'Failed to run the carry-over.'));
      return data;
    },
    onSuccess: (data) => {
      setResult({ applied: data.applied.length, skipped: data.skippedNoTargetRow });
      toast.success(`Carried days into ${year} for ${data.applied.length} entitlement(s)`);
      onSuccess();
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title="Run the leave carry-over"
      description="Sets each carried figure from last year's closing balance, capped by policy and stamped with the date the days lapse. Running it twice lands on the same answer."
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError('');
          mutation.mutate();
        }}
        className="flex flex-col gap-4 p-5"
      >
        <FormField
          label="Into year"
          htmlFor="carry-year"
          required
          hint="The year receiving the days. Entitlements for it have to exist first."
        >
          <Input
            id="carry-year"
            type="number"
            required
            min={2000}
            max={2100}
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
          />
        </FormField>

        {/* The report, not a toast: the skipped list is the part somebody has to act on. */}
        {result && (
          <div className="rounded-md border border-border bg-surface-muted px-2.5 py-2">
            <p className="text-xs text-fg-muted">
              {result.applied} entitlement(s) received carried days.
            </p>
            {result.skipped.length > 0 && (
              <p className="mt-1 text-xs text-warning">
                {result.skipped.length} employee(s) had days to carry but no entitlement for {year},
                so nothing was carried for them. Declare their allowance and run this again.
              </p>
            )}
          </div>
        )}

        <FormError message={error} />
        <FormActions
          loading={mutation.isPending}
          onClose={onClose}
          submitLabel={result ? 'Run again' : 'Run carry-over'}
        />
      </form>
    </Modal>
  );
}

/** Declaring a public holiday. A day nobody works, so leave spanning it costs one day less. */
export function DeclareHolidayModal({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [form, setForm] = useState({ date: todayIso(), name: '', region: '' });
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: async () => {
      const { error: err } = await api.POST('/v1/workforce/holidays', {
        body: {
          date: form.date,
          name: form.name,
          region: form.region || undefined,
        },
      });
      if (err) throw new Error(apiErrorMessage(err, 'Failed to declare the holiday.'));
    },
    onSuccess: () => {
      toast.success('Holiday declared');
      onSuccess();
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title="Declare a public holiday"
      description="Leave spanning this date costs a day less, so the calendar is what makes a request's cost correct."
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError('');
          mutation.mutate();
        }}
        className="flex flex-col gap-4 p-5"
      >
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Date" htmlFor="holiday-date" required>
            <Input
              id="holiday-date"
              type="date"
              required
              value={form.date}
              onChange={(e) => setForm((c) => ({ ...c, date: e.target.value }))}
            />
          </FormField>
          <FormField
            label="Region"
            htmlFor="holiday-region"
            hint="Blank means everywhere. A site-specific day names its region."
          >
            <Input
              id="holiday-region"
              value={form.region}
              onChange={(e) => setForm((c) => ({ ...c, region: e.target.value.toUpperCase() }))}
              placeholder="ALL"
            />
          </FormField>
        </div>

        <FormField label="Name" htmlFor="holiday-name" required>
          <Input
            id="holiday-name"
            required
            value={form.name}
            onChange={(e) => setForm((c) => ({ ...c, name: e.target.value }))}
            placeholder="National Day"
          />
        </FormField>

        <FormError message={error} />
        <FormActions loading={mutation.isPending} onClose={onClose} submitLabel="Declare holiday" />
      </form>
    </Modal>
  );
}
