import { Fragment, useCallback, useEffect, useId, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AppPage, AppPageHeader } from '../../components/AppPage';
import AppStateCard from '../../components/AppStateCard';
import BackButton from '../../components/BackButton';
import Button from '../../components/Button';
import ChoiceInput, { type ChoiceOption } from '../../components/ChoiceInput';
import FormField from '../../components/FormField';
import FormSection from '../../components/FormSection';
import InlineStateMessage from '../../components/InlineStateMessage';
import MemberMultiSelect from '../../components/MemberMultiSelect';
import PageTabs from '../../components/PageTabs';
import { useAlert } from '../../contexts/AlertContext';
import { useAuth } from '../../contexts/AuthContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import api, { formatApiError } from '../../utils/api';
import { memberHasScope } from '../../utils/permissions';
import {
  addMinutesToDateTimeLocal,
  formatDurationMinutes,
  formatVolunteerRange,
  fromDateTimeLocal,
  hoursInputToMinutes,
  minutesToHoursInput,
  toDateTimeLocal,
  type VolunteerProgramView,
  type VolunteerRoleView,
  type VolunteerShiftView,
} from '../../utils/volunteering';

type TabKey = 'settings' | 'roles' | 'shifts' | 'signups';
const secondaryTabs = ['roles', 'shifts', 'signups'] as const;

type DraftShiftRole = { roleId: number; volunteersNeeded: number };

type NewShiftTimeRow = {
  key: string;
  startLocal: string;
  endLocal: string;
  endManuallyEdited: boolean;
};

function createEmptyTimeRow(
  programStartDate?: string | null,
  defaultDurationMinutes?: number | null
): NewShiftTimeRow {
  const startLocal = programStartDate ? `${programStartDate}T09:00` : '';
  const endLocal =
    startLocal && defaultDurationMinutes
      ? addMinutesToDateTimeLocal(startLocal, defaultDurationMinutes)
      : '';
  return {
    key: `shift-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    startLocal,
    endLocal,
    endManuallyEdited: false,
  };
}

export default function AdminVolunteerProgramEditor() {
  const { id, tab } = useParams<{ id: string; tab?: string }>();
  const isNew = id === 'new';
  const navigate = useNavigate();
  const { member } = useAuth();
  const { showAlert } = useAlert();
  const { confirm } = useConfirm();
  const baseId = useId();
  const canCreate =
    memberHasScope(member, 'volunteering.manage') || Boolean(member?.isServerAdmin);

  const activeTab: TabKey =
    !isNew && tab && (secondaryTabs as readonly string[]).includes(tab) ? (tab as TabKey) : 'settings';

  const [saving, setSaving] = useState(false);
  const [program, setProgram] = useState<VolunteerProgramView | null>(null);
  const [allCredentials, setAllCredentials] = useState<Array<{ id: number; name: string }>>([]);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [pointOfContact, setPointOfContact] = useState('');
  const [location, setLocation] = useState('');
  const [startDate, setStartDate] = useState('');
  const [managerIds, setManagerIds] = useState<number[]>([]);

  const [roleName, setRoleName] = useState('');
  const [roleDescription, setRoleDescription] = useState('');
  const [roleDurationHours, setRoleDurationHours] = useState('3');
  const [roleCredentialIds, setRoleCredentialIds] = useState<number[]>([]);
  const [editingRoleId, setEditingRoleId] = useState<number | null>(null);

  const [newShiftRoleId, setNewShiftRoleId] = useState<number | null>(null);
  const [newShiftTimes, setNewShiftTimes] = useState<NewShiftTimeRow[]>([createEmptyTimeRow()]);
  const [newShiftNeeded, setNewShiftNeeded] = useState(1);
  const [savingShift, setSavingShift] = useState(false);

  const loadProgram = useCallback(async () => {
    if (isNew || !id) return;
    try {
      const res = await api.get(`/volunteering/admin/programs/${id}`);
      const data = res.data as VolunteerProgramView;
      setProgram(data);
      setTitle(data.title);
      setDescription(data.description || '');
      setPointOfContact(data.pointOfContact);
      setLocation(data.location || '');
      setStartDate(data.startDate || '');
      setManagerIds(data.managers.map((m) => m.id));
      setNewShiftTimes((prev) => {
        const onlyEmpty =
          prev.length === 1 && !prev[0].startLocal && !prev[0].endLocal;
        if (onlyEmpty && data.startDate) {
          return [
            createEmptyTimeRow(
              data.startDate,
              data.roles[0]?.defaultDurationMinutes || 180
            ),
          ];
        }
        return prev;
      });
      setNewShiftRoleId((prev) => {
        if (prev && data.roles.some((r) => r.id === prev)) return prev;
        return data.roles[0]?.id ?? null;
      });
    } catch (err) {
      showAlert(formatApiError(err, 'Failed to load program'), 'error');
      navigate('/admin/volunteering');
    }
  }, [id, isNew, navigate, showAlert]);

  useEffect(() => {
    if (isNew) {
      setProgram(null);
      return;
    }
    // Drop stale program when switching to a different program id (same mounted route).
    setProgram((prev) => (prev && String(prev.id) === String(id) ? prev : null));
    void loadProgram();
  }, [loadProgram, id, isNew]);

  useEffect(() => {
    if (isNew && !canCreate) {
      showAlert('You do not have permission to create volunteer programs.', 'error');
      navigate('/admin/volunteering');
    }
  }, [isNew, canCreate, navigate, showAlert]);

  useEffect(() => {
    api
      .get('/volunteering/admin/credentials')
      .then((res) => {
        const list = (res.data?.credentials || []) as Array<{ id: number; name: string }>;
        setAllCredentials(list.map((c) => ({ id: c.id, name: c.name })));
      })
      .catch(() => {
        // Ignore 403 for program-only managers.
      });
  }, []);

  const selectedRoleForShift = useMemo(
    () => program?.roles.find((r) => r.id === newShiftRoleId) ?? null,
    [program, newShiftRoleId]
  );

  const updateTimeRowEndFromRole = useCallback(
    (rowKey: string, startLocal: string, role: VolunteerRoleView | null | undefined) => {
      if (!startLocal || !role) return;
      const endLocal = addMinutesToDateTimeLocal(startLocal, role.defaultDurationMinutes || 180);
      setNewShiftTimes((prev) =>
        prev.map((row) =>
          row.key === rowKey ? { ...row, startLocal, endLocal, endManuallyEdited: false } : row
        )
      );
    },
    []
  );

  useEffect(() => {
    if (!selectedRoleForShift) return;
    setNewShiftTimes((prev) =>
      prev.map((row) => {
        if (row.endManuallyEdited || !row.startLocal) return row;
        return {
          ...row,
          endLocal: addMinutesToDateTimeLocal(
            row.startLocal,
            selectedRoleForShift.defaultDurationMinutes || 180
          ),
        };
      })
    );
  }, [selectedRoleForShift]);

  const credentialOptions: ChoiceOption<number>[] = useMemo(
    () => allCredentials.map((c) => ({ value: c.id, label: c.name })),
    [allCredentials]
  );

  const roleOptions: ChoiceOption<number>[] = useMemo(
    () => (program?.roles || []).map((r) => ({ value: r.id, label: r.name })),
    [program]
  );

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        title: title.trim(),
        description: description.trim() || null,
        pointOfContact: pointOfContact.trim(),
        location: location.trim() || null,
        startDate: startDate.trim() || null,
        managerIds,
      };
      if (isNew) {
        const res = await api.post('/volunteering/admin/programs', payload);
        showAlert('Program created', 'success');
        navigate(`/admin/volunteering/${res.data.id}/roles`);
      } else {
        await api.patch(`/volunteering/admin/programs/${id}`, payload);
        showAlert('Program saved', 'success');
        await loadProgram();
      }
    } catch (err) {
      showAlert(formatApiError(err, 'Failed to save program'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const resetRoleForm = () => {
    setEditingRoleId(null);
    setRoleName('');
    setRoleDescription('');
    setRoleDurationHours('3');
    setRoleCredentialIds([]);
  };

  const startEditRole = (role: VolunteerRoleView) => {
    setEditingRoleId(role.id);
    setRoleName(role.name);
    setRoleDescription(role.description || '');
    setRoleDurationHours(minutesToHoursInput(role.defaultDurationMinutes || 180));
    setRoleCredentialIds(role.requiredCredentials.map((c) => c.id));
  };

  const handleSaveRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id || isNew) return;
    const minutes = hoursInputToMinutes(roleDurationHours);
    if (minutes == null) {
      showAlert('Enter a valid default duration in hours (for example 3 or 2.5).', 'warning');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: roleName.trim(),
        description: roleDescription.trim() || null,
        defaultDurationMinutes: minutes,
        requiredCredentialIds: roleCredentialIds,
      };
      if (editingRoleId) {
        await api.patch(`/volunteering/admin/roles/${editingRoleId}`, payload);
        showAlert('Role updated', 'success');
      } else {
        await api.post(`/volunteering/admin/programs/${id}/roles`, payload);
        showAlert('Role created', 'success');
      }
      resetRoleForm();
      await loadProgram();
    } catch (err) {
      showAlert(formatApiError(err, 'Failed to save role'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteRole = async (role: VolunteerRoleView) => {
    const ok = await confirm({
      title: 'Delete role',
      message: `Delete role "${role.name}"? Shifts using this role will lose that assignment.`,
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await api.delete(`/volunteering/admin/roles/${role.id}`);
      showAlert('Role deleted', 'success');
      if (editingRoleId === role.id) resetRoleForm();
      await loadProgram();
    } catch (err) {
      showAlert(formatApiError(err, 'Failed to delete role'), 'error');
    }
  };

  const resetNewShiftForm = () => {
    setNewShiftTimes([
      createEmptyTimeRow(
        program?.startDate,
        selectedRoleForShift?.defaultDurationMinutes ||
          (program?.startDate ? 180 : null)
      ),
    ]);
    setNewShiftNeeded(1);
  };

  const addAdditionalShiftTime = () => {
    setNewShiftTimes((prev) => {
      const last = prev[prev.length - 1];
      if (last?.endLocal) {
        const startLocal = last.endLocal;
        const durationMinutes =
          selectedRoleForShift?.defaultDurationMinutes || 180;
        return [
          ...prev,
          {
            key: `shift-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            startLocal,
            endLocal: addMinutesToDateTimeLocal(startLocal, durationMinutes),
            endManuallyEdited: false,
          },
        ];
      }
      return [
        ...prev,
        createEmptyTimeRow(
          program?.startDate,
          selectedRoleForShift?.defaultDurationMinutes ||
            (program?.startDate ? 180 : null)
        ),
      ];
    });
  };

  const handleCreateShift = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id || isNew || !newShiftRoleId) return;
    const incomplete = newShiftTimes.some((row) => !row.startLocal || !row.endLocal);
    if (incomplete) {
      showAlert('Choose a start and end time for every shift.', 'warning');
      return;
    }
    setSavingShift(true);
    try {
      await api.post(`/volunteering/admin/programs/${id}/shifts/bulk`, {
        shifts: newShiftTimes.map((row) => ({
          startDt: fromDateTimeLocal(row.startLocal),
          endDt: fromDateTimeLocal(row.endLocal),
          roles: [{ roleId: newShiftRoleId, volunteersNeeded: newShiftNeeded }],
        })),
      });
      const count = newShiftTimes.length;
      showAlert(
        count === 1 ? 'Shift created' : `${count} shifts created`,
        'success'
      );
      resetNewShiftForm();
      await loadProgram();
    } catch (err) {
      showAlert(formatApiError(err, 'Failed to create shifts'), 'error');
    } finally {
      setSavingShift(false);
    }
  };

  const handleUpdateExistingShift = async (
    shift: VolunteerShiftView,
    patch: { startLocal: string; endLocal: string; roles: DraftShiftRole[] }
  ) => {
    try {
      await api.patch(`/volunteering/admin/shifts/${shift.id}`, {
        startDt: fromDateTimeLocal(patch.startLocal),
        endDt: fromDateTimeLocal(patch.endLocal),
        roles: patch.roles,
      });
      showAlert('Shift updated', 'success');
      await loadProgram();
    } catch (err) {
      showAlert(formatApiError(err, 'Failed to update shift'), 'error');
    }
  };

  const handleDeleteShift = async (shift: VolunteerShiftView) => {
    const ok = await confirm({
      title: 'Delete shift',
      message: `Delete the shift on ${formatVolunteerRange(shift.startDt, shift.endDt)}? Signups for this shift will be removed.`,
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await api.delete(`/volunteering/admin/shifts/${shift.id}`);
      showAlert('Shift deleted', 'success');
      await loadProgram();
    } catch (err) {
      showAlert(formatApiError(err, 'Failed to delete shift'), 'error');
    }
  };

  const handleRemoveSignup = async (signupId: number, memberName: string) => {
    const ok = await confirm({
      title: 'Remove volunteer',
      message: `Remove ${memberName} from this shift?`,
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await api.delete(`/volunteering/admin/signups/${signupId}`);
      showAlert('Volunteer removed', 'success');
      await loadProgram();
    } catch (err) {
      showAlert(formatApiError(err, 'Failed to remove volunteer'), 'error');
    }
  };

  const tabItems = [
    {
      key: 'settings',
      label: 'Settings',
      isActive: activeTab === 'settings',
      to: isNew ? '/admin/volunteering/new' : `/admin/volunteering/${id}`,
    },
    ...(!isNew
      ? [
          {
            key: 'roles',
            label: 'Roles',
            isActive: activeTab === 'roles',
            to: `/admin/volunteering/${id}/roles`,
          },
          {
            key: 'shifts',
            label: 'Shifts',
            isActive: activeTab === 'shifts',
            to: `/admin/volunteering/${id}/shifts`,
          },
          {
            key: 'signups',
            label: 'Signups',
            isActive: activeTab === 'signups',
            to: `/admin/volunteering/${id}/signups`,
          },
        ]
      : []),
  ];

  if (!isNew && !program) {
    return (
      <AppPage>
        <AppPageHeader
          title="Edit program"
          actions={<BackButton label="Back to programs" to="/admin/volunteering" />}
        />
        <AppStateCard title="Loading program..." />
      </AppPage>
    );
  }

  const shiftsByDate = (program?.shifts || []).reduce<Record<string, VolunteerShiftView[]>>((acc, shift) => {
    const key = shift.startDt.slice(0, 10);
    (acc[key] ||= []).push(shift);
    return acc;
  }, {});

  return (
    <AppPage>
      <AppPageHeader
        title={isNew ? 'Create volunteer program' : program?.title || 'Edit program'}
        description={isNew ? 'Add a program, then define roles and shifts.' : undefined}
        actions={<BackButton label="Back to programs" to="/admin/volunteering" />}
      />
      <PageTabs items={tabItems} />

      {activeTab === 'settings' ? (
        <form onSubmit={handleSaveSettings} className="space-y-6 max-w-3xl">
          <FormSection title="Program details" surface="panel">
            <FormField label="Title" htmlFor={`${baseId}-title`} required>
              <input
                id={`${baseId}-title`}
                className="app-input"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
              />
            </FormField>
            <FormField label="Description" htmlFor={`${baseId}-description`}>
              <textarea
                id={`${baseId}-description`}
                className="app-input min-h-[120px]"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </FormField>
            <FormField label="Point of contact" htmlFor={`${baseId}-poc`} required>
              <input
                id={`${baseId}-poc`}
                className="app-input"
                value={pointOfContact}
                onChange={(e) => setPointOfContact(e.target.value)}
                required
              />
            </FormField>
            <FormField label="Location" htmlFor={`${baseId}-location`}>
              <input
                id={`${baseId}-location`}
                className="app-input"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
              />
            </FormField>
            <FormField
              label="Start date"
              htmlFor={`${baseId}-start-date`}
              optional
            >
              <input
                id={`${baseId}-start-date`}
                type="date"
                className="app-input w-full max-w-xs"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </FormField>
            <FormField label="Managers" htmlFor={`${baseId}-managers`}>
              <MemberMultiSelect
                selectedIds={managerIds}
                onChange={setManagerIds}
                placeholder="Search members to add as managers..."
              />
            </FormField>
          </FormSection>
          <div className="flex gap-3">
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving…' : isNew ? 'Create program' : 'Save settings'}
            </Button>
          </div>
        </form>
      ) : null}

      {activeTab === 'roles' && program ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <form onSubmit={handleSaveRole} className="space-y-4">
            <FormSection title={editingRoleId ? 'Edit role' : 'Add role'} surface="panel">
              <FormField label="Name" htmlFor={`${baseId}-role-name`} required>
                <input
                  id={`${baseId}-role-name`}
                  className="app-input"
                  value={roleName}
                  onChange={(e) => setRoleName(e.target.value)}
                  required
                />
              </FormField>
              <FormField label="Description" htmlFor={`${baseId}-role-desc`}>
                <textarea
                  id={`${baseId}-role-desc`}
                  className="app-input min-h-[140px]"
                  value={roleDescription}
                  onChange={(e) => setRoleDescription(e.target.value)}
                />
              </FormField>
              <FormField
                label="Default duration (hours)"
                htmlFor={`${baseId}-role-duration`}
                required
                helperText="Used to auto-fill shift end time when this role is selected."
              >
                <input
                  id={`${baseId}-role-duration`}
                  type="number"
                  min={0.25}
                  step={0.25}
                  className="app-input"
                  value={roleDurationHours}
                  onChange={(e) => setRoleDurationHours(e.target.value)}
                  required
                />
              </FormField>
              <FormField label="Required credentials" htmlFor={`${baseId}-role-creds`}>
                {credentialOptions.length === 0 ? (
                  <InlineStateMessage
                    title="No credentials defined yet."
                    description={
                      <Link to="/admin/volunteering/credentials" className="text-primary-teal hover:underline">
                        Manage credentials
                      </Link>
                    }
                  />
                ) : (
                  <ChoiceInput<number>
                    inputId={`${baseId}-role-creds`}
                    maxSelectedItems={null}
                    layout="block"
                    options={credentialOptions}
                    value={roleCredentialIds}
                    onChange={(next) =>
                      setRoleCredentialIds(Array.isArray(next) ? next : next == null ? [] : [next])
                    }
                    placeholder="Select credentials..."
                  />
                )}
              </FormField>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={saving}>
                  {saving ? 'Saving…' : editingRoleId ? 'Update role' : 'Add role'}
                </Button>
                {editingRoleId ? (
                  <Button type="button" variant="secondary" onClick={resetRoleForm}>
                    Cancel edit
                  </Button>
                ) : null}
              </div>
            </FormSection>
          </form>

          <div className="space-y-3">
            <h2 className="app-section-title">Roles ({program.roles.length})</h2>
            {program.roles.length === 0 ? (
              <InlineStateMessage title="No roles yet. Add the jobs volunteers can fill." />
            ) : (
              program.roles.map((role) => (
                <div key={role.id} className="app-card p-4 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-medium text-gray-900 dark:text-gray-100">{role.name}</div>
                      {role.description ? (
                        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400 whitespace-pre-wrap">
                          {role.description}
                        </p>
                      ) : null}
                      <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                        Default duration: {formatDurationMinutes(role.defaultDurationMinutes || 180)}
                      </p>
                      {role.requiredCredentials.length > 0 ? (
                        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                          Credentials: {role.requiredCredentials.map((c) => c.name).join(', ')}
                        </p>
                      ) : (
                        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">No credentials required</p>
                      )}
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <Button type="button" variant="secondary" onClick={() => startEditRole(role)}>
                        Edit
                      </Button>
                      <Button type="button" variant="secondary" onClick={() => handleDeleteRole(role)}>
                        Delete
                      </Button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}

      {activeTab === 'shifts' && program ? (
        <div className="space-y-8">
          {program.roles.length === 0 ? (
            <AppStateCard
              title="Add roles first"
              description="Create at least one role before adding shifts."
              action={
                <Link to={`/admin/volunteering/${id}/roles`}>
                  <Button type="button">Go to roles</Button>
                </Link>
              }
            />
          ) : (
            <>
              <form onSubmit={handleCreateShift} className="max-w-3xl">
                <FormSection
                  title="Add shift"
                  surface="panel"
                  description="A shift specifies a time period for volunteers to work."
                >
                  <FormField label="Role" htmlFor={`${baseId}-shift-role`} required>
                    <ChoiceInput<number>
                      inputId={`${baseId}-shift-role`}
                      options={roleOptions}
                      value={newShiftRoleId}
                      onChange={(next) => {
                        setNewShiftRoleId(Array.isArray(next) ? next[0] ?? null : next);
                      }}
                      placeholder="Select a role..."
                    />
                  </FormField>
                  {selectedRoleForShift ? (
                    <p className="text-sm text-gray-600 dark:text-gray-400 -mt-2 mb-3">
                      Default duration for this role:{' '}
                      {formatDurationMinutes(selectedRoleForShift.defaultDurationMinutes || 180)}
                    </p>
                  ) : null}

                  <div className="space-y-4">
                    {newShiftTimes.map((row) => (
                      <div
                        key={row.key}
                        className={
                          newShiftTimes.length > 1
                            ? 'grid gap-4 md:grid-cols-[1fr_1fr_auto] md:items-start'
                            : 'grid gap-4 md:grid-cols-2'
                        }
                      >
                        <FormField
                          label="Start"
                          htmlFor={`${baseId}-shift-start-${row.key}`}
                          required
                        >
                          <input
                            id={`${baseId}-shift-start-${row.key}`}
                            type="datetime-local"
                            className="app-input"
                            value={row.startLocal}
                            onChange={(e) => {
                              const start = e.target.value;
                              if (!row.endManuallyEdited && selectedRoleForShift) {
                                updateTimeRowEndFromRole(row.key, start, selectedRoleForShift);
                              } else {
                                setNewShiftTimes((prev) =>
                                  prev.map((r) =>
                                    r.key === row.key ? { ...r, startLocal: start } : r
                                  )
                                );
                              }
                            }}
                            required
                          />
                        </FormField>
                        <FormField
                          label="End"
                          htmlFor={`${baseId}-shift-end-${row.key}`}
                          required
                        >
                          <input
                            id={`${baseId}-shift-end-${row.key}`}
                            type="datetime-local"
                            className="app-input"
                            value={row.endLocal}
                            onChange={(e) => {
                              const endLocal = e.target.value;
                              setNewShiftTimes((prev) =>
                                prev.map((r) =>
                                  r.key === row.key
                                    ? { ...r, endLocal, endManuallyEdited: true }
                                    : r
                                )
                              );
                            }}
                            required
                          />
                        </FormField>
                        {newShiftTimes.length > 1 ? (
                          <div className="space-y-1.5">
                            <div
                              className="mb-1 flex min-h-[1.25rem] items-center"
                              aria-hidden="true"
                            >
                              <span className="text-sm font-medium opacity-0 select-none">
                                End
                              </span>
                            </div>
                            <div className="flex min-h-10 items-center">
                              <button
                                type="button"
                                className="text-sm text-primary-teal hover:underline"
                                onClick={() =>
                                  setNewShiftTimes((prev) =>
                                    prev.filter((r) => r.key !== row.key)
                                  )
                                }
                              >
                                Remove
                              </button>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>

                  <div className="pt-1">
                    <button
                      type="button"
                      className="text-sm font-medium text-primary-teal hover:underline"
                      onClick={addAdditionalShiftTime}
                    >
                      Add additional shift
                    </button>
                  </div>

                  <FormField
                    label={
                      newShiftTimes.length > 1
                        ? 'Volunteers needed per shift'
                        : 'Volunteers needed'
                    }
                    htmlFor={`${baseId}-shift-needed`}
                    required
                  >
                    <input
                      id={`${baseId}-shift-needed`}
                      type="number"
                      min={1}
                      className="app-input w-32"
                      value={newShiftNeeded}
                      onChange={(e) => {
                        const n = Number.parseInt(e.target.value, 10);
                        setNewShiftNeeded(Number.isFinite(n) && n > 0 ? n : 1);
                      }}
                      required
                    />
                  </FormField>
                  <div className="flex flex-wrap gap-2">
                    <Button type="submit" disabled={savingShift || !newShiftRoleId}>
                      {savingShift
                        ? 'Saving…'
                        : newShiftTimes.length > 1
                          ? 'Add shifts'
                          : 'Add shift'}
                    </Button>
                  </div>
                </FormSection>
              </form>

              <section className="space-y-4">
                <h2 className="app-section-title">Existing shifts ({program.shifts.length})</h2>
                {program.shifts.length === 0 ? (
                  <InlineStateMessage title="No shifts saved yet." />
                ) : (
                  Object.entries(shiftsByDate)
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([dateKey, shifts]) => (
                      <div key={dateKey} className="space-y-3">
                        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                          {new Date(`${dateKey}T12:00:00`).toLocaleDateString('en-US', {
                            weekday: 'long',
                            month: 'long',
                            day: 'numeric',
                            year: 'numeric',
                          })}
                        </h3>
                        {shifts.map((shift) => (
                          <ExistingShiftEditor
                            key={shift.id}
                            baseId={`${baseId}-shift-${shift.id}`}
                            shift={shift}
                            roles={program.roles}
                            onSave={(patch) => handleUpdateExistingShift(shift, patch)}
                            onDelete={() => handleDeleteShift(shift)}
                          />
                        ))}
                      </div>
                    ))
                )}
              </section>
            </>
          )}
        </div>
      ) : null}

      {activeTab === 'signups' && program ? (
        <div className="space-y-4">
          {program.shifts.length === 0 ? (
            <AppStateCard title="No shifts yet" description="Add shifts before managing signups." />
          ) : (
            program.shifts.map((shift) => (
              <div key={shift.id} className="app-card p-4 space-y-3">
                <div className="font-medium text-gray-900 dark:text-gray-100">
                  {formatVolunteerRange(shift.startDt, shift.endDt)}
                </div>
                {shift.roles.map((role) => (
                  <div key={role.id} className="rounded-md border border-gray-200 dark:border-gray-700 p-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <div className="font-medium">{role.roleName}</div>
                      <div className="text-sm text-gray-600 dark:text-gray-400">
                        {role.volunteersRegistered}/{role.volunteersNeeded}
                      </div>
                    </div>
                    {role.signups.length === 0 ? (
                      <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">No signups</p>
                    ) : (
                      <ul className="mt-2 space-y-2">
                        {role.signups.map((signup) => (
                          <li key={signup.id} className="flex items-start justify-between gap-3 text-sm">
                            <div className="min-w-0 space-y-0.5">
                              <div>{signup.memberName}{!signup.memberId ? ' (non-member)' : ''}</div>
                              {signup.comments ? (
                                <p className="text-gray-600 dark:text-gray-400 whitespace-pre-wrap">
                                  {signup.comments}
                                </p>
                              ) : null}
                            </div>
                            <Button
                              type="button"
                              variant="secondary"
                              onClick={() => handleRemoveSignup(signup.id, signup.memberName)}
                            >
                              Remove
                            </Button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      ) : null}
    </AppPage>
  );
}

function ExistingShiftEditor({
  baseId,
  shift,
  roles,
  onSave,
  onDelete,
}: {
  baseId: string;
  shift: VolunteerShiftView;
  roles: VolunteerRoleView[];
  onSave: (patch: { startLocal: string; endLocal: string; roles: DraftShiftRole[] }) => void;
  onDelete: () => void;
}) {
  const [startLocal, setStartLocal] = useState(toDateTimeLocal(shift.startDt));
  const [endLocal, setEndLocal] = useState(toDateTimeLocal(shift.endDt));
  const [shiftRoles, setShiftRoles] = useState<DraftShiftRole[]>(
    shift.roles.map((r) => ({ roleId: r.roleId, volunteersNeeded: r.volunteersNeeded }))
  );
  const [showAddRole, setShowAddRole] = useState(false);

  useEffect(() => {
    setStartLocal(toDateTimeLocal(shift.startDt));
    setEndLocal(toDateTimeLocal(shift.endDt));
    setShiftRoles(shift.roles.map((r) => ({ roleId: r.roleId, volunteersNeeded: r.volunteersNeeded })));
    setShowAddRole(false);
  }, [shift]);

  const availableRoles = roles.filter((r) => !shiftRoles.some((sr) => sr.roleId === r.id));
  const multiRole = shiftRoles.length > 1;

  const updateNeeded = (roleId: number, raw: string) => {
    const n = Number.parseInt(raw, 10);
    setShiftRoles((prev) =>
      prev.map((r) =>
        r.roleId === roleId
          ? { ...r, volunteersNeeded: Number.isFinite(n) && n > 0 ? n : 1 }
          : r
      )
    );
  };

  return (
    <div className="app-card p-4 space-y-3">
      <div className="grid gap-3 md:grid-cols-2">
        <FormField label="Start" htmlFor={`${baseId}-start`} required>
          <input
            id={`${baseId}-start`}
            type="datetime-local"
            className="app-input"
            value={startLocal}
            onChange={(e) => setStartLocal(e.target.value)}
          />
        </FormField>
        <FormField label="End" htmlFor={`${baseId}-end`} required>
          <input
            id={`${baseId}-end`}
            type="datetime-local"
            className="app-input"
            value={endLocal}
            onChange={(e) => setEndLocal(e.target.value)}
          />
        </FormField>
      </div>

      {!multiRole && shiftRoles[0] ? (
        <FormField
          label="Volunteers needed for this shift"
          htmlFor={`${baseId}-need-${shiftRoles[0].roleId}`}
          required
        >
          <input
            id={`${baseId}-need-${shiftRoles[0].roleId}`}
            type="number"
            min={1}
            className="app-input w-28"
            value={shiftRoles[0].volunteersNeeded}
            onChange={(e) => updateNeeded(shiftRoles[0].roleId, e.target.value)}
            required
          />
        </FormField>
      ) : (
        <div className="inline-grid max-w-full grid-cols-[auto_7rem_auto] items-center gap-x-4 gap-y-2">
          <div className="text-sm font-medium text-gray-700 dark:text-gray-300">Role</div>
          <div className="text-sm font-medium text-gray-700 dark:text-gray-300">Volunteers</div>
          <div />
          {shiftRoles.map((role) => {
            const meta = roles.find((r) => r.id === role.roleId);
            const roleName = meta?.name || `Role ${role.roleId}`;
            const needId = `${baseId}-need-${role.roleId}`;
            return (
              <Fragment key={role.roleId}>
                <div className="min-w-0 font-medium text-gray-900 dark:text-gray-100">
                  {roleName}
                </div>
                <input
                  id={needId}
                  type="number"
                  min={1}
                  className="app-input w-full"
                  value={role.volunteersNeeded}
                  onChange={(e) => updateNeeded(role.roleId, e.target.value)}
                  required
                  aria-label={`Volunteers needed for ${roleName}`}
                />
                <button
                  type="button"
                  className="text-sm text-primary-teal hover:underline"
                  onClick={() =>
                    setShiftRoles((prev) => prev.filter((r) => r.roleId !== role.roleId))
                  }
                >
                  Remove
                </button>
              </Fragment>
            );
          })}
        </div>
      )}

      {availableRoles.length > 0 ? (
        showAddRole ? (
          <FormField label="Role to add" htmlFor={`${baseId}-add-role`}>
            <ChoiceInput<number>
              key={`add-role-${availableRoles.map((r) => r.id).join('-')}`}
              inputId={`${baseId}-add-role`}
              options={availableRoles.map((r) => ({ value: r.id, label: r.name }))}
              value={null}
              onChange={(next) => {
                const roleId = Array.isArray(next) ? next[0] ?? null : next;
                if (!roleId) return;
                setShiftRoles((prev) => [...prev, { roleId, volunteersNeeded: 1 }]);
                if (availableRoles.length <= 1) setShowAddRole(false);
              }}
              placeholder="Select a role..."
            />
          </FormField>
        ) : (
          <button
            type="button"
            className="text-sm font-medium text-primary-teal hover:underline"
            onClick={() => setShowAddRole(true)}
          >
            Add another role
          </button>
        )
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={() => onSave({ startLocal, endLocal, roles: shiftRoles })}>
          Save shift
        </Button>
        <Button type="button" variant="secondary" onClick={onDelete}>
          Delete
        </Button>
      </div>
    </div>
  );
}
