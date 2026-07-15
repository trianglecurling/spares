import { useCallback, useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { HiChevronDown } from 'react-icons/hi2';
import { AppPage, AppPageHeader } from '../components/AppPage';
import AppPageControlsRow from '../components/AppPageControlsRow';
import AppStateCard from '../components/AppStateCard';
import Button from '../components/Button';
import ChoiceInput from '../components/ChoiceInput';
import FormField from '../components/FormField';
import MemberMultiSelect from '../components/MemberMultiSelect';
import Modal from '../components/Modal';
import PageTabs from '../components/PageTabs';
import { get, post, del } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { useAlert } from '../contexts/AlertContext';
import { useConfirm } from '../contexts/ConfirmContext';
import { formatApiError } from '../utils/api';
import {
  formatProgramShiftDateSpan,
  formatVolunteerDayHeading,
  formatVolunteerDuration,
  formatVolunteerRange,
  formatVolunteerTimeRange,
  volunteerShiftDayKey,
  type VolunteerHubCredential,
  type VolunteerProgramView,
  type VolunteerShiftRoleView,
  type VolunteerShiftView,
} from '../utils/volunteering';
import { MyVolunteerShiftsPanel } from './MyVolunteerShifts';

type HubTab = 'programs' | 'shifts' | 'credentials';
type GroupBy = 'shift' | 'role';

type SignupTarget = {
  shiftRoleId: number;
  roleName: string;
  shiftLabel: string;
  remainingSpots: number;
  requiresCredentials: boolean;
  callerIsSignedUp: boolean;
};

function resolveHubTab(tabParam: string | null): HubTab {
  if (tabParam === 'credentials') return 'credentials';
  if (tabParam === 'shifts' || tabParam === 'my-shifts') return 'shifts';
  return 'programs';
}

export default function VolunteeringHub() {
  const { member } = useAuth();
  const { showAlert } = useAlert();
  const { confirm } = useConfirm();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = resolveHubTab(searchParams.get('tab'));

  const [loading, setLoading] = useState(true);
  const [programs, setPrograms] = useState<VolunteerProgramView[]>([]);
  const [credentials, setCredentials] = useState<VolunteerHubCredential[]>([]);
  const [expandedPrograms, setExpandedPrograms] = useState<Set<number>>(new Set());
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());
  const [expandedRoles, setExpandedRoles] = useState<Set<string>>(new Set());
  const [groupBy, setGroupBy] = useState<GroupBy>('role');
  const [busyShiftRoleId, setBusyShiftRoleId] = useState<number | null>(null);
  const [signupTarget, setSignupTarget] = useState<SignupTarget | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = (await get('/volunteering/programs')) as {
        programs: VolunteerProgramView[];
        credentials?: VolunteerHubCredential[];
      };
      setPrograms(data.programs || []);
      setCredentials(data.credentials || []);
    } catch (err) {
      showAlert(formatApiError(err, 'Failed to load volunteering opportunities'), 'error');
    } finally {
      setLoading(false);
    }
  }, [showAlert]);

  useEffect(() => {
    if (activeTab === 'shifts') return;
    void load();
  }, [activeTab, load]);

  const programsWithShifts = useMemo(
    () => programs.filter((p) => p.shifts.some((s) => s.roles.length > 0)),
    [programs]
  );

  const setTab = (tab: HubTab) => {
    const next = new URLSearchParams(searchParams);
    if (tab === 'programs') next.delete('tab');
    else next.set('tab', tab);
    setSearchParams(next, { replace: true });
  };

  const toggleInSet = <T,>(prev: Set<T>, key: T): Set<T> => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  };

  const openSignUp = (role: VolunteerShiftRoleView, shift: VolunteerShiftView) => {
    const remaining = Math.max(0, role.volunteersNeeded - role.volunteersRegistered);
    setSignupTarget({
      shiftRoleId: role.id,
      roleName: role.roleName,
      shiftLabel: formatVolunteerRange(shift.startDt, shift.endDt),
      remainingSpots: remaining,
      requiresCredentials: role.requiredCredentials.length > 0,
      callerIsSignedUp: role.callerIsSignedUp,
    });
  };

  const handleCancel = async (shiftRoleId: number, roleName: string) => {
    const ok = await confirm({
      title: 'Cancel signup',
      message: `Cancel your signup for ${roleName}?`,
      variant: 'danger',
    });
    if (!ok) return;
    setBusyShiftRoleId(shiftRoleId);
    try {
      await del('/volunteering/shift-roles/{id}/signups/me', undefined, { id: String(shiftRoleId) });
      showAlert('Signup cancelled.', 'success');
      await load();
    } catch (err) {
      showAlert(formatApiError(err, 'Failed to cancel signup'), 'error');
    } finally {
      setBusyShiftRoleId(null);
    }
  };

  return (
    <AppPage>
      <AppPageHeader
        title="Volunteering hub"
        description="Discover and sign up for volunteer opportunities at the club."
      />

      <PageTabs
        items={[
          {
            key: 'programs',
            label: 'Discover opportunities',
            isActive: activeTab === 'programs',
            onClick: () => setTab('programs'),
          },
          {
            key: 'shifts',
            label: 'My shifts',
            isActive: activeTab === 'shifts',
            onClick: () => setTab('shifts'),
          },
          {
            key: 'credentials',
            label: 'My credentials',
            isActive: activeTab === 'credentials',
            onClick: () => setTab('credentials'),
          },
        ]}
      />

      {activeTab === 'shifts' ? (
        <MyVolunteerShiftsPanel />
      ) : loading ? (
        <AppStateCard title="Loading opportunities" description="Fetching volunteer programs and shifts." />
      ) : activeTab === 'credentials' ? (
        <CredentialsTab credentials={credentials} />
      ) : (
        <div className="space-y-4">
          {programsWithShifts.length === 0 ? (
            <AppStateCard
              title="No upcoming opportunities"
              description="There are no upcoming volunteer shifts right now. Check back soon."
            />
          ) : (
            <>
              <AppPageControlsRow
                left={
                  <FormField label="Group by" htmlFor="volunteer-group-by" className="mb-0">
                    <ChoiceInput<GroupBy>
                      inputId="volunteer-group-by"
                      listboxLabel="Group by"
                      layout="inline"
                      name="volunteer-group-by"
                      options={[
                        { value: 'role', label: 'Role' },
                        { value: 'shift', label: 'Shift time' },
                      ]}
                      value={groupBy}
                      onChange={(v) => {
                        if (v === 'shift' || v === 'role') setGroupBy(v);
                      }}
                    />
                  </FormField>
                }
              />

              <div className="space-y-3">
                {programsWithShifts.map((program) => {
                  const expanded = expandedPrograms.has(program.id);
                  return (
                    <div key={program.id} className="app-card overflow-hidden p-0">
                      <button
                        type="button"
                        onClick={() => setExpandedPrograms((prev) => toggleInSet(prev, program.id))}
                        className="flex w-full items-start justify-between gap-3 px-5 py-4 text-left hover:bg-gray-50 dark:hover:bg-gray-800/60"
                        aria-expanded={expanded}
                      >
                        <div className="min-w-0 space-y-1">
                          <div className="font-medium text-gray-900 dark:text-gray-100">{program.title}</div>
                          <div className="text-sm text-gray-600 dark:text-gray-400">
                            {formatProgramShiftDateSpan(program.shifts)}
                          </div>
                          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-600 dark:text-gray-400">
                            {program.location ? <span>{program.location}</span> : null}
                            <span>Contact: {program.pointOfContact}</span>
                          </div>
                        </div>
                        <HiChevronDown
                          className={`mt-1 h-5 w-5 shrink-0 text-gray-500 transition-transform ${expanded ? 'rotate-180' : ''}`}
                        />
                      </button>

                      {expanded ? (
                        <div className="border-t border-gray-200 dark:border-gray-700 px-5 py-4 space-y-4">
                          {program.description ? (
                            <p className="text-sm text-gray-600 dark:text-gray-400 whitespace-pre-wrap">
                              {program.description}
                            </p>
                          ) : null}
                          {groupBy === 'shift' ? (
                            <ProgramByShiftView
                              program={program}
                              expandedDays={expandedDays}
                              onToggleDay={(key) => setExpandedDays((prev) => toggleInSet(prev, key))}
                              busyShiftRoleId={busyShiftRoleId}
                              onSignUp={openSignUp}
                              onCancel={handleCancel}
                            />
                          ) : (
                            <ProgramByRoleView
                              program={program}
                              expandedRoles={expandedRoles}
                              onToggleRole={(key) => setExpandedRoles((prev) => toggleInSet(prev, key))}
                              busyShiftRoleId={busyShiftRoleId}
                              onSignUp={openSignUp}
                              onCancel={handleCancel}
                            />
                          )}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {signupTarget && member ? (
        <VolunteerSignupDialog
          target={signupTarget}
          currentMemberId={member.id}
          onClose={() => setSignupTarget(null)}
          onSuccess={async (count) => {
            setSignupTarget(null);
            showAlert(
              count === 1
                ? 'Signed up. Confirmation emails are on the way for selected members.'
                : `${count} volunteers signed up. Confirmation emails are on the way for selected members.`,
              'success'
            );
            await load();
          }}
        />
      ) : null}
    </AppPage>
  );
}

function CredentialsTab({ credentials }: { credentials: VolunteerHubCredential[] }) {
  if (credentials.length === 0) {
    return (
      <AppStateCard
        title="No credentials configured"
        description="The club has not set up any volunteering credentials yet."
      />
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600 dark:text-gray-400">
        Need a credential? Reach out to the point of contact listed.
      </p>
      <ul className="space-y-3">
        {credentials.map((cred) => (
          <li key={cred.id} className="app-card p-4 space-y-2">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="font-medium text-gray-900 dark:text-gray-100">{cred.name}</div>
              <span
                className={
                  cred.held
                    ? 'inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200'
                    : 'inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700 dark:bg-gray-700 dark:text-gray-200'
                }
              >
                {cred.held ? 'You have this' : 'Not held'}
              </span>
            </div>
            {cred.description ? (
              <p className="text-sm text-gray-600 dark:text-gray-400 whitespace-pre-wrap">{cred.description}</p>
            ) : null}
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Point of contact:{' '}
              <a className="text-primary-teal hover:underline" href={`mailto:${cred.pointOfContactEmail}`}>
                {cred.pointOfContactEmail}
              </a>
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ProgramByShiftView({
  program,
  expandedDays,
  onToggleDay,
  busyShiftRoleId,
  onSignUp,
  onCancel,
}: {
  program: VolunteerProgramView;
  expandedDays: Set<string>;
  onToggleDay: (key: string) => void;
  busyShiftRoleId: number | null;
  onSignUp: (role: VolunteerShiftRoleView, shift: VolunteerShiftView) => void;
  onCancel: (shiftRoleId: number, roleName: string) => void;
}) {
  const shiftsWithRoles = useMemo(
    () => program.shifts.filter((s) => s.roles.length > 0),
    [program.shifts]
  );
  const dayGroups = useMemo(() => {
    const map = new Map<string, VolunteerShiftView[]>();
    for (const shift of shiftsWithRoles) {
      const key = volunteerShiftDayKey(shift.startDt);
      const list = map.get(key) ?? [];
      list.push(shift);
      map.set(key, list);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [shiftsWithRoles]);

  const multiDay = dayGroups.length > 1;

  if (!multiDay) {
    return (
      <div className="space-y-3">
        {shiftsWithRoles.map((shift) => (
          <ShiftRolesBlock
            key={shift.id}
            shift={shift}
            headingMode="full"
            busyShiftRoleId={busyShiftRoleId}
            onSignUp={onSignUp}
            onCancel={onCancel}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {dayGroups.map(([dayKey, shifts]) => {
        const dayExpanded = expandedDays.has(`${program.id}:${dayKey}`);
        return (
          <div key={dayKey} className="rounded-md border border-gray-200 dark:border-gray-700 overflow-hidden">
            <button
              type="button"
              onClick={() => onToggleDay(`${program.id}:${dayKey}`)}
              className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-800/60"
              aria-expanded={dayExpanded}
            >
              <span className="font-medium text-gray-900 dark:text-gray-100">
                {formatVolunteerDayHeading(dayKey)}
              </span>
              <HiChevronDown
                className={`h-4 w-4 shrink-0 text-gray-500 transition-transform ${dayExpanded ? 'rotate-180' : ''}`}
              />
            </button>
            {dayExpanded ? (
              <div className="space-y-3 border-t border-gray-200 dark:border-gray-700 px-4 py-3">
                {shifts.map((shift) => (
                  <ShiftRolesBlock
                    key={shift.id}
                    shift={shift}
                    headingMode="time"
                    busyShiftRoleId={busyShiftRoleId}
                    onSignUp={onSignUp}
                    onCancel={onCancel}
                  />
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function ProgramByRoleView({
  program,
  expandedRoles,
  onToggleRole,
  busyShiftRoleId,
  onSignUp,
  onCancel,
}: {
  program: VolunteerProgramView;
  expandedRoles: Set<string>;
  onToggleRole: (key: string) => void;
  busyShiftRoleId: number | null;
  onSignUp: (role: VolunteerShiftRoleView, shift: VolunteerShiftView) => void;
  onCancel: (shiftRoleId: number, roleName: string) => void;
}) {
  const roleGroups = useMemo(() => {
    const map = new Map<
      number,
      {
        roleId: number;
        roleName: string;
        roleDescription: string | null;
        requiredCredentials: VolunteerShiftRoleView['requiredCredentials'];
        entries: Array<{ shift: VolunteerShiftView; role: VolunteerShiftRoleView }>;
      }
    >();
    for (const shift of program.shifts) {
      for (const role of shift.roles) {
        const existing = map.get(role.roleId);
        if (existing) {
          existing.entries.push({ shift, role });
        } else {
          map.set(role.roleId, {
            roleId: role.roleId,
            roleName: role.roleName,
            roleDescription: role.roleDescription,
            requiredCredentials: role.requiredCredentials,
            entries: [{ shift, role }],
          });
        }
      }
    }
    return [...map.values()].sort((a, b) => a.roleName.localeCompare(b.roleName));
  }, [program.shifts]);

  if (roleGroups.length === 0) {
    return <p className="text-sm text-gray-500 dark:text-gray-400">No roles available.</p>;
  }

  return (
    <div className="space-y-3">
      {roleGroups.map((group) => {
        const key = `${program.id}:role:${group.roleId}`;
        const expanded = expandedRoles.has(key);
        return (
          <div key={group.roleId} className="rounded-md border border-gray-200 dark:border-gray-700 overflow-hidden">
            <button
              type="button"
              onClick={() => onToggleRole(key)}
              className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-800/60"
              aria-expanded={expanded}
            >
              <div className="min-w-0 space-y-1">
                <div className="font-medium text-gray-900 dark:text-gray-100">{group.roleName}</div>
                {group.roleDescription ? (
                  <p className="text-sm text-gray-600 dark:text-gray-400 whitespace-pre-wrap">
                    {group.roleDescription}
                  </p>
                ) : null}
                {group.requiredCredentials.length > 0 ? (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {group.requiredCredentials.map((cred) => (
                      <span
                        key={cred.id}
                        className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-800 dark:bg-gray-700 dark:text-gray-200"
                      >
                        {cred.name}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
              <HiChevronDown
                className={`mt-1 h-4 w-4 shrink-0 text-gray-500 transition-transform ${expanded ? 'rotate-180' : ''}`}
              />
            </button>
            {expanded ? (
              <div className="divide-y divide-gray-200 dark:divide-gray-700 border-t border-gray-200 dark:border-gray-700">
                {group.entries.map(({ shift, role }) => (
                  <RoleSignupRow
                    key={role.id}
                    role={role}
                    heading={formatVolunteerRange(shift.startDt, shift.endDt)}
                    subheading={formatVolunteerDuration(shift.startDt, shift.endDt)}
                    busy={busyShiftRoleId === role.id}
                    onSignUp={() => onSignUp(role, shift)}
                    onCancel={() => onCancel(role.id, role.roleName)}
                  />
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function ShiftRolesBlock({
  shift,
  headingMode,
  busyShiftRoleId,
  onSignUp,
  onCancel,
}: {
  shift: VolunteerShiftView;
  headingMode: 'full' | 'time';
  busyShiftRoleId: number | null;
  onSignUp: (role: VolunteerShiftRoleView, shift: VolunteerShiftView) => void;
  onCancel: (shiftRoleId: number, roleName: string) => void;
}) {
  const duration = formatVolunteerDuration(shift.startDt, shift.endDt);
  const heading =
    headingMode === 'full'
      ? formatVolunteerRange(shift.startDt, shift.endDt)
      : formatVolunteerTimeRange(shift.startDt, shift.endDt);

  return (
    <div className="rounded-md border border-gray-200 dark:border-gray-700 overflow-hidden">
      <div className="border-b border-gray-200 dark:border-gray-700 px-4 py-3">
        <div className="font-medium text-gray-900 dark:text-gray-100">{heading}</div>
        {duration ? <div className="mt-1 text-sm text-gray-600 dark:text-gray-400">Duration: {duration}</div> : null}
      </div>
      <div className="divide-y divide-gray-200 dark:divide-gray-700">
        {shift.roles.map((role) => (
          <RoleSignupRow
            key={role.id}
            role={role}
            heading={role.roleName}
            subheading={role.roleDescription}
            showCredentials
            busy={busyShiftRoleId === role.id}
            onSignUp={() => onSignUp(role, shift)}
            onCancel={() => onCancel(role.id, role.roleName)}
          />
        ))}
      </div>
    </div>
  );
}

function RoleSignupRow({
  role,
  heading,
  subheading,
  showCredentials = false,
  busy,
  onSignUp,
  onCancel,
}: {
  role: VolunteerShiftRoleView;
  heading: string;
  subheading?: string | null;
  showCredentials?: boolean;
  busy: boolean;
  onSignUp: () => void;
  onCancel: () => void;
}) {
  let action: ReactNode = null;
  if (!role.callerHasCredentials) {
    action = (
      <span className="text-sm text-amber-700 dark:text-amber-300">Missing required credentials</span>
    );
  } else if (role.isFull && !role.callerIsSignedUp) {
    action = <span className="text-sm text-gray-500 dark:text-gray-400">Full</span>;
  } else {
    action = (
      <div className="flex flex-wrap gap-2">
        {role.callerIsSignedUp ? (
          <Button type="button" variant="secondary" disabled={busy} onClick={onCancel}>
            {busy ? 'Cancelling…' : 'Cancel signup'}
          </Button>
        ) : null}
        {!role.isFull ? (
          <Button type="button" disabled={busy} onClick={onSignUp}>
            {role.callerIsSignedUp ? 'Add volunteers' : 'Sign up'}
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="px-4 py-3 space-y-2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="font-medium text-gray-900 dark:text-gray-100">{heading}</div>
          {subheading ? (
            <p className="text-sm text-gray-600 dark:text-gray-400 whitespace-pre-wrap">{subheading}</p>
          ) : null}
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Volunteers: {role.volunteersRegistered}/{role.volunteersNeeded}
          </p>
          {showCredentials && role.requiredCredentials.length > 0 ? (
            <div className="flex flex-wrap gap-2 pt-1">
              {role.requiredCredentials.map((cred) => (
                <span
                  key={cred.id}
                  className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-800 dark:bg-gray-700 dark:text-gray-200"
                  title={cred.description || undefined}
                >
                  {cred.name}
                </span>
              ))}
            </div>
          ) : null}
          {role.signups.length > 0 ? (
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Signed up: {role.signups.map((s) => s.memberName).join(', ')}
            </p>
          ) : (
            <p className="text-sm text-gray-500 dark:text-gray-400">No volunteers signed up yet.</p>
          )}
        </div>
        <div className="shrink-0">{action}</div>
      </div>
    </div>
  );
}

function VolunteerSignupDialog({
  target,
  currentMemberId,
  onClose,
  onSuccess,
}: {
  target: SignupTarget;
  currentMemberId: number;
  onClose: () => void;
  onSuccess: (count: number) => Promise<void>;
}) {
  const volunteersInputId = useId();
  const commentsInputId = useId();
  const [selectedIds, setSelectedIds] = useState<number[]>(() =>
    target.callerIsSignedUp ? [] : [currentMemberId]
  );
  const [guestNames, setGuestNames] = useState<string[]>([]);
  const [comments, setComments] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const totalSelected = selectedIds.length + guestNames.length;
  const maxSelections = target.remainingSpots;

  const submit = async () => {
    if (totalSelected < 1) {
      setError('Select at least one volunteer.');
      return;
    }
    if (totalSelected > maxSelections) {
      setError(
        maxSelections === 1
          ? 'Only 1 spot remaining for this role.'
          : `Only ${maxSelections} spots remaining for this role.`
      );
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = (await post(
        '/volunteering/shift-roles/{id}/signups',
        {
          comments: comments.trim() || null,
          memberIds: selectedIds,
          guestNames,
        },
        { id: String(target.shiftRoleId) }
      )) as { count?: number; ids?: number[] };
      await onSuccess(result.count ?? result.ids?.length ?? totalSelected);
    } catch (err) {
      setError(formatApiError(err, 'Failed to sign up'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={`Sign up · ${target.roleName}`}
      size="lg"
      verticalAlign="start"
      contentOverflow="visible"
    >
      <div className="space-y-4">
        <p className="text-sm text-gray-600 dark:text-gray-400">{target.shiftLabel}</p>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {maxSelections} spot{maxSelections === 1 ? '' : 's'} remaining.
          {target.requiresCredentials
            ? ' This role requires credentials, so only eligible members can be added.'
            : null}
        </p>

        <FormField
          label="Volunteers"
          htmlFor={volunteersInputId}
          required
          helperText="Confirmation emails are sent to selected members. Non-members can be added by name."
          error={error && totalSelected < 1 ? error : undefined}
        >
          <MemberMultiSelect
            inputId={volunteersInputId}
            selectedIds={selectedIds}
            onChange={setSelectedIds}
            maxSelections={maxSelections}
            placeholder="Search members..."
            isOptionDisabled={(option) =>
              Boolean(target.callerIsSignedUp && option.id === currentMemberId)
            }
            getOptionStatusText={(option) =>
              target.callerIsSignedUp && option.id === currentMemberId ? 'Already signed up' : null
            }
            extraPills={guestNames.map((name) => ({
              key: `guest:${name}`,
              label: name,
              detail: 'Non-member',
              onRemove: () => setGuestNames((prev) => prev.filter((n) => n !== name)),
            }))}
            manualNameEntry={
              target.requiresCredentials
                ? undefined
                : {
                    linkLabel: 'Add non-member by name',
                    inputPlaceholder: 'Full name',
                    addButtonLabel: 'Add',
                    onAdd: (name) => {
                      const trimmed = name.trim();
                      if (!trimmed) return;
                      setGuestNames((prev) =>
                        prev.some((n) => n.toLowerCase() === trimmed.toLowerCase())
                          ? prev
                          : [...prev, trimmed]
                      );
                    },
                  }
            }
          />
        </FormField>

        <FormField
          label="Comments"
          htmlFor={commentsInputId}
          optional
          helperText="Visible to the owners of this volunteer program."
        >
          <textarea
            id={commentsInputId}
            className="app-input w-full min-h-[96px]"
            value={comments}
            onChange={(e) => setComments(e.target.value)}
            maxLength={2000}
            placeholder="Anything the program owners should know"
          />
        </FormField>

        {error && totalSelected >= 1 ? (
          <p className="text-sm text-red-600 dark:text-red-400" role="alert">
            {error}
          </p>
        ) : null}

        <div className="flex flex-wrap justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void submit()} disabled={submitting || totalSelected < 1}>
            {submitting ? 'Signing up…' : 'Confirm signup'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
