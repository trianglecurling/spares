import { useMemo, useState, type ReactNode } from 'react';
import { HiChevronDown } from 'react-icons/hi2';
import Button from '../Button';
import VolunteerSignupDialog, {
  type VolunteerSignupTarget,
} from './VolunteerSignupDialog';
import { del } from '../../api/client';
import { useAlert } from '../../contexts/AlertContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import { formatApiError } from '../../utils/api';
import {
  formatVolunteerDayHeading,
  formatVolunteerDuration,
  formatVolunteerRange,
  formatVolunteerTimeRange,
  volunteerShiftDayKey,
  type VolunteerProgramView,
  type VolunteerShiftRoleView,
  type VolunteerShiftView,
} from '../../utils/volunteering';

export type VolunteerProgramGroupBy = 'shift' | 'role';

type VolunteerProgramShiftsBodyProps = {
  program: VolunteerProgramView;
  groupBy: VolunteerProgramGroupBy;
  onChanged: () => Promise<void>;
};

export default function VolunteerProgramShiftsBody({
  program,
  groupBy,
  onChanged,
}: VolunteerProgramShiftsBodyProps) {
  const { showAlert } = useAlert();
  const { confirm } = useConfirm();
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());
  const [expandedRoles, setExpandedRoles] = useState<Set<string>>(new Set());
  const [busyShiftRoleId, setBusyShiftRoleId] = useState<number | null>(null);
  const [signupTarget, setSignupTarget] = useState<VolunteerSignupTarget | null>(null);

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
      await onChanged();
    } catch (err) {
      showAlert(formatApiError(err, 'Failed to cancel signup'), 'error');
    } finally {
      setBusyShiftRoleId(null);
    }
  };

  return (
    <>
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

      {signupTarget ? (
        <VolunteerSignupDialog
          target={signupTarget}
          onClose={() => setSignupTarget(null)}
          onSuccess={async (count) => {
            setSignupTarget(null);
            showAlert(
              count === 1
                ? 'Signed up. Confirmation emails are on the way for selected members.'
                : `${count} volunteers signed up. Confirmation emails are on the way for selected members.`,
              'success'
            );
            await onChanged();
          }}
        />
      ) : null}
    </>
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
