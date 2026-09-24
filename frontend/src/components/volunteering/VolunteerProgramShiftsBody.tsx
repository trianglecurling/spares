import { useId, useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { HiChevronLeft, HiChevronRight, HiInformationCircle } from 'react-icons/hi2';
import Button from '../Button';
import ChoiceInput from '../ChoiceInput';
import FormField from '../FormField';
import HelpCallout from '../HelpCallout';
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
  formatVolunteerTimeRange,
  parseVolunteerSignupKind,
  volunteerProgramHasIneligibleCredentialRoles,
  volunteerProgramMissingCredentialNames,
  volunteerProgramUiTerms,
  volunteerShiftDayKey,
  volunteerSpotsStatusLabel,
  volunteerSpotsTotals,
  type VolunteerCredentialSummary,
  type VolunteerProgramUiTerms,
  type VolunteerProgramView,
  type VolunteerShiftRoleView,
  type VolunteerShiftView,
  type VolunteerSignupView,
} from '../../utils/volunteering';

export type VolunteerProgramGroupBy = 'shift' | 'role';

type VolunteerProgramShiftsBodyProps = {
  program: VolunteerProgramView;
  /** Shifts already filtered for the caller (see `volunteerProgramShiftsForCaller`). */
  shifts: VolunteerShiftView[];
  groupBy: VolunteerProgramGroupBy;
  onChanged: () => Promise<void>;
  heldCredentialIds?: Iterable<number>;
  /** Omit once ineligible roles are already shown. */
  onShowIneligibleRoles?: () => void;
};

type SignUpHandler = (
  role: VolunteerShiftRoleView,
  shift: VolunteerShiftView,
  manageForOthers?: boolean
) => void;
type CancelHandler = (shiftRoleId: number, roleName: string) => void;

type RoleSummary = {
  roleId: number;
  roleName: string;
  roleDescription: string | null;
  requiredCredentials: VolunteerCredentialSummary[];
};

/** Above this many days the day picker collapses from radios to a dropdown. */
const MAX_INLINE_DAY_OPTIONS = 5;

const agendaRowClass = 'grid gap-x-6 gap-y-2 py-4 sm:grid-cols-[11rem_minmax(0,1fr)]';

/** Distinct roles across shifts, sorted by name. */
function volunteerShiftRoleSummaries(shifts: VolunteerShiftView[]): RoleSummary[] {
  const map = new Map<number, RoleSummary>();
  for (const shift of shifts) {
    for (const role of shift.roles) {
      if (map.has(role.roleId)) continue;
      map.set(role.roleId, {
        roleId: role.roleId,
        roleName: role.roleName,
        roleDescription: role.roleDescription?.trim() || null,
        requiredCredentials: role.requiredCredentials,
      });
    }
  }
  return [...map.values()].sort((a, b) => a.roleName.localeCompare(b.roleName));
}

function RoleDescriptionTip({ roleName, description }: { roleName: string; description: string | null }) {
  if (!description) return null;
  return (
    <HelpCallout
      text={<span className="whitespace-pre-wrap">{description}</span>}
      label={`About ${roleName}`}
      triggerClassName="inline-flex h-5 w-5 items-center justify-center rounded-full text-gray-400 transition-colors hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
    >
      <HiInformationCircle className="h-5 w-5" aria-hidden="true" />
    </HelpCallout>
  );
}

/**
 * Role descriptions and credential requirements, collapsed by default so the program
 * details stay short. A single role is named inline because shift rows omit its name.
 */
export function VolunteerProgramRolesSummary({
  shifts,
  terms,
}: {
  shifts: VolunteerShiftView[];
  terms: VolunteerProgramUiTerms;
}) {
  const listId = useId();
  const [expanded, setExpanded] = useState(false);
  const roles = volunteerShiftRoleSummaries(shifts);
  const hasDetails = roles.some(
    (role) => role.roleDescription || role.requiredCredentials.length > 0
  );
  if (roles.length === 0) return null;

  if (roles.length === 1) {
    const [role] = roles;
    return (
      <p className="flex flex-wrap items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
        <span>
          <span className="font-medium">{terms.roleTitle}:</span> {role.roleName}
        </span>
        <RoleDescriptionTip roleName={role.roleName} description={role.roleDescription} />
        <CredentialPills credentials={role.requiredCredentials} />
      </p>
    );
  }

  if (!hasDetails) return null;

  return (
    <div>
      <button
        type="button"
        className="rounded-sm text-sm font-medium text-primary-teal-link hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-teal/50"
        aria-expanded={expanded}
        aria-controls={listId}
        onClick={() => setExpanded((current) => !current)}
      >
        {expanded
          ? `Hide ${terms.roleSingular} descriptions`
          : `Show ${terms.roleSingular} descriptions`}
      </button>
      <dl id={listId} className="mt-3 space-y-3" hidden={!expanded}>
        {roles.map((role) => (
          <div key={role.roleId} className="space-y-1">
            <dt className="flex flex-wrap items-center gap-2 font-medium text-gray-900 dark:text-gray-100">
              {role.roleName}
              <CredentialPills credentials={role.requiredCredentials} />
            </dt>
            {role.roleDescription ? (
              <dd className="text-sm text-gray-600 dark:text-gray-400 whitespace-pre-wrap">
                {role.roleDescription}
              </dd>
            ) : null}
          </div>
        ))}
      </dl>
    </div>
  );
}

export default function VolunteerProgramShiftsBody({
  program,
  shifts,
  groupBy,
  onChanged,
  heldCredentialIds,
  onShowIneligibleRoles,
}: VolunteerProgramShiftsBodyProps) {
  const { showAlert } = useAlert();
  const { confirm } = useConfirm();
  const terms = volunteerProgramUiTerms(parseVolunteerSignupKind(program.signupKind));
  const [busyShiftRoleId, setBusyShiftRoleId] = useState<number | null>(null);
  const [signupTarget, setSignupTarget] = useState<VolunteerSignupTarget | null>(null);

  const openSignUp: SignUpHandler = (role, shift, manageForOthers = false) => {
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

  const handleCancel: CancelHandler = async (shiftRoleId, roleName) => {
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

  const shiftsWithRoles = useMemo(() => shifts.filter((shift) => shift.roles.length > 0), [shifts]);
  const hasHiddenCredentialRoles =
    !program.canManage && volunteerProgramHasIneligibleCredentialRoles(program);
  const singleRole = volunteerShiftRoleSummaries(shiftsWithRoles).length === 1;

  return (
    <>
      <div className="space-y-6">
        {shiftsWithRoles.length > 0 ? (
          groupBy === 'shift' ? (
            <ProgramByShiftView
              programId={program.id}
              shifts={shiftsWithRoles}
              terms={terms}
              canManage={program.canManage}
              showRoleNames={!singleRole}
              busyShiftRoleId={busyShiftRoleId}
              onSignUp={openSignUp}
              onCancel={handleCancel}
            />
          ) : (
            <ProgramByRoleView
              shifts={shiftsWithRoles}
              terms={terms}
              canManage={program.canManage}
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
            onShowAnyway={onShowIneligibleRoles}
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

function formatShortDayLabel(dayKey: string): string {
  const [y, m, d] = dayKey.split('-').map(Number);
  if (!y || !m || !d) return dayKey;
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function ProgramByShiftView({
  programId,
  shifts,
  terms,
  canManage,
  showRoleNames,
  busyShiftRoleId,
  onSignUp,
  onCancel,
}: {
  programId: number;
  shifts: VolunteerShiftView[];
  terms: VolunteerProgramUiTerms;
  canManage: boolean;
  showRoleNames: boolean;
  busyShiftRoleId: number | null;
  onSignUp: SignUpHandler;
  onCancel: CancelHandler;
}) {
  const dayPickerId = useId();
  const [searchParams, setSearchParams] = useSearchParams();
  const dayGroups = useMemo(() => {
    const map = new Map<string, VolunteerShiftView[]>();
    for (const shift of shifts) {
      const key = volunteerShiftDayKey(shift.startDt);
      const list = map.get(key) ?? [];
      list.push(shift);
      map.set(key, list);
    }
    return [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([dayKey, dayShifts]) => ({
        dayKey,
        shifts: dayShifts,
        roles: dayShifts.flatMap((shift) => shift.roles),
      }));
  }, [shifts]);

  if (dayGroups.length === 0) return null;

  const dayParam = searchParams.get('day');
  const defaultDay =
    dayGroups.find((group) => volunteerSpotsTotals(group.roles).remaining > 0) ?? dayGroups[0];
  const selectedDay = dayGroups.find((group) => group.dayKey === dayParam) ?? defaultDay;
  const selectedIndex = dayGroups.indexOf(selectedDay);
  const multiDay = dayGroups.length > 1;
  const dayPickerInline = dayGroups.length <= MAX_INLINE_DAY_OPTIONS;
  const previousDay = selectedIndex > 0 ? dayGroups[selectedIndex - 1] : null;
  const nextDay = selectedIndex < dayGroups.length - 1 ? dayGroups[selectedIndex + 1] : null;

  const selectDay = (dayKey: string) => {
    const next = new URLSearchParams(searchParams);
    next.set('day', dayKey);
    setSearchParams(next, { replace: true });
  };

  return (
    <div className="space-y-6">
      {multiDay ? (
        <div className="flex flex-wrap items-end gap-2">
          <FormField
            label="Day"
            htmlFor={dayPickerInline ? undefined : dayPickerId}
            labelId={`${dayPickerId}-label`}
            className="mb-0 min-w-0"
          >
            <ChoiceInput<string>
              inputId={dayPickerId}
              ariaLabelledBy={dayPickerInline ? `${dayPickerId}-label` : undefined}
              listboxLabel="Day"
              name={`volunteer-program-${programId}-day`}
              layout={dayPickerInline ? 'inline' : 'popover'}
              options={dayGroups.map((group) => {
                const { remaining, needed } = volunteerSpotsTotals(group.roles);
                return {
                  value: group.dayKey,
                  label: formatShortDayLabel(group.dayKey),
                  description: volunteerSpotsStatusLabel(remaining, needed),
                };
              })}
              value={selectedDay.dayKey}
              onChange={(value) => {
                if (typeof value === 'string') selectDay(value);
              }}
            />
          </FormField>
          {dayPickerInline ? null : (
            <div className="flex gap-2">
              <Button
                type="button"
                variant="secondary"
                disabled={!previousDay}
                onClick={() => previousDay && selectDay(previousDay.dayKey)}
                aria-label="Previous day"
              >
                <HiChevronLeft className="h-5 w-5" aria-hidden="true" />
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={!nextDay}
                onClick={() => nextDay && selectDay(nextDay.dayKey)}
                aria-label="Next day"
              >
                <HiChevronRight className="h-5 w-5" aria-hidden="true" />
              </Button>
            </div>
          )}
        </div>
      ) : null}

      <section aria-labelledby={`${dayPickerId}-heading`}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-gray-300 pb-2 dark:border-gray-600">
          <h2
            id={`${dayPickerId}-heading`}
            className="text-lg font-semibold text-gray-900 dark:text-gray-100"
          >
            {formatVolunteerDayHeading(selectedDay.dayKey)}
          </h2>
          {multiDay ? null : <VolunteerSpotsStatusBadge roles={selectedDay.roles} />}
        </div>
        <ul className="divide-y divide-gray-200 dark:divide-gray-700">
          {selectedDay.shifts.map((shift) => (
            <ShiftAgendaRow
              key={shift.id}
              shift={shift}
              terms={terms}
              canManage={canManage}
              showRoleNames={showRoleNames}
              busyShiftRoleId={busyShiftRoleId}
              onSignUp={onSignUp}
              onCancel={onCancel}
            />
          ))}
        </ul>
      </section>
    </div>
  );
}

function ProgramByRoleView({
  shifts,
  terms,
  canManage,
  busyShiftRoleId,
  onSignUp,
  onCancel,
}: {
  shifts: VolunteerShiftView[];
  terms: VolunteerProgramUiTerms;
  canManage: boolean;
  busyShiftRoleId: number | null;
  onSignUp: SignUpHandler;
  onCancel: CancelHandler;
}) {
  const headingIdBase = useId();
  const roleGroups = useMemo(() => {
    const map = new Map<
      number,
      {
        roleId: number;
        roleName: string;
        roleDescription: string | null;
        entries: Array<{ shift: VolunteerShiftView; role: VolunteerShiftRoleView }>;
      }
    >();
    for (const shift of shifts) {
      for (const role of shift.roles) {
        const existing = map.get(role.roleId);
        if (existing) {
          existing.entries.push({ shift, role });
        } else {
          map.set(role.roleId, {
            roleId: role.roleId,
            roleName: role.roleName,
            roleDescription: role.roleDescription?.trim() || null,
            entries: [{ shift, role }],
          });
        }
      }
    }
    return [...map.values()].sort((a, b) => a.roleName.localeCompare(b.roleName));
  }, [shifts]);

  if (roleGroups.length === 0) {
    return <p className="text-sm text-gray-500 dark:text-gray-400">No {terms.rolePlural} available.</p>;
  }

  return (
    <div className="space-y-8">
      {roleGroups.map((group) => {
        const headingId = `${headingIdBase}-role-${group.roleId}`;
        return (
          <section key={group.roleId} aria-labelledby={headingId}>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-gray-300 pb-2 dark:border-gray-600">
              <span className="inline-flex items-center gap-1">
                <h2 id={headingId} className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  {group.roleName}
                </h2>
                <RoleDescriptionTip roleName={group.roleName} description={group.roleDescription} />
              </span>
              <VolunteerSpotsStatusBadge roles={group.entries.map(({ role }) => role)} />
            </div>
            <ul className="divide-y divide-gray-200 dark:divide-gray-700">
              {group.entries.map(({ shift, role }) => (
                <li key={role.id} className={agendaRowClass}>
                  <ShiftTimeCell shift={shift} showDay />
                  <RoleSignupEntry
                    role={role}
                    terms={terms}
                    showRoleName={false}
                    canManage={canManage}
                    busy={busyShiftRoleId === role.id}
                    onSignUp={(manageForOthers) => onSignUp(role, shift, manageForOthers)}
                    onCancel={() => onCancel(role.id, role.roleName)}
                  />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function ShiftTimeCell({ shift, showDay = false }: { shift: VolunteerShiftView; showDay?: boolean }) {
  const duration = formatVolunteerDuration(shift.startDt, shift.endDt);
  return (
    <div className="space-y-0.5">
      {showDay ? (
        <div className="text-sm font-medium text-gray-600 dark:text-gray-400">
          {formatShortDayLabel(volunteerShiftDayKey(shift.startDt))}
        </div>
      ) : null}
      <div className="font-semibold tabular-nums text-gray-900 dark:text-gray-100">
        {formatVolunteerTimeRange(shift.startDt, shift.endDt)}
      </div>
      {duration ? <div className="text-sm text-gray-500 dark:text-gray-400">{duration}</div> : null}
    </div>
  );
}

function ShiftAgendaRow({
  shift,
  terms,
  canManage,
  showRoleNames,
  busyShiftRoleId,
  onSignUp,
  onCancel,
}: {
  shift: VolunteerShiftView;
  terms: VolunteerProgramUiTerms;
  canManage: boolean;
  showRoleNames: boolean;
  busyShiftRoleId: number | null;
  onSignUp: SignUpHandler;
  onCancel: CancelHandler;
}) {
  const entries = shift.roles.map((role) => (
    <RoleSignupEntry
      key={role.id}
      role={role}
      terms={terms}
      showRoleName={showRoleNames}
      canManage={canManage}
      busy={busyShiftRoleId === role.id}
      onSignUp={(manageForOthers) => onSignUp(role, shift, manageForOthers)}
      onCancel={() => onCancel(role.id, role.roleName)}
    />
  ));

  return (
    <li className={agendaRowClass}>
      <ShiftTimeCell shift={shift} />
      {entries.length === 1 ? (
        entries[0]
      ) : (
        <div className="divide-y divide-dashed divide-gray-200 dark:divide-gray-700 [&>*]:py-3 [&>*:first-child]:pt-0 [&>*:last-child]:pb-0">
          {entries}
        </div>
      )}
    </li>
  );
}

function CredentialPills({ credentials }: { credentials: VolunteerCredentialSummary[] }) {
  if (credentials.length === 0) return null;
  return (
    <span className="inline-flex flex-wrap gap-2">
      {credentials.map((cred) => (
        <span
          key={cred.id}
          className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-800 dark:bg-gray-700 dark:text-gray-200"
          title={cred.description || undefined}
        >
          {cred.name}
        </span>
      ))}
    </span>
  );
}

function RoleSignupEntry({
  role,
  terms,
  showRoleName,
  canManage,
  busy,
  onSignUp,
  onCancel,
}: {
  role: VolunteerShiftRoleView;
  terms: VolunteerProgramUiTerms;
  showRoleName: boolean;
  canManage: boolean;
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

  const signedUpPill = role.callerIsSignedUp ? (
    <span className="inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200">
      You&apos;re signed up
    </span>
  ) : null;

  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 flex-1 space-y-1">
        {showRoleName || signedUpPill ? (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {showRoleName ? (
              <span className="inline-flex items-center gap-1">
                <span className="font-medium text-gray-900 dark:text-gray-100">{role.roleName}</span>
                <RoleDescriptionTip
                  roleName={role.roleName}
                  description={role.roleDescription?.trim() || null}
                />
              </span>
            ) : null}
            {signedUpPill}
          </div>
        ) : null}
        <RoleSignupsSummary
          signups={role.signups}
          label={terms.signedUpCountLabel}
          registered={role.volunteersRegistered}
          needed={role.volunteersNeeded}
        />
      </div>
      <div className="shrink-0">{action}</div>
    </div>
  );
}

function RoleSignupsSummary({
  signups,
  label,
  registered,
  needed,
}: {
  signups: VolunteerSignupView[];
  label: string;
  registered: number;
  needed: number;
}) {
  const nameFor = (signup: VolunteerSignupView) =>
    `${signup.memberName}${signup.memberId ? '' : ' (non-member)'}`;
  const anyComments = signups.some((signup) => signup.comments?.trim());
  const countLabel = (
    <span className="font-medium text-gray-700 dark:text-gray-300">
      {label}: {registered}/{needed}
    </span>
  );

  if (!anyComments) {
    return (
      <p className="text-sm text-gray-600 dark:text-gray-400">
        {countLabel}
        {signups.length > 0 ? <> · {signups.map(nameFor).join(', ')}</> : null}
      </p>
    );
  }

  return (
    <div className="text-sm text-gray-600 dark:text-gray-400">
      <p>{countLabel}</p>
      <ul className="mt-1 space-y-0.5">
        {signups.map((signup) => {
          const comments = signup.comments?.trim();
          return (
            <li key={signup.id} className="whitespace-pre-wrap">
              <span className="text-gray-800 dark:text-gray-200">{nameFor(signup)}</span>
              {comments ? (
                <span className="text-gray-500 dark:text-gray-400"> — {comments}</span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
