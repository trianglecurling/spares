import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { HiChevronDown } from 'react-icons/hi2';
import Button from '../Button';
import VolunteerSignupDialog, {
  type VolunteerSignupTarget,
} from './VolunteerSignupDialog';
import VolunteerSpotsStatusBadge from './VolunteerSpotsStatusBadge';
import { del } from '../../api/client';
import { useAlert } from '../../contexts/AlertContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import { formatApiError } from '../../utils/api';
import {
  formatVolunteerDayHeading,
  formatVolunteerDuration,
  formatVolunteerRange,
  formatVolunteerRoleShiftPreview,
  formatVolunteerTimeRange,
  parseVolunteerSignupKind,
  volunteerProgramHasIneligibleCredentialRoles,
  volunteerProgramMissingCredentialNames,
  volunteerProgramShiftsForCaller,
  volunteerProgramUiTerms,
  volunteerShiftDayKey,
  type VolunteerProgramUiTerms,
  type VolunteerProgramView,
  type VolunteerShiftRoleView,
  type VolunteerShiftView,
  type VolunteerSignupView,
} from '../../utils/volunteering';

export type VolunteerProgramGroupBy = 'shift' | 'role';

type VolunteerProgramShiftsBodyProps = {
  program: VolunteerProgramView;
  groupBy: VolunteerProgramGroupBy;
  onChanged: () => Promise<void>;
  heldCredentialIds?: Iterable<number>;
};

export default function VolunteerProgramShiftsBody({
  program,
  groupBy,
  onChanged,
  heldCredentialIds,
}: VolunteerProgramShiftsBodyProps) {
  const { showAlert } = useAlert();
  const { confirm } = useConfirm();
  const terms = volunteerProgramUiTerms(parseVolunteerSignupKind(program.signupKind));
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());
  const [expandedRoles, setExpandedRoles] = useState<Set<string>>(new Set());
  const [busyShiftRoleId, setBusyShiftRoleId] = useState<number | null>(null);
  const [signupTarget, setSignupTarget] = useState<VolunteerSignupTarget | null>(null);
  const [showIneligibleRoles, setShowIneligibleRoles] = useState(false);

  const toggleInSet = <T,>(prev: Set<T>, key: T): Set<T> => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  };

  const openSignUp = (
    role: VolunteerShiftRoleView,
    shift: VolunteerShiftView,
    manageForOthers = false
  ) => {
    const remaining = Math.max(0, role.volunteersNeeded - role.volunteersRegistered);
    setSignupTarget({
      shiftRoleId: role.id,
      roleName: role.roleName,
      shiftLabel: formatVolunteerRange(shift.startDt, shift.endDt),
      remainingSpots: remaining,
      requiresCredentials: role.requiredCredentials.length > 0,
      callerIsSignedUp: role.callerIsSignedUp,
      signupKind: parseVolunteerSignupKind(program.signupKind),
      manageForOthers,
      signedUpMemberIds: role.signups
        .map((signup) => signup.memberId)
        .filter((id): id is number => id != null),
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

  const displayProgram = useMemo(
    () => ({
      ...program,
      shifts: volunteerProgramShiftsForCaller(program, {
        includeIneligible: showIneligibleRoles,
      }),
    }),
    [program, showIneligibleRoles]
  );
  const hasHiddenCredentialRoles =
    !program.canManage && volunteerProgramHasIneligibleCredentialRoles(program);
  const hasVisibleShifts = displayProgram.shifts.some((shift) => shift.roles.length > 0);

  return (
    <>
      <div className="space-y-4">
        {hasVisibleShifts ? (
          groupBy === 'shift' ? (
            <ProgramByShiftView
              program={displayProgram}
              terms={terms}
              expandedDays={expandedDays}
              onToggleDay={(key) => setExpandedDays((prev) => toggleInSet(prev, key))}
              busyShiftRoleId={busyShiftRoleId}
              onSignUp={openSignUp}
              onCancel={handleCancel}
            />
          ) : (
            <ProgramByRoleView
              program={displayProgram}
              terms={terms}
              expandedRoles={expandedRoles}
              onToggleRole={(key) => setExpandedRoles((prev) => toggleInSet(prev, key))}
              busyShiftRoleId={busyShiftRoleId}
              onSignUp={openSignUp}
              onCancel={handleCancel}
            />
          )
        ) : null}

        {hasHiddenCredentialRoles ? (
          <MissingCredentialsNote
            shiftPlural={terms.shiftPlural}
            credentialNames={volunteerProgramMissingCredentialNames(program, heldCredentialIds)}
            onShowAnyway={showIneligibleRoles ? undefined : () => setShowIneligibleRoles(true)}
          />
        ) : null}
      </div>

      {signupTarget ? (
        <VolunteerSignupDialog
          target={signupTarget}
          onClose={() => setSignupTarget(null)}
          onSuccess={async (count) => {
            setSignupTarget(null);
            showAlert(
              signupTarget.manageForOthers
                ? count === 1
                  ? `1 ${terms.peopleSingular} signed up. A confirmation email is on the way.`
                  : `${count} ${terms.peoplePlural} signed up. Confirmation emails are on the way.`
                : count === 1
                  ? 'Signed up. Confirmation emails are on the way for selected members.'
                  : `${count} ${terms.peoplePlural} signed up. Confirmation emails are on the way for selected members.`,
              'success'
            );
            await onChanged();
          }}
        />
      ) : null}
    </>
  );
}

const credentialNoteLinkClass =
  'text-primary-teal-link hover:underline rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-teal/50';

function MissingCredentialsNote({
  shiftPlural,
  credentialNames,
  onShowAnyway,
}: {
  shiftPlural: string;
  credentialNames: string[];
  onShowAnyway?: () => void;
}) {
  return (
    <p className="text-sm text-gray-500 dark:text-gray-400">
      There are additional {shiftPlural} on this program that you are missing{' '}
      <Link to="/volunteering?tab=credentials" className={credentialNoteLinkClass}>
        credentials
      </Link>
      {` for${credentialNames.length > 0 ? ` (${credentialNames.join(', ')})` : ''}.`}
      {onShowAnyway ? (
        <>
          {' '}
          <button type="button" onClick={onShowAnyway} className={credentialNoteLinkClass}>
            Show anyway.
          </button>
        </>
      ) : null}
    </p>
  );
}

function ProgramByShiftView({
  program,
  terms,
  expandedDays,
  onToggleDay,
  busyShiftRoleId,
  onSignUp,
  onCancel,
}: {
  program: VolunteerProgramView;
  terms: VolunteerProgramUiTerms;
  expandedDays: Set<string>;
  onToggleDay: (key: string) => void;
  busyShiftRoleId: number | null;
  onSignUp: (role: VolunteerShiftRoleView, shift: VolunteerShiftView, manageForOthers?: boolean) => void;
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
            terms={terms}
            headingMode="full"
            canManage={program.canManage}
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
        const rolePreview = uniqueSorted(
          shifts.flatMap((shift) => shift.roles.map((role) => role.roleName))
        );
        return (
          <div key={dayKey} className="rounded-md border border-gray-200 dark:border-gray-700 overflow-hidden">
            <button
              type="button"
              onClick={() => onToggleDay(`${program.id}:${dayKey}`)}
              className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-800/60"
              aria-expanded={dayExpanded}
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <div className="font-medium text-gray-900 dark:text-gray-100">
                    {formatVolunteerDayHeading(dayKey)}
                  </div>
                  <VolunteerSpotsStatusBadge roles={shifts.flatMap((shift) => shift.roles)} />
                </div>
                {!dayExpanded ? <AccordionPreview items={rolePreview} /> : null}
              </div>
              <HiChevronDown
                className={`mt-1 h-4 w-4 shrink-0 text-gray-500 transition-transform ${dayExpanded ? 'rotate-180' : ''}`}
              />
            </button>
            {dayExpanded ? (
              <div className="space-y-3 border-t border-gray-200 dark:border-gray-700 px-4 py-3">
                {shifts.map((shift) => (
                  <ShiftRolesBlock
                    key={shift.id}
                    shift={shift}
                    terms={terms}
                    headingMode="time"
                    canManage={program.canManage}
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
  terms,
  expandedRoles,
  onToggleRole,
  busyShiftRoleId,
  onSignUp,
  onCancel,
}: {
  program: VolunteerProgramView;
  terms: VolunteerProgramUiTerms;
  expandedRoles: Set<string>;
  onToggleRole: (key: string) => void;
  busyShiftRoleId: number | null;
  onSignUp: (role: VolunteerShiftRoleView, shift: VolunteerShiftView, manageForOthers?: boolean) => void;
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
    return <p className="text-sm text-gray-500 dark:text-gray-400">No {terms.rolePlural} available.</p>;
  }

  return (
    <div className="space-y-3">
      {roleGroups.map((group) => {
        const key = `${program.id}:role:${group.roleId}`;
        const expanded = expandedRoles.has(key);
        const timePreview = formatVolunteerRoleShiftPreview(
          group.entries.map(({ shift }) => ({ startDt: shift.startDt, endDt: shift.endDt }))
        );
        return (
          <div key={group.roleId} className="rounded-md border border-gray-200 dark:border-gray-700 overflow-hidden">
            <button
              type="button"
              onClick={() => onToggleRole(key)}
              className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-800/60"
              aria-expanded={expanded}
            >
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <div className="font-medium text-gray-900 dark:text-gray-100">{group.roleName}</div>
                  <VolunteerSpotsStatusBadge roles={group.entries.map(({ role }) => role)} />
                </div>
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
                {!expanded && timePreview ? (
                  <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{timePreview}</p>
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
                    terms={terms}
                    heading={formatVolunteerRange(shift.startDt, shift.endDt)}
                    subheading={formatVolunteerDuration(shift.startDt, shift.endDt)}
                    canManage={program.canManage}
                    busy={busyShiftRoleId === role.id}
                    onSignUp={(manageForOthers) => onSignUp(role, shift, manageForOthers)}
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

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b)
  );
}

function AccordionPreview({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  const maxVisible = 4;
  const visible = items.slice(0, maxVisible);
  const extra = items.length - visible.length;
  const label = extra > 0 ? `${visible.join(' · ')} · +${extra} more` : visible.join(' · ');
  return <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{label}</p>;
}

function ShiftRolesBlock({
  shift,
  terms,
  headingMode,
  canManage,
  busyShiftRoleId,
  onSignUp,
  onCancel,
}: {
  shift: VolunteerShiftView;
  terms: VolunteerProgramUiTerms;
  headingMode: 'full' | 'time';
  canManage: boolean;
  busyShiftRoleId: number | null;
  onSignUp: (role: VolunteerShiftRoleView, shift: VolunteerShiftView, manageForOthers?: boolean) => void;
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
            terms={terms}
            heading={role.roleName}
            subheading={role.roleDescription}
            showCredentials
            canManage={canManage}
            busy={busyShiftRoleId === role.id}
            onSignUp={(manageForOthers) => onSignUp(role, shift, manageForOthers)}
            onCancel={() => onCancel(role.id, role.roleName)}
          />
        ))}
      </div>
    </div>
  );
}

function RoleSignupRow({
  role,
  terms,
  heading,
  subheading,
  showCredentials = false,
  canManage = false,
  busy,
  onSignUp,
  onCancel,
}: {
  role: VolunteerShiftRoleView;
  terms: VolunteerProgramUiTerms;
  heading: string;
  subheading?: string | null;
  showCredentials?: boolean;
  canManage?: boolean;
  busy: boolean;
  onSignUp: (manageForOthers?: boolean) => void;
  onCancel: () => void;
}) {
  const canSignSelf = role.callerHasCredentials && !role.callerIsSignedUp;
  let action: ReactNode = null;
  if (!canManage && !role.callerHasCredentials && !role.callerIsSignedUp) {
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
        {!role.isFull && canSignSelf ? (
          <Button type="button" disabled={busy} onClick={() => onSignUp(false)}>
            Sign up
          </Button>
        ) : null}
        {!role.isFull && (canManage || role.callerIsSignedUp) ? (
          <Button
            type="button"
            variant={canSignSelf ? 'secondary' : 'primary'}
            disabled={busy}
            onClick={() => onSignUp(true)}
          >
            {terms.addPeople}
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="px-4 py-3 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="font-medium text-gray-900 dark:text-gray-100">{heading}</div>
          {subheading ? (
            <p className="text-sm text-gray-600 dark:text-gray-400 whitespace-pre-wrap">{subheading}</p>
          ) : null}
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {terms.signedUpCountLabel}: {role.volunteersRegistered}/{role.volunteersNeeded}
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
        </div>
        <div className="shrink-0">{action}</div>
      </div>
      <RoleSignupsList signups={role.signups} noneSignedUp={terms.noneSignedUp} />
    </div>
  );
}

function RoleSignupsList({
  signups,
  noneSignedUp,
}: {
  signups: VolunteerSignupView[];
  noneSignedUp: string;
}) {
  if (signups.length === 0) {
    return <p className="text-sm text-gray-500 dark:text-gray-400">{noneSignedUp}</p>;
  }

  return (
    <div className="app-card-subtle">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Signed up</h3>
      <ul className="mt-2 space-y-2">
        {signups.map((signup) => {
          const comments = signup.comments?.trim();
          return (
            <li key={signup.id}>
              <div className="font-medium text-gray-900 dark:text-gray-100">
                {signup.memberName}
                {!signup.memberId ? ' (non-member)' : ''}
              </div>
              {comments ? (
                <p className="mt-0.5 text-sm text-gray-600 dark:text-gray-400 whitespace-pre-wrap">
                  {comments}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
