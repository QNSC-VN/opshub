import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Pencil, UserPlus, UserMinus, Users } from 'lucide-react';
import { api } from '@/shared/api/client';
import {
  Button,
  DataTable,
  EntityDetailPanel,
  ListPage,
  PhotoUploadWidget,
  SegmentedControl,
  SlideOverSection,
  type DataTableColumn,
} from '@/shared/ui';
import { useListState } from '@/shared/hooks/use-list-state';
import { EmployeeModal } from './employee-modal';
import { OnboardingWizard } from './onboarding-wizard';
import { OffboardingModal } from './offboarding-modal';
import { Avatar, EmployeeStatusBadge, RoleChip, StatusSelect } from './people-shared';
import { STATUS_FILTERS, type EmployeeResponse } from './people.types';

/*
 * WHAT THIS SCREEN NO LONGER CARRIES
 *
 * A status→class map and a hand-written five-branch ternary picking a badge tone in the drawer (which
 * named `inactive` and `terminated` — two statuses the API does not have — and defaulted the two it
 * does); an `inputClass`, a `dialogActionsClass` and a `cancelBtnClass`; a raw table with five header
 * cells; a `dl` grid; a search box built inline; and `limit: 100` with no paging.
 *
 * It was also 1081 lines — the file the FE line ceiling is pinned to. It is now six modules, and this
 * one composes them.
 */

function useEmployees(search: string, status: string, limit: number, offset: number) {
  return useQuery({
    // The offset is part of the key, or React Query serves page 1 for every page.
    queryKey: ['employees', 'list', search, status, limit, offset],
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/employees', {
        params: {
          query: {
            search: search || undefined,
            status: (status || undefined) as ('active' | 'on_leave' | 'offboarded') | undefined,
            limit,
            offset,
          },
        },
      });
      if (error || !data) throw new Error('Failed to load employees');
      return data;
    },
  });
}

export function PeoplePage() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('active');
  const [modal, setModal] = useState<{
    mode: 'create' | 'edit';
    employee?: EmployeeResponse;
  } | null>(null);
  const [onboarding, setOnboarding] = useState<EmployeeResponse | null>(null);
  const [offboarding, setOffboarding] = useState<EmployeeResponse | null>(null);
  const [selected, setSelected] = useState<EmployeeResponse | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const list = useListState();

  const employees = useEmployees(list.search, statusFilter, list.limit, list.offset);
  const invalidate = () => qc.invalidateQueries({ queryKey: ['employees'] });

  /** Both wizards end the same way: the engine has the request, so point the user at it. */
  function notifyRequest(requestId: string) {
    invalidate();
    toast.success('Request submitted', {
      description: `Tracked as ${requestId.slice(0, 8)} — follow it under Inbox.`,
    });
  }

  const columns: DataTableColumn<EmployeeResponse>[] = [
    {
      key: 'name',
      header: 'Employee',
      cell: (emp) => (
        <div className="flex items-center gap-3">
          <Avatar name={emp.displayName} />
          <div className="min-w-0">
            <p className="truncate font-medium text-fg">{emp.displayName}</p>
            <p className="truncate text-xs text-fg-subtle">{emp.email}</p>
          </div>
        </div>
      ),
    },
    { key: 'department', header: 'Department', cell: (emp) => emp.department ?? '—' },
    {
      key: 'jobTitle',
      header: 'Job title',
      cell: (emp) => emp.jobTitle ?? '—',
      hideOnMobile: true,
    },
    {
      key: 'roles',
      header: 'Roles',
      cell: (emp) => (
        <div className="flex flex-wrap gap-1">
          {emp.roles.length ? (
            emp.roles.map((r) => <RoleChip key={r} role={r} />)
          ) : (
            <span className="text-fg-subtle">—</span>
          )}
        </div>
      ),
      hideOnMobile: true,
    },
    {
      key: 'status',
      header: 'Status',
      // The SELECT, not the badge: this column is where status is changed. The badge shows it in the
      // drawer, where it is read rather than edited.
      cell: (emp) => <StatusSelect employee={emp} onSuccess={invalidate} />,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (emp) => (
        <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          {emp.status === 'active' && (
            <>
              <IconAction
                label={`Onboard ${emp.displayName}`}
                icon={UserPlus}
                onClick={() => setOnboarding(emp)}
              />
              <IconAction
                label={`Offboard ${emp.displayName}`}
                icon={UserMinus}
                tone="danger"
                onClick={() => setOffboarding(emp)}
              />
            </>
          )}
          <IconAction
            label={`Edit ${emp.displayName}`}
            icon={Pencil}
            onClick={() => setModal({ mode: 'edit', employee: emp })}
          />
        </div>
      ),
    },
  ];

  return (
    <>
      {modal && (
        <EmployeeModal
          mode={modal.mode}
          employee={modal.employee}
          onClose={() => setModal(null)}
          onSuccess={invalidate}
        />
      )}

      {onboarding && (
        <OnboardingWizard
          employee={onboarding}
          onClose={() => setOnboarding(null)}
          onSuccess={(requestId) => {
            setOnboarding(null);
            notifyRequest(requestId);
          }}
        />
      )}

      {offboarding && (
        <OffboardingModal
          employee={offboarding}
          onClose={() => setOffboarding(null)}
          onSuccess={(requestId) => {
            setOffboarding(null);
            notifyRequest(requestId);
          }}
        />
      )}

      <ListPage
        title="People"
        description="The employee directory, its lifecycle, and the requests that move it."
        actions={
          <Button variant="primary" onClick={() => setModal({ mode: 'create' })}>
            <Plus className="h-4 w-4" strokeWidth={2} />
            Add employee
          </Button>
        }
        search={{
          value: list.search,
          onChange: list.setSearch,
          placeholder: 'Search name or email…',
        }}
        filters={
          <SegmentedControl
            label="Filter by status"
            options={STATUS_FILTERS}
            value={statusFilter}
            onChange={(value) => {
              setStatusFilter(value);
              list.resetPaging();
            }}
          />
        }
        pageInfo={employees.data?.pageInfo}
        onOffsetChange={list.goToOffset}
        noun="employees"
      >
        <DataTable
          columns={columns}
          rows={employees.data?.data as EmployeeResponse[] | undefined}
          isLoading={employees.isLoading}
          isError={employees.isError}
          errorMessage="Failed to load employees."
          emptyMessage="No employees match this filter"
          emptyIcon={Users}
          onRowClick={(emp) => {
            setSelected(emp);
            setAvatarUrl(null);
          }}
          isRowActive={(emp) => emp.id === selected?.id}
        />
      </ListPage>

      <EntityDetailPanel
        open={!!selected}
        onClose={() => setSelected(null)}
        width="lg"
        title={selected?.displayName ?? 'Employee detail'}
        description={[selected?.jobTitle, selected?.department].filter(Boolean).join(' · ')}
        items={
          selected
            ? [
                { label: 'Email', value: selected.email },
                { label: 'Department', value: selected.department },
                { label: 'Job title', value: selected.jobTitle },
                // One tone lookup, shared with the table and every other screen — the five-branch
                // ternary this replaces named two statuses the API does not have and defaulted the
                // two it does.
                { label: 'Status', value: <EmployeeStatusBadge status={selected.status} /> },
                {
                  label: 'Roles',
                  value: selected.roles.length ? (
                    <div className="flex flex-wrap gap-1">
                      {selected.roles.map((r) => (
                        <RoleChip key={r} role={r} />
                      ))}
                    </div>
                  ) : null,
                },
              ]
            : []
        }
        activity={selected ? { resourceId: selected.id, resourceType: 'employee' } : undefined}
      >
        {selected && (
          <SlideOverSection title="Photo">
            <PhotoUploadWidget
              mode="image"
              currentUrl={avatarUrl}
              presignUrl={`/v1/employees/${selected.id}/avatar/presign`}
              confirmUrl={`/v1/employees/${selected.id}/avatar/confirm`}
              accept="image/jpeg,image/png,image/webp"
              onSuccess={(url) => {
                setAvatarUrl(url);
                invalidate();
              }}
              label="Employee photo (JPEG, PNG, WebP · max 5 MB)"
            />
          </SlideOverSection>
        )}
      </EntityDetailPanel>
    </>
  );
}

/**
 * An icon-only row action.
 *
 * `aria-label` is required rather than optional: three icon buttons per row with no accessible name
 * is three "button" announcements, and the previous version had exactly that.
 */
function IconAction({
  label,
  icon: Icon,
  onClick,
  tone = 'muted',
}: {
  label: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  onClick: () => void;
  tone?: 'muted' | 'danger';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={
        tone === 'danger'
          ? 'rounded p-1.5 text-fg-subtle transition-colors hover:bg-danger-bg hover:text-danger'
          : 'rounded p-1.5 text-fg-subtle transition-colors hover:bg-surface-hover hover:text-fg'
      }
    >
      <Icon className="h-4 w-4" strokeWidth={2} />
    </button>
  );
}
