/**
 * RbacPage — role-based access control admin panel.
 *
 * Tabs:
 *  1. Roles    — list system + custom roles, create/delete custom roles, manage permissions per role
 *  2. Assignments — view all role assignments, assign a role to a user, revoke
 *  3. Delegations — list active approval delegations, create, delete
 *
 * Only visible to users with the 'it-admin' or 'security' role.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, X, ShieldCheck, Users, UserCheck } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/shared/api/client';
import { SlideOver, SlideOverSection } from '@/shared/ui/slide-over';
import { ActivityTimeline } from '@/shared/ui/activity-timeline';
import { ConfirmDialog } from '@/shared/ui/confirm-dialog';
import type {
  RoleResponse,
  PermissionResponse,
  RoleAssignmentResponse,
  DelegationResponse,
} from '@/shared/api/types';

// ── Shared helpers ────────────────────────────────────────────────────────────

const inputClass =
  'h-8 w-full rounded-md border border-border bg-surface px-3 text-sm text-fg placeholder:text-fg-subtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20';

function formatDate(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function SectionCard({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-xl border border-border bg-surface overflow-hidden ${className}`}>
      {children}
    </div>
  );
}

// ── Tab 1: Roles ──────────────────────────────────────────────────────────────

function useRoles() {
  return useQuery<RoleResponse[]>({
    queryKey: ['authz', 'roles'],
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/authz/roles');
      if (error || !data) throw new Error();
      return data as RoleResponse[];
    },
  });
}

function usePermissions() {
  return useQuery<PermissionResponse[]>({
    queryKey: ['authz', 'permissions'],
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/authz/permissions');
      if (error || !data) throw new Error();
      return data as PermissionResponse[];
    },
  });
}

interface CreateRoleModalProps {
  onClose: () => void;
  onSuccess: () => void;
}
function CreateRoleModal({ onClose, onSuccess }: CreateRoleModalProps) {
  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!key.trim() || !name.trim()) {
      setErr('Key and name are required.');
      return;
    }
    setLoading(true);
    setErr('');
    const { error } = await api.POST('/v1/authz/roles', {
      body: { key: key.trim(), name: name.trim(), permissions: [] },
    });
    setLoading(false);
    if (error) {
      setErr('Failed to create role. Key may already exist.');
      return;
    }
    toast.success('Role created');
    onSuccess();
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/20"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-sm rounded-xl bg-surface shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold text-fg">Create Role</h2>
          <button onClick={onClose} className="rounded p-1 text-fg-subtle hover:bg-surface-hover">
            <X className="h-4 w-4" />
          </button>
        </div>
        <form onSubmit={submit} className="flex flex-col gap-3 p-5">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-fg-muted">Key (slug)</label>
            <input
              className={inputClass}
              placeholder="e.g. compliance-reviewer"
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-fg-muted">Display name</label>
            <input
              className={inputClass}
              placeholder="e.g. Compliance Reviewer"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          {err && <p className="text-xs text-danger">{err}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="h-8 rounded-md border border-border px-3.5 text-sm font-medium text-fg-muted hover:bg-surface-hover"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="h-8 rounded-md bg-accent px-3.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-60"
            >
              {loading ? 'Creating…' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function RolesTab() {
  const qc = useQueryClient();
  const { data: roles, isLoading } = useRoles();
  const { data: allPerms } = usePermissions();
  const [selectedRole, setSelectedRole] = useState<RoleResponse | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [addPermKey, setAddPermKey] = useState<string>('');
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['authz', 'roles'] });

  async function doDeleteRole() {
    if (!pendingDeleteId) return;
    setDeleting(true);
    const { error } = await api.DELETE('/v1/authz/roles/{id}', {
      params: { path: { id: pendingDeleteId } },
    });
    setDeleting(false);
    setPendingDeleteId(null);
    if (error) {
      toast.error('Failed to delete role');
      return;
    }
    toast.success('Role deleted');
    invalidate();
  }

  async function addPermission(roleId: string, permKey: string) {
    const role = roles?.find((r) => r.id === roleId);
    if (!role) return;
    const next = [...role.permissions, permKey];
    const { error } = await api.PUT('/v1/authz/roles/{id}/permissions', {
      params: { path: { id: roleId } },
      body: { permissions: next },
    });
    if (error) {
      toast.error('Failed to add permission');
      return;
    }
    invalidate();
  }

  async function removePermission(roleId: string, permKey: string) {
    const role = roles?.find((r) => r.id === roleId);
    if (!role) return;
    const next = role.permissions.filter((p) => p !== permKey);
    const { error } = await api.PUT('/v1/authz/roles/{id}/permissions', {
      params: { path: { id: roleId } },
      body: { permissions: next },
    });
    if (error) {
      toast.error('Failed to remove permission');
      return;
    }
    invalidate();
  }

  return (
    <>
      {showCreate && (
        <CreateRoleModal onClose={() => setShowCreate(false)} onSuccess={invalidate} />
      )}
      <ConfirmDialog
        open={!!pendingDeleteId}
        variant="danger"
        title="Delete role?"
        description="This will permanently remove the role and all its permissions. Users with this role will lose access. This cannot be undone."
        confirmLabel="Delete role"
        loading={deleting}
        onConfirm={() => void doDeleteRole()}
        onCancel={() => setPendingDeleteId(null)}
      />
      <SectionCard>
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <p className="text-sm font-semibold text-fg">Roles</p>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 h-7 rounded-md bg-accent px-3 text-xs font-medium text-white hover:bg-accent-hover"
          >
            <Plus className="h-3.5 w-3.5" /> New role
          </button>
        </div>
        {isLoading && <p className="px-5 py-8 text-center text-sm text-fg-subtle">Loading…</p>}
        <div className="divide-y divide-border">
          {roles?.map((role) => (
            <div key={role.id}>
              <div
                className="flex items-center justify-between px-5 py-3 cursor-pointer hover:bg-surface-hover"
                onClick={() => setSelectedRole(role)}
              >
                <div className="flex items-center gap-3">
                  <ShieldCheck className="h-4 w-4 shrink-0 text-fg-subtle" strokeWidth={1.75} />
                  <div>
                    <p className="text-sm font-medium text-fg">{role.name}</p>
                    <p className="text-xs text-fg-subtle font-mono">{role.key}</p>
                  </div>
                  {role.system && (
                    <span className="inline-flex rounded-md bg-surface-muted px-2 py-0.5 text-[10px] font-medium text-fg-muted">
                      System
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-fg-subtle">
                    {role.permissions.length} permissions
                  </span>
                  {!role.system && (
                    <button
                      aria-label="Delete role"
                      onClick={(e) => {
                        e.stopPropagation();
                        setPendingDeleteId(role.id);
                      }}
                      className="rounded p-1 text-fg-subtle hover:bg-danger-bg hover:text-danger"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </SectionCard>

      {/* Role detail SlideOver */}
      {(() => {
        const current = selectedRole
          ? (roles?.find((r) => r.id === selectedRole.id) ?? selectedRole)
          : null;
        return (
          <SlideOver
            open={!!selectedRole}
            onClose={() => {
              setSelectedRole(null);
              setAddPermKey('');
            }}
            title={current?.name ?? 'Role'}
            description={current?.key}
            width="md"
          >
            {current && (
              <>
                <SlideOverSection title="Details">
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                    <div>
                      <dt className="text-xs text-fg-subtle">Key</dt>
                      <dd className="mt-0.5 font-mono text-sm text-fg">{current.key}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-fg-subtle">Type</dt>
                      <dd className="mt-0.5">
                        {current.system ? (
                          <span className="inline-flex rounded-md bg-surface-muted px-2 py-0.5 text-xs font-medium text-fg-muted">
                            System
                          </span>
                        ) : (
                          <span className="text-fg">Custom</span>
                        )}
                      </dd>
                    </div>
                    <div className="col-span-2">
                      <dt className="mb-2 text-xs text-fg-subtle">
                        Permissions ({current.permissions.length})
                      </dt>
                      <div className="flex flex-wrap gap-1.5">
                        {current.permissions.map((p) => (
                          <span
                            key={p}
                            className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-0.5 font-mono text-xs text-fg-muted"
                          >
                            {p}
                            {!current.system && (
                              <button
                                onClick={() => removePermission(current.id, p)}
                                className="text-fg-subtle hover:text-danger"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            )}
                          </span>
                        ))}
                        {current.permissions.length === 0 && (
                          <p className="text-xs text-fg-subtle">No permissions assigned</p>
                        )}
                      </div>
                      {!current.system && allPerms && (
                        <div className="mt-3 flex items-center gap-2">
                          <select
                            value={addPermKey}
                            onChange={(e) => setAddPermKey(e.target.value)}
                            className="h-7 rounded-md border border-border bg-surface px-2 text-xs text-fg-muted"
                          >
                            <option value="" disabled>
                              Add permission…
                            </option>
                            {allPerms
                              .filter((p) => !current.permissions.includes(p.key))
                              .map((p) => (
                                <option key={p.key} value={p.key}>
                                  {p.key}
                                </option>
                              ))}
                          </select>
                          <button
                            onClick={() => {
                              if (addPermKey) {
                                addPermission(current.id, addPermKey);
                                setAddPermKey('');
                              }
                            }}
                            className="h-7 rounded-md bg-fg px-2.5 text-xs font-medium text-surface hover:opacity-90"
                          >
                            Add
                          </button>
                        </div>
                      )}
                    </div>
                  </dl>
                </SlideOverSection>
                <div className="mx-5 h-px bg-surface-muted" />
                <SlideOverSection title="Activity">
                  <ActivityTimeline resourceId={current.id} resourceType="role" />
                </SlideOverSection>
              </>
            )}
          </SlideOver>
        );
      })()}
    </>
  );
}

// ── Tab 2: Assignments ────────────────────────────────────────────────────────

interface AssignRoleModalProps {
  roles: RoleResponse[];
  onClose: () => void;
  onSuccess: () => void;
}
function AssignRoleModal({ roles, onClose, onSuccess }: AssignRoleModalProps) {
  const [userId, setUserId] = useState('');
  const [roleId, setRoleId] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!userId.trim() || !roleId) {
      setErr('User ID and role are required.');
      return;
    }
    setLoading(true);
    setErr('');
    const { error } = await api.POST('/v1/authz/assignments', {
      body: { userId: userId.trim(), roleId, scopeType: 'global', scopeId: null },
    });
    setLoading(false);
    if (error) {
      setErr('Failed to assign role. Assignment may already exist.');
      return;
    }
    toast.success('Role assigned');
    onSuccess();
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/20"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-sm rounded-xl bg-surface shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold text-fg">Assign Role</h2>
          <button onClick={onClose} className="rounded p-1 text-fg-subtle hover:bg-surface-hover">
            <X className="h-4 w-4" />
          </button>
        </div>
        <form onSubmit={submit} className="flex flex-col gap-3 p-5">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-fg-muted">User ID</label>
            <input
              className={inputClass}
              placeholder="UUID of the employee"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-fg-muted">Role</label>
            <select
              className="h-8 w-full rounded-md border border-border bg-surface px-3 text-sm text-fg focus:outline-none"
              value={roleId}
              onChange={(e) => setRoleId(e.target.value)}
            >
              <option value="">Select a role…</option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
          {err && <p className="text-xs text-danger">{err}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="h-8 rounded-md border border-border px-3.5 text-sm font-medium text-fg-muted hover:bg-surface-hover"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="h-8 rounded-md bg-accent px-3.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-60"
            >
              {loading ? 'Assigning…' : 'Assign'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function AssignmentsTab() {
  const qc = useQueryClient();
  const [lookupUserId, setLookupUserId] = useState('');
  const [searchUserId, setSearchUserId] = useState('');
  const [pendingRevokeId, setPendingRevokeId] = useState<string | null>(null);
  const [revoking, setRevoking] = useState(false);
  const { data: assignments, isLoading } = useQuery<RoleAssignmentResponse[]>({
    queryKey: ['authz', 'assignments', searchUserId],
    enabled: searchUserId.length > 0,
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/authz/users/{userId}/assignments', {
        params: { path: { userId: searchUserId } },
      });
      if (error || !data) throw new Error();
      return data as RoleAssignmentResponse[];
    },
  });
  const { data: roles } = useRoles();
  const [showAssign, setShowAssign] = useState(false);

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ['authz', 'assignments', searchUserId] });

  async function doRevoke() {
    if (!pendingRevokeId) return;
    setRevoking(true);
    const { error } = await api.DELETE('/v1/authz/assignments/{id}', {
      params: { path: { id: pendingRevokeId } },
    });
    setRevoking(false);
    setPendingRevokeId(null);
    if (error) {
      toast.error('Failed to revoke assignment');
      return;
    }
    toast.success('Assignment revoked');
    invalidate();
  }

  const roleMap = Object.fromEntries(roles?.map((r) => [r.id, r.name]) ?? []);

  return (
    <>
      {showAssign && roles && (
        <AssignRoleModal
          roles={roles}
          onClose={() => setShowAssign(false)}
          onSuccess={invalidate}
        />
      )}
      <ConfirmDialog
        open={!!pendingRevokeId}
        variant="warning"
        title="Revoke role assignment?"
        description="The user will immediately lose all permissions granted by this role. Active sessions may be affected on next token refresh."
        confirmLabel="Revoke"
        loading={revoking}
        onConfirm={() => void doRevoke()}
        onCancel={() => setPendingRevokeId(null)}
      />
      <SectionCard>
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <p className="text-sm font-semibold text-fg">Role Assignments</p>
          <button
            onClick={() => setShowAssign(true)}
            className="flex items-center gap-1.5 h-7 rounded-md bg-accent px-3 text-xs font-medium text-white hover:bg-accent-hover"
          >
            <Plus className="h-3.5 w-3.5" /> Assign role
          </button>
        </div>
        {/* User lookup */}
        <div className="flex items-center gap-2 border-b border-border px-5 py-3">
          <input
            className="h-7 flex-1 rounded-md border border-border bg-surface px-3 text-sm text-fg placeholder:text-fg-subtle focus:outline-none"
            placeholder="Enter User ID to look up assignments…"
            value={lookupUserId}
            onChange={(e) => setLookupUserId(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && setSearchUserId(lookupUserId.trim())}
          />
          <button
            onClick={() => setSearchUserId(lookupUserId.trim())}
            className="h-7 rounded-md bg-fg px-3 text-xs font-medium text-surface hover:opacity-90"
          >
            Lookup
          </button>
        </div>
        {isLoading && <p className="px-5 py-8 text-center text-sm text-fg-subtle">Loading…</p>}
        {!searchUserId && (
          <p className="px-5 py-8 text-center text-sm text-fg-subtle">
            Enter a User ID above to view their assignments.
          </p>
        )}
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-muted">
              <th className="px-4 py-2.5 text-left text-xs font-medium text-fg-muted">User ID</th>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-fg-muted">Role</th>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-fg-muted">Scope</th>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-fg-muted">Expires</th>
              <th className="px-4 py-2.5 w-10" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {searchUserId && !isLoading && !assignments?.length && (
              <tr>
                <td colSpan={5} className="py-10 text-center text-sm text-fg-subtle">
                  No assignments found for this user
                </td>
              </tr>
            )}
            {assignments?.map((a) => (
              <tr key={a.id} className="hover:bg-surface-hover">
                <td className="px-4 py-2.5 text-xs font-mono text-fg-muted">
                  {a.userId.slice(0, 8)}…
                </td>
                <td className="px-4 py-2.5">
                  <span className="inline-flex items-center gap-1 rounded-md bg-accent-muted px-2 py-0.5 text-xs font-medium text-accent">
                    <ShieldCheck className="h-3 w-3" />
                    {roleMap[a.roleId] ?? a.roleId}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-xs text-fg-muted capitalize">{a.scopeType}</td>
                <td className="px-4 py-2.5 text-xs text-fg-muted">{formatDate(a.expiresAt)}</td>
                <td className="px-4 py-2.5">
                  <button
                    aria-label="Revoke assignment"
                    onClick={() => setPendingRevokeId(a.id)}
                    className="rounded p-1 text-fg-subtle hover:bg-danger-bg hover:text-danger"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </SectionCard>
    </>
  );
}

// ── Tab 3: Delegations ────────────────────────────────────────────────────────

interface CreateDelegationModalProps {
  onClose: () => void;
  onSuccess: () => void;
}
function CreateDelegationModal({ onClose, onSuccess }: CreateDelegationModalProps) {
  const [toUserId, setToUserId] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!toUserId.trim() || !endsAt) {
      setErr('Delegate user ID and end date are required.');
      return;
    }
    setLoading(true);
    setErr('');
    const { error } = await api.POST('/v1/authz/delegations', {
      body: {
        toUserId: toUserId.trim(),
        startsAt: new Date().toISOString(),
        endsAt: new Date(endsAt).toISOString(),
        reason: reason.trim() || undefined,
      },
    });
    setLoading(false);
    if (error) {
      setErr('Failed to create delegation.');
      return;
    }
    toast.success('Delegation created');
    onSuccess();
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/20"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-sm rounded-xl bg-surface shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold text-fg">Create Delegation</h2>
          <button onClick={onClose} className="rounded p-1 text-fg-subtle hover:bg-surface-hover">
            <X className="h-4 w-4" />
          </button>
        </div>
        <form onSubmit={submit} className="flex flex-col gap-3 p-5">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-fg-muted">Delegate to (User ID)</label>
            <input
              className={inputClass}
              placeholder="UUID of the delegate"
              value={toUserId}
              onChange={(e) => setToUserId(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-fg-muted">Ends at</label>
            <input
              type="datetime-local"
              className={inputClass}
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-fg-muted">Reason (optional)</label>
            <input
              className={inputClass}
              placeholder="e.g. Parental leave coverage"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          {err && <p className="text-xs text-danger">{err}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="h-8 rounded-md border border-border px-3.5 text-sm font-medium text-fg-muted hover:bg-surface-hover"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="h-8 rounded-md bg-accent px-3.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-60"
            >
              {loading ? 'Creating…' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function DelegationsTab() {
  const qc = useQueryClient();
  const { data: delegations, isLoading } = useQuery<DelegationResponse[]>({
    queryKey: ['authz', 'delegations'],
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/authz/delegations');
      if (error || !data) throw new Error();
      return data as DelegationResponse[];
    },
  });
  const [showCreate, setShowCreate] = useState(false);
  const [pendingDeleteDelegId, setPendingDeleteDelegId] = useState<string | null>(null);
  const [deletingDeleg, setDeletingDeleg] = useState(false);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['authz', 'delegations'] });

  async function doDeleteDelegation() {
    if (!pendingDeleteDelegId) return;
    setDeletingDeleg(true);
    const { error } = await api.DELETE('/v1/authz/delegations/{id}', {
      params: { path: { id: pendingDeleteDelegId } },
    });
    setDeletingDeleg(false);
    setPendingDeleteDelegId(null);
    if (error) {
      toast.error('Failed to delete delegation');
      return;
    }
    toast.success('Delegation deleted');
    invalidate();
  }

  const now = new Date();

  return (
    <>
      {showCreate && (
        <CreateDelegationModal onClose={() => setShowCreate(false)} onSuccess={invalidate} />
      )}
      <ConfirmDialog
        open={!!pendingDeleteDelegId}
        variant="warning"
        title="Delete delegation?"
        description="The delegated approver will no longer be able to act on behalf of the delegator. Any in-flight approvals they are assigned to will need to be reassigned."
        confirmLabel="Delete delegation"
        loading={deletingDeleg}
        onConfirm={() => void doDeleteDelegation()}
        onCancel={() => setPendingDeleteDelegId(null)}
      />
      <SectionCard>
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <div>
            <p className="text-sm font-semibold text-fg">Approval Delegations</p>
            <p className="text-xs text-fg-subtle">
              Temporarily delegate approval authority to another user.
            </p>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 h-7 rounded-md bg-accent px-3 text-xs font-medium text-white hover:bg-accent-hover"
          >
            <Plus className="h-3.5 w-3.5" /> New delegation
          </button>
        </div>
        {isLoading && <p className="px-5 py-8 text-center text-sm text-fg-subtle">Loading…</p>}
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-muted">
              <th className="px-4 py-2.5 text-left text-xs font-medium text-fg-muted">From</th>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-fg-muted">To</th>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-fg-muted">Starts</th>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-fg-muted">Ends</th>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-fg-muted">Status</th>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-fg-muted">Reason</th>
              <th className="px-4 py-2.5 w-10" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {!isLoading && !delegations?.length && (
              <tr>
                <td colSpan={7} className="py-10 text-center text-sm text-fg-subtle">
                  No delegations
                </td>
              </tr>
            )}
            {delegations?.map((d) => {
              const active = new Date(d.startsAt) <= now && new Date(d.endsAt) >= now;
              return (
                <tr key={d.id} className="hover:bg-surface-hover">
                  <td className="px-4 py-2.5 text-xs font-mono text-fg-muted">
                    {d.fromUserId.slice(0, 8)}…
                  </td>
                  <td className="px-4 py-2.5 text-xs font-mono text-fg-muted">
                    {d.toUserId.slice(0, 8)}…
                  </td>
                  <td className="px-4 py-2.5 text-xs text-fg-muted">{formatDate(d.startsAt)}</td>
                  <td className="px-4 py-2.5 text-xs text-fg-muted">{formatDate(d.endsAt)}</td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`inline-flex rounded-md px-2 py-0.5 text-xs font-medium ${active ? 'bg-success-bg text-success' : 'bg-surface-muted text-fg-muted'}`}
                    >
                      {active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-fg-muted truncate max-w-[140px]">
                    {d.reason ?? '—'}
                  </td>
                  <td className="px-4 py-2.5">
                    <button
                      aria-label="Delete delegation"
                      onClick={() => setPendingDeleteDelegId(d.id)}
                      className="rounded p-1 text-fg-subtle hover:bg-danger-bg hover:text-danger"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </SectionCard>
    </>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

type RbacTab = 'roles' | 'assignments' | 'delegations';

const TABS: { value: RbacTab; label: string; icon: React.ElementType }[] = [
  { value: 'roles', label: 'Roles', icon: ShieldCheck },
  { value: 'assignments', label: 'Assignments', icon: Users },
  { value: 'delegations', label: 'Delegations', icon: UserCheck },
];

export function RbacPage() {
  const [tab, setTab] = useState<RbacTab>('roles');

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div>
        <h1 className="text-lg font-semibold tracking-tight text-fg">Access Control</h1>
        <p className="mt-0.5 text-sm text-fg-muted">
          Manage roles, user assignments, and approval delegations.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-lg bg-surface-muted p-1 w-fit">
        {TABS.map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            onClick={() => setTab(value)}
            className={[
              'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              tab === value ? 'bg-surface text-fg shadow-sm' : 'text-fg-muted hover:text-fg-muted',
            ].join(' ')}
          >
            <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
            {label}
          </button>
        ))}
      </div>

      {/* Content */}
      {tab === 'roles' && <RolesTab />}
      {tab === 'assignments' && <AssignmentsTab />}
      {tab === 'delegations' && <DelegationsTab />}
    </div>
  );
}
