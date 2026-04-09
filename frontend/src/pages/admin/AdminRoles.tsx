import { FormEvent, useEffect, useMemo, useState } from 'react';
import Layout from '../../components/Layout';
import Button from '../../components/Button';
import Modal from '../../components/Modal';
import { AppPage, AppPageHeader } from '../../components/AppPage';
import { useConfirm } from '../../contexts/ConfirmContext';
import api, { formatApiError } from '../../utils/api';

type RoleRule = {
  scope: string;
  effect: 'allow' | 'deny';
};

type Role = {
  id: number;
  code: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  isComputed: boolean;
  isAssignable: boolean;
  rules: RoleRule[];
};

type ScopeRegistryEntry = {
  scope: string;
  description: string;
  category: string;
};

type RuleDraftRow = {
  id: string;
  scope: string;
  effect: 'allow' | 'deny';
  useCustomInput: boolean;
};

const CUSTOM_SENTINEL = '__custom__';
const INTERNAL_SCOPES = new Set(['member.active', 'member.ice_privileges']);

function normalizeScope(scope: string): string {
  return scope.trim().toLowerCase();
}

function isInternalScope(scope: string): boolean {
  return INTERNAL_SCOPES.has(normalizeScope(scope));
}

function newDraftRow(): RuleDraftRow {
  return {
    id: crypto.randomUUID(),
    scope: '',
    effect: 'allow',
    useCustomInput: false,
  };
}

function rulesToDraftRows(rules: RoleRule[], documentedScopes: Set<string>): RuleDraftRow[] {
  return rules.map((rule) => ({
    id: crypto.randomUUID(),
    scope: rule.scope,
    effect: rule.effect,
    useCustomInput: !documentedScopes.has(rule.scope),
  }));
}

function dedupeRoleRules(rows: RoleRule[]): RoleRule[] {
  const map = new Map<string, RoleRule>();
  for (const row of rows) {
    const scope = normalizeScope(row.scope);
    if (!scope) continue;
    map.set(scope, { scope, effect: row.effect });
  }
  return Array.from(map.values());
}

function ScopePill({
  rule,
  doc,
}: {
  rule: RoleRule;
  doc?: ScopeRegistryEntry;
}) {
  const isDeny = rule.effect === 'deny';
  return (
    <div className="group relative">
      <button
        type="button"
        className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
          isDeny
            ? 'border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-500/60 dark:bg-rose-900/20 dark:text-rose-200'
            : 'border-teal-300 bg-teal-50 text-teal-800 dark:border-teal-500/60 dark:bg-teal-900/20 dark:text-teal-200'
        }`}
      >
        <span
          className={`h-1.5 w-1.5 rounded-full ${isDeny ? 'bg-rose-500' : 'bg-teal-500'}`}
          aria-hidden="true"
        />
        {rule.scope}
      </button>
      <div className="pointer-events-none invisible absolute left-1/2 top-full z-20 mt-2 w-80 -translate-x-1/2 rounded-xl border border-gray-200 bg-white/95 p-3 text-left text-xs text-gray-700 opacity-0 shadow-xl backdrop-blur-sm transition-all duration-150 group-hover:visible group-hover:opacity-100 dark:border-gray-700 dark:bg-gray-900/95 dark:text-gray-200 dark:shadow-black/30">
        <div className="flex items-center justify-between gap-2">
          <code className="font-semibold text-gray-900 dark:text-gray-100">{rule.scope}</code>
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
              isDeny
                ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-200'
                : 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-200'
            }`}
          >
            {rule.effect}
          </span>
        </div>
        <p className="mt-2 leading-relaxed">
          {doc?.description ?? 'Custom scope. No documentation entry has been registered yet.'}
        </p>
        {doc?.category && (
          <div className="mt-2 text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
            {doc.category}
          </div>
        )}
      </div>
    </div>
  );
}

export default function AdminRoles() {
  const { confirm } = useConfirm();
  const [roles, setRoles] = useState<Role[]>([]);
  const [scopeRegistry, setScopeRegistry] = useState<ScopeRegistryEntry[]>([]);
  const [newRoleName, setNewRoleName] = useState('');
  const [newRoleDescription, setNewRoleDescription] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editRules, setEditRules] = useState<RuleDraftRow[]>([]);

  const visibleScopeRegistry = useMemo(
    () => scopeRegistry.filter((entry) => !isInternalScope(entry.scope)),
    [scopeRegistry]
  );

  const documentedScopeSet = useMemo(
    () => new Set(visibleScopeRegistry.map((entry) => entry.scope)),
    [visibleScopeRegistry]
  );

  const scopeByKey = useMemo(() => {
    const map = new Map<string, ScopeRegistryEntry>();
    for (const entry of visibleScopeRegistry) map.set(entry.scope, entry);
    return map;
  }, [visibleScopeRegistry]);

  const registryByCategory = useMemo(() => {
    const groups = new Map<string, ScopeRegistryEntry[]>();
    for (const entry of visibleScopeRegistry) {
      const list = groups.get(entry.category) ?? [];
      list.push(entry);
      groups.set(entry.category, list);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [visibleScopeRegistry]);

  useEffect(() => {
    void loadInitialData();
  }, []);

  const loadInitialData = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const [rolesResponse, registryResponse] = await Promise.all([
        api.get<Role[]>('/rbac/roles'),
        api.get<{ scopes: ScopeRegistryEntry[] }>('/rbac/scope-registry'),
      ]);
      setRoles(rolesResponse.data);
      setScopeRegistry(registryResponse.data.scopes);
    } catch (error: unknown) {
      setMessage({ type: 'error', text: formatApiError(error, 'Failed to load role data') });
    } finally {
      setLoading(false);
    }
  };

  const openEditDialog = (role: Role) => {
    setEditingRole(role);
    setEditName(role.name);
    setEditDescription(role.description ?? '');
    const visibleRules = role.rules.filter((rule) => !isInternalScope(rule.scope));
    setEditRules(rulesToDraftRows(visibleRules, documentedScopeSet));
  };

  const closeEditDialog = () => {
    setEditingRole(null);
    setEditName('');
    setEditDescription('');
    setEditRules([]);
  };

  const updateDraftRow = (id: string, patch: Partial<RuleDraftRow>) => {
    setEditRules((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  };

  const removeDraftRow = (id: string) => {
    setEditRules((current) => current.filter((row) => row.id !== id));
  };

  const addDraftRow = () => {
    setEditRules((current) => [...current, newDraftRow()]);
  };

  const handleCreateRole = async (event: FormEvent) => {
    event.preventDefault();
    if (!newRoleName.trim()) return;
    setSaving(true);
    setMessage(null);
    try {
      await api.post('/rbac/roles', {
        name: newRoleName.trim(),
        description: newRoleDescription.trim() || null,
      });
      setNewRoleName('');
      setNewRoleDescription('');
      await loadInitialData();
      setMessage({ type: 'success', text: 'Role created.' });
    } catch (error: unknown) {
      setMessage({ type: 'error', text: formatApiError(error, 'Failed to create role') });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveRole = async () => {
    if (!editingRole) return;
    if (editRules.some((row) => row.scope.trim() === '')) {
      setMessage({ type: 'error', text: 'Each rule row must include a scope.' });
      return;
    }
    if (editRules.some((row) => isInternalScope(row.scope))) {
      setMessage({ type: 'error', text: 'Internal computed scopes cannot be assigned manually.' });
      return;
    }

    const visibleRules: RoleRule[] = editRules.map((row) => ({
      scope: row.scope.trim(),
      effect: row.effect,
    }));
    const hiddenRules = editingRole.rules.filter((rule) => isInternalScope(rule.scope));
    const rules = dedupeRoleRules([...visibleRules, ...hiddenRules]);
    setSaving(true);
    setMessage(null);
    try {
      await api.put(`/rbac/roles/${editingRole.id}`, {
        name: editName.trim() || editingRole.name,
        description: editDescription.trim() || null,
      });
      await api.put(`/rbac/roles/${editingRole.id}/rules`, { rules });
      await loadInitialData();
      closeEditDialog();
      setMessage({ type: 'success', text: 'Role updated.' });
    } catch (error: unknown) {
      setMessage({ type: 'error', text: formatApiError(error, 'Failed to save role') });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteRole = async () => {
    if (!editingRole) return;
    if (editingRole.isSystem) {
      setMessage({ type: 'error', text: 'System roles cannot be deleted.' });
      return;
    }
    const confirmed = await confirm({
      title: 'Delete role',
      message: `Delete role "${editingRole.name}"? This action cannot be undone.`,
      confirmText: 'Delete role',
      cancelText: 'Keep role',
      variant: 'danger',
    });
    if (!confirmed) return;

    setSaving(true);
    setMessage(null);
    try {
      await api.delete(`/rbac/roles/${editingRole.id}`);
      await loadInitialData();
      closeEditDialog();
      setMessage({ type: 'success', text: 'Role deleted.' });
    } catch (error: unknown) {
      setMessage({ type: 'error', text: formatApiError(error, 'Failed to delete role') });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Layout>
        <AppPage>
          <div className="app-card text-center py-10 text-gray-500 dark:text-gray-400">Loading roles...</div>
        </AppPage>
      </Layout>
    );
  }

  return (
    <Layout>
      <AppPage>
        <AppPageHeader
          title="Role management"
          description={
            <>
              Browse every role and its scope footprint in one list. Hover any scope chip for documentation. Scope
              metadata is also available via{' '}
              <code className="rounded bg-gray-100 px-1 py-0.5 text-xs dark:bg-gray-800">
                GET /api/rbac/scope-registry
              </code>
              .
            </>
          }
        />

        {message && (
          <div className={message.type === 'success' ? 'app-alert-success' : 'app-alert-error'}>
            {message.text}
          </div>
        )}

        <form
          onSubmit={handleCreateRole}
          className="app-card grid gap-3 border-dashed md:grid-cols-[1.4fr_2fr_auto]"
        >
          <input
            type="text"
            value={newRoleName}
            onChange={(event) => setNewRoleName(event.target.value)}
            placeholder="New role name"
            className="app-input"
            required
          />
          <input
            type="text"
            value={newRoleDescription}
            onChange={(event) => setNewRoleDescription(event.target.value)}
            placeholder="Description (optional)"
            className="app-input"
          />
          <Button type="submit" disabled={saving}>
            Create role
          </Button>
        </form>

        <section className="app-card space-y-0 p-0">
          {roles.length === 0 ? (
            <div className="px-6 py-10 text-center text-gray-500 dark:text-gray-400">No roles found.</div>
          ) : (
            roles.map((role, index) => {
              const visibleRules = role.rules.filter((rule) => !isInternalScope(rule.scope));
              const hiddenRuleCount = role.rules.length - visibleRules.length;
              return (
                <article
                  key={role.id}
                  className={`px-5 py-5 ${index < roles.length - 1 ? 'border-b border-gray-100 dark:border-gray-700/60' : ''}`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="app-section-title">{role.name}</h2>
                        {role.isComputed && (
                          <span className="rounded-full bg-indigo-100 px-2.5 py-0.5 text-xs font-medium text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-200">
                            Computed
                          </span>
                        )}
                        {role.isSystem && (
                          <span className="rounded-full bg-gray-200 px-2.5 py-0.5 text-xs font-medium text-gray-700 dark:bg-gray-700 dark:text-gray-200">
                            System
                          </span>
                        )}
                        {role.isAssignable && (
                          <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200">
                            Assignable
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-gray-600 dark:text-gray-300">
                        {role.description?.trim() || 'No description provided yet.'}
                      </p>
                    </div>
                    <Button type="button" variant="secondary" onClick={() => openEditDialog(role)}>
                      Edit
                    </Button>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    {visibleRules.length > 0 ? (
                      visibleRules.map((rule) => (
                        <ScopePill
                          key={`${role.id}-${rule.scope}-${rule.effect}`}
                          rule={rule}
                          doc={scopeByKey.get(rule.scope)}
                        />
                      ))
                    ) : (
                      <span className="rounded-lg border border-dashed border-gray-300 px-3 py-1.5 text-xs text-gray-500 dark:border-gray-600 dark:text-gray-400">
                        No explicit scope rules.
                      </span>
                    )}
                  </div>
                  {hiddenRuleCount > 0 && (
                    <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                      {hiddenRuleCount} internal computed {hiddenRuleCount === 1 ? 'rule is' : 'rules are'} hidden from this UI.
                    </p>
                  )}
                </article>
              );
            })
          )}
        </section>
      </AppPage>

      <Modal
        isOpen={Boolean(editingRole)}
        onClose={closeEditDialog}
        title={editingRole ? `Edit role — ${editingRole.name}` : 'Edit role'}
        size="xl"
      >
        {!editingRole ? null : (
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <label className="app-label">Role name</label>
                <input
                  type="text"
                  value={editName}
                  onChange={(event) => setEditName(event.target.value)}
                  className="app-input"
                />
              </div>
              <div>
                <label className="app-label">Description</label>
                <input
                  type="text"
                  value={editDescription}
                  onChange={(event) => setEditDescription(event.target.value)}
                  className="app-input"
                  placeholder="Optional"
                />
              </div>
            </div>

            <div className="rounded-xl border border-gray-200 bg-gray-50/80 p-3 dark:border-gray-700 dark:bg-gray-900/30">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="app-section-title">Scope rules</h3>
                <Button type="button" variant="secondary" onClick={addDraftRow} disabled={saving}>
                  Add scope
                </Button>
              </div>
              <p className="mb-3 text-xs text-gray-600 dark:text-gray-400">
                Choose allow/deny, then pick a documented scope or enter a custom one.
              </p>

              <div className="max-h-[360px] space-y-3 overflow-y-auto pr-1">
                {editRules.map((row) => {
                  const doc = scopeByKey.get(row.scope);
                  const selectValue =
                    row.useCustomInput || (row.scope && !documentedScopeSet.has(row.scope))
                      ? CUSTOM_SENTINEL
                      : row.scope || '';

                  return (
                    <div
                      key={row.id}
                      className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm dark:border-gray-700 dark:bg-gray-800"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <select
                          value={row.effect}
                          onChange={(event) =>
                            updateDraftRow(row.id, { effect: event.target.value as 'allow' | 'deny' })
                          }
                          className="app-input min-w-[6rem] px-2 py-1.5"
                        >
                          <option value="allow">Allow</option>
                          <option value="deny">Deny</option>
                        </select>

                        {row.useCustomInput || selectValue === CUSTOM_SENTINEL ? (
                          <input
                            type="text"
                            value={row.scope}
                            onChange={(event) => updateDraftRow(row.id, { scope: event.target.value })}
                            placeholder="e.g. leagues.manage or leagues.*"
                            className="app-input min-w-[14rem] flex-1 px-2 py-1.5"
                          />
                        ) : (
                          <select
                            value={selectValue}
                            onChange={(event) => {
                              const value = event.target.value;
                              if (value === CUSTOM_SENTINEL) {
                                updateDraftRow(row.id, { useCustomInput: true, scope: '' });
                              } else {
                                updateDraftRow(row.id, { useCustomInput: false, scope: value });
                              }
                            }}
                            className="app-input min-w-[14rem] flex-1 px-2 py-1.5"
                          >
                            <option value="">Select scope…</option>
                            {registryByCategory.map(([category, entries]) => (
                              <optgroup key={category} label={category}>
                                {entries.map((entry) => (
                                  <option key={entry.scope} value={entry.scope}>
                                    {entry.scope}
                                  </option>
                                ))}
                              </optgroup>
                            ))}
                            <option value={CUSTOM_SENTINEL}>Custom scope…</option>
                          </select>
                        )}

                        <Button type="button" variant="danger" onClick={() => removeDraftRow(row.id)}>
                          Remove
                        </Button>
                      </div>

                      {row.useCustomInput ? (
                        <button
                          type="button"
                          className="mt-2 text-xs text-blue-600 hover:underline dark:text-blue-400"
                          onClick={() => updateDraftRow(row.id, { useCustomInput: false, scope: '' })}
                        >
                          Use documented scope picker
                        </button>
                      ) : doc ? (
                        <p className="mt-2 rounded-md bg-sky-50 px-2 py-1 text-xs text-sky-800 dark:bg-sky-900/20 dark:text-sky-200">
                          {doc.description}
                        </p>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-wrap justify-end gap-2 border-t border-gray-200 pt-3 dark:border-gray-700">
              <Button type="button" variant="secondary" onClick={closeEditDialog} disabled={saving}>
                Cancel
              </Button>
              {!editingRole.isSystem && (
                <Button type="button" variant="danger" onClick={handleDeleteRole} disabled={saving}>
                  Delete role
                </Button>
              )}
              <Button type="button" onClick={handleSaveRole} disabled={saving}>
                {saving ? 'Saving…' : 'Save changes'}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </Layout>
  );
}
