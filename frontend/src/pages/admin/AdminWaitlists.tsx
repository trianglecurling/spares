import { Fragment, useCallback, useEffect, useId, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AppPage, AppPageHeader } from '../../components/AppPage';
import AppStateCard from '../../components/AppStateCard';
import AppPageControlsRow from '../../components/AppPageControlsRow';
import BackButton from '../../components/BackButton';
import Button from '../../components/Button';
import FormField from '../../components/FormField';
import Modal from '../../components/Modal';
import MemberAutocomplete from '../../components/MemberAutocomplete';
import MemberMultiSelect from '../../components/MemberMultiSelect';
import {
  expectedByotRosterSize,
  formatTeamRosterHeadline,
  rosterEntries,
} from '../../components/registration/registrationViewEditShared';
import SortableList from '../../components/dragDrop/SortableList';
import api, { getApiErrorMessage } from '../../utils/api';
import { useAlert } from '../../contexts/AlertContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import { useAuth } from '../../contexts/AuthContext';
import { useMemberOptions } from '../../contexts/MemberOptionsContext';
import { memberHasScope } from '../../utils/permissions';
import HelpCallout from '../../components/HelpCallout';
import {
  nextFrozenCountAfterMove,
  WAITLIST_POSITION_HELP,
  WAITLIST_QUEUE_STAFF_HELP,
} from '../../components/waitlists/waitlistQueueCopy';
import {
  placementsAreComplete,
  syncPlacementsWithMembers,
  toPlacementPayload,
  type WaitlistTeamMemberPlacement,
} from '../../components/waitlists/waitlistTeamRosterShared';

const TEMPORARY_FILL_VACANCIES_HELP =
  'Open temporary spots where a member is on sabbatical and someone else can fill that spot for the session. Staff offer these after permanent vacancies.';

type WaitlistSummary = {
  id: number;
  name: string;
  status: string;
  activeEntryCount: number;
  frozenEntryCount?: number;
  pendingOffers: number;
  attachedLeagues: Array<{
    id: number;
    name: string;
    sessionId: number | null;
    sessionName: string | null;
    capacity: number;
    leagueType: string;
    activeWaitlistEntries: number;
  }>;
};

type WaitlistOffer = {
  id: number;
  offer_type: 'permanent' | 'temporary_sabbatical_fill';
  status: string;
  expires_at: string;
};

type WaitlistOfferResponsePreference = 'ask' | 'auto_accept' | 'auto_decline';

type WaitlistEntry = {
  id: number;
  memberId: number;
  memberName: string;
  memberEmail: string;
  teamRosterText?: string | null;
  team_roster_text?: string | null;
  teamRosterPlacements?: WaitlistTeamMemberPlacement[];
  position: number;
  frozen?: boolean;
  isLifetimeMember?: boolean;
  clubTenureYears?: number;
  declineCount: number;
  offerResponsePreference?: WaitlistOfferResponsePreference;
  offerResponsePreferenceLabel?: string;
  desiredLeagueCount?: number | null;
  priorityRank?: number | null;
  status: string;
  pendingOffer: WaitlistOffer | null;
  acceptedOffer: WaitlistOffer | null;
};

type WaitlistDetail = {
  waitlist: { id: number; name: string; status: string; frozenEntryCount?: number };
  placementLeagueId: number;
  frozenEntryCount?: number;
  attachedLeagues: Array<{
    id: number;
    name: string;
    sessionId: number | null;
    sessionName: string | null;
    leagueType: string;
    capacity: number;
  }>;
  league: {
    id: number;
    name: string;
    capacity: number;
    leagueType: string;
    format: 'teams' | 'doubles' | 'instructional';
    feeMinor: number;
    permanentVacancies: number;
    temporarySabbaticalFillVacancies: number;
    warnings: string[];
  };
  waitlistEntries: WaitlistEntry[];
  roster: Array<{
    id: number;
    memberId: number;
    memberName: string;
    memberEmail: string;
    status: string;
    temporary: boolean;
  }>;
  auditEvents: Array<{
    id: number;
    action: string;
    reason: string | null;
    created_at: string;
    summary: string | null;
    memberName: string | null;
    actorMemberName: string | null;
    teamRosterText: string | null;
    teamRosterDisplay: string | null;
  }>;
};

type ReasonDialogState = {
  title: string;
  description: string;
  confirmText: string;
  variant?: 'danger' | 'primary';
  requireExpiresAt?: boolean;
  onSubmit: (reason: string, options?: { expiresAt?: string }) => Promise<void>;
} | null;

type WaitlistJoinContext = {
  waitlistId: number;
  placementLeagueId: number;
  placementLeague: {
    id: number;
    name: string;
    leagueType: string;
    format: string;
  };
  alreadyOnWaitlist: boolean;
  existingEntryId: number | null;
  usesRegistration: boolean;
  countedLeagues: number;
  requiresByotRoster: boolean;
  expectedByotRosterSize: number | null;
  blockingErrors: string[];
  warnings: string[];
  canJoin: boolean;
};

function formatStatus(value: string): string {
  return value.replace(/_/g, ' ');
}

function toDatetimeLocalValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function ReasonDialog({ state, onClose }: { state: ReasonDialogState; onClose: () => void }) {
  const reasonId = useId();
  const expiresAtId = useId();
  const [reason, setReason] = useState('');
  const [expiresAtLocal, setExpiresAtLocal] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!state) return;
    setReason('');
    if (state.requireExpiresAt) {
      const suggested = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
      setExpiresAtLocal(toDatetimeLocalValue(suggested));
    } else {
      setExpiresAtLocal('');
    }
  }, [state]);

  if (!state) return null;

  const expiresAtIso = expiresAtLocal ? new Date(expiresAtLocal).toISOString() : '';
  const expiresAtValid = !state.requireExpiresAt || (expiresAtLocal !== '' && !Number.isNaN(new Date(expiresAtLocal).getTime()) && new Date(expiresAtLocal).getTime() > Date.now());
  const canSubmit = reason.trim().length > 0 && expiresAtValid && !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await state.onSubmit(reason.trim(), state.requireExpiresAt ? { expiresAt: expiresAtIso } : undefined);
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={state.title} size="md">
      <p className="text-sm text-gray-600 dark:text-gray-300">{state.description}</p>
      {state.requireExpiresAt ? (
        <FormField label="Response deadline" htmlFor={expiresAtId} required className="mt-5">
          <input
            id={expiresAtId}
            type="datetime-local"
            className="app-input"
            value={expiresAtLocal}
            onChange={(event) => setExpiresAtLocal(event.target.value)}
          />
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            If the curler does not accept by this deadline, the offer is treated as declined.
          </p>
        </FormField>
      ) : null}
      <FormField label="Reason" htmlFor={reasonId} required className="mt-5">
        <textarea
          id={reasonId}
          className="app-input min-h-28"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Explain why staff is making this change."
        />
      </FormField>
      <div className="mt-6 flex justify-end gap-3">
        <Button variant="secondary" onClick={onClose} disabled={submitting}>
          Cancel
        </Button>
        <Button
          variant={state.variant === 'danger' ? 'danger' : 'primary'}
          onClick={() => void submit()}
          disabled={!canSubmit}
        >
          {state.confirmText}
        </Button>
      </div>
    </Modal>
  );
}

function waitlistEntryTeamRosterText(entry: WaitlistEntry): string | null {
  const text = entry.teamRosterText ?? entry.team_roster_text ?? null;
  return text?.trim() ? text.trim() : null;
}

function waitlistOfferPreferenceLabel(entry: WaitlistEntry): string {
  if (entry.offerResponsePreferenceLabel) return entry.offerResponsePreferenceLabel;
  switch (entry.offerResponsePreference) {
    case 'auto_accept':
      return 'Accept automatically';
    case 'auto_decline':
      return 'Decline automatically';
    default:
      return 'Ask me';
  }
}

function waitlistEntryHeadline(entry: WaitlistEntry): string {
  const teamRosterText = waitlistEntryTeamRosterText(entry);
  return formatTeamRosterHeadline(teamRosterText) ?? entry.memberName;
}

function waitlistEntryIncludesMember(entry: WaitlistEntry, memberId: number): boolean {
  if (entry.memberId === memberId) return true;
  return (entry.teamRosterPlacements ?? []).some((placement) => placement.memberId === memberId);
}

function teammateIdsFromRosterText(
  rosterText: string,
  entryMemberId: number,
  entryMemberName: string,
  memberOptionIdByName: Map<string, number>,
): number[] {
  const joiningName = entryMemberName.trim().toLowerCase();
  return rosterEntries(rosterText)
    .filter((name) => name.trim().toLowerCase() !== joiningName)
    .map((name) => memberOptionIdByName.get(name.trim().toLowerCase()))
    .filter((memberId): memberId is number => typeof memberId === 'number' && memberId !== entryMemberId);
}

function buildTeamRosterTextFromMembers(
  entryMemberName: string,
  teammateMemberIds: number[],
  memberOptionById: Map<number, { name: string }>,
): string {
  const teammateNames = teammateMemberIds
    .map((memberId) => memberOptionById.get(memberId)?.name)
    .filter((name): name is string => Boolean(name));
  return [entryMemberName, ...teammateNames].filter(Boolean).join('\n');
}

function buildTeamMemberList(
  primary: { memberId: number; memberName: string },
  teammateMemberIds: number[],
  memberOptionById: Map<number, { name: string }>,
): Array<{ memberId: number; memberName: string }> {
  const teammates = teammateMemberIds
    .map((memberId) => {
      const name = memberOptionById.get(memberId)?.name;
      return name ? { memberId, memberName: name } : null;
    })
    .filter((member): member is { memberId: number; memberName: string } => member != null);
  return [primary, ...teammates];
}

function useCanManageWaitlists() {
  const { member } = useAuth();
  return Boolean(
    member &&
      (memberHasScope(member, 'waitlists.manage') || memberHasScope(member, 'admin.manage'))
  );
}

export default function AdminWaitlists() {
  const { waitlistId } = useParams();
  const numericId = waitlistId ? Number(waitlistId) : NaN;
  if (waitlistId && Number.isFinite(numericId)) {
    return <WaitlistDetailPage waitlistId={numericId} />;
  }
  return (
    <AppPage>
      <AppPageHeader
        title="Waitlists"
        description="Browse every league waitlist and see who is in line."
      />
      <WaitlistOverviewPanel />
    </AppPage>
  );
}

export function WaitlistOverviewPanel() {
  const { showAlert } = useAlert();
  const canManage = useCanManageWaitlists();
  const [waitlists, setWaitlists] = useState<WaitlistSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<ReasonDialogState>(null);

  const sessionOptions = useMemo(() => {
    const sessions = new Map<number, string>();
    for (const waitlist of waitlists) {
      for (const league of waitlist.attachedLeagues) {
        if (league.sessionId != null) {
          sessions.set(league.sessionId, league.sessionName ?? `Session #${league.sessionId}`);
        }
      }
    }
    return [...sessions.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [waitlists]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<{ waitlists: WaitlistSummary[] }>('/waitlists');
      setWaitlists(res.data.waitlists);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Unable to load waitlists.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const runAction =
    (
      action: (reason: string, options?: { expiresAt?: string }) => Promise<void>,
      successMessage: string
    ) =>
    async (reason: string, options?: { expiresAt?: string }) => {
      try {
        await action(reason, options);
        await load();
        showAlert(successMessage, 'success');
      } catch (err) {
        showAlert(getApiErrorMessage(err, 'Waitlist action failed.'), 'error');
      }
    };

  return (
    <>
      <AppPageControlsRow
        left={
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Open a waitlist to see who is in line and in what order.
          </p>
        }
        right={
          canManage ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                onClick={() =>
                  setDialog({
                    title: 'Freeze all waitlists',
                    description:
                      'Lock the current order on every waitlist. New joiners will line up below the frozen rows and will not pass anyone already frozen.',
                    confirmText: 'Freeze all',
                    onSubmit: runAction(async (reason) => {
                      await api.post('/waitlists/freeze-all', { reason });
                    }, 'All waitlists frozen.'),
                  })
                }
              >
                Freeze all waitlists
              </Button>
              {sessionOptions.length > 0 ? (
                <Button
                  onClick={() =>
                    setDialog({
                      title: 'Process session vacancies',
                      description:
                        sessionOptions.length === 1
                          ? `Send permanent offers across all leagues with vacancies in ${sessionOptions[0].label}. Members are offered leagues in their priority order, up to the number of leagues they asked to play.`
                          : 'Send permanent offers across all leagues with vacancies in the selected session. Members are offered leagues in their priority order, up to the number of leagues they asked to play.',
                      confirmText: 'Process vacancies',
                      requireExpiresAt: true,
                      onSubmit: runAction(async (reason, options) => {
                        const sessionId = sessionOptions.length === 1 ? sessionOptions[0].value : sessionOptions[0]?.value;
                        if (!sessionId) return;
                        await api.post(`/waitlists/sessions/${sessionId}/process-vacancies`, {
                          offerType: 'permanent',
                          reason,
                          expiresAt: options?.expiresAt,
                        });
                      }, 'Session vacancies processed.'),
                    })
                  }
                >
                  Process session vacancies
                </Button>
              ) : null}
            </div>
          ) : undefined
        }
      />

      {loading ? (
        <AppStateCard title="Loading waitlists" description="Gathering waitlist summaries." />
      ) : error ? (
        <AppStateCard title="Unable to load waitlists" description={error} action={<Button onClick={() => void load()}>Try again</Button>} />
      ) : waitlists.length === 0 ? (
        <AppStateCard
          title="No waitlists yet"
          description="Attach a waitlist from league configuration to start tracking queue entries."
        />
      ) : (
        <div className="app-card">
          <ul className="divide-y divide-gray-200 dark:divide-gray-700">
            {waitlists.map((waitlist) => (
              <li key={waitlist.id}>
                <Link
                  to={`/waitlists/${waitlist.id}`}
                  className="-mx-5 flex items-center justify-between gap-4 px-5 py-3 text-sm transition-colors hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-teal focus-visible:ring-inset dark:hover:bg-gray-700"
                >
                  <span className="font-medium text-gray-900 dark:text-white">{waitlist.name}</span>
                  <span className="shrink-0 text-gray-600 dark:text-gray-400">
                    {waitlist.activeEntryCount}{' '}
                    {waitlist.activeEntryCount === 1 ? 'active entry' : 'active entries'}
                    {waitlist.frozenEntryCount
                      ? ` · ${waitlist.frozenEntryCount} frozen`
                      : ''}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      <ReasonDialog state={dialog} onClose={() => setDialog(null)} />
    </>
  );
}

function WaitlistDetailPage({ waitlistId }: { waitlistId: number }) {
  const { showAlert } = useAlert();
  const { confirm } = useConfirm();
  const { member } = useAuth();
  const memberOptions = useMemberOptions();
  const canManage = useCanManageWaitlists();
  const [data, setData] = useState<WaitlistDetail | null>(null);
  const [orderedEntries, setOrderedEntries] = useState<WaitlistEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<ReasonDialogState>(null);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [addMemberId, setAddMemberId] = useState<number | ''>('');
  const [addReason, setAddReason] = useState('');
  const [addSubmitting, setAddSubmitting] = useState(false);
  const [renameModalOpen, setRenameModalOpen] = useState(false);
  const [renameName, setRenameName] = useState('');
  const [renameSubmitting, setRenameSubmitting] = useState(false);
  const renameNameId = useId();
  const [joinModalOpen, setJoinModalOpen] = useState(false);
  const [joinContext, setJoinContext] = useState<WaitlistJoinContext | null>(null);
  const [joinContextLoading, setJoinContextLoading] = useState(false);
  const [joinContextError, setJoinContextError] = useState<string | null>(null);
  const [joinTeamRosterText, setJoinTeamRosterText] = useState('');
  const [joinSubmitting, setJoinSubmitting] = useState(false);
  const joinTeamRosterId = useId();
  const addTeamRosterId = useId();
  const [joinPlacements, setJoinPlacements] = useState<WaitlistTeamMemberPlacement[]>([]);
  const [editPlacements, setEditPlacements] = useState<WaitlistTeamMemberPlacement[]>([]);
  const [addTeammateIds, setAddTeammateIds] = useState<number[]>([]);
  const [addPlacements, setAddPlacements] = useState<WaitlistTeamMemberPlacement[]>([]);
  const [editEntry, setEditEntry] = useState<WaitlistEntry | null>(null);
  const [editRosterText, setEditRosterText] = useState('');
  const [editReason, setEditReason] = useState('');
  const [editSubmitting, setEditSubmitting] = useState(false);
  const editRosterId = useId();
  const editReasonId = useId();
  const frozenCountId = useId();
  const [frozenCountFieldKey, setFrozenCountFieldKey] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<WaitlistDetail>(`/waitlists/${waitlistId}`);
      setData(res.data);
      setOrderedEntries(res.data.waitlistEntries);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Unable to load waitlist.'));
    } finally {
      setLoading(false);
    }
  }, [waitlistId]);

  useEffect(() => {
    void load();
  }, [load]);

  const runAction = useCallback(
    (
      action: (reason: string, options?: { expiresAt?: string }) => Promise<void>,
      successMessage: string
    ) =>
      async (reason: string, options?: { expiresAt?: string }) => {
        try {
          await action(reason, options);
          showAlert(successMessage, 'success');
          await load();
        } catch (err) {
          showAlert(getApiErrorMessage(err, 'Waitlist action failed.'), 'error');
          throw err;
        }
      },
    [load, showAlert]
  );

  const currentMemberEntry = useMemo(
    () =>
      member ? orderedEntries.find((entry) => waitlistEntryIncludesMember(entry, member.id)) ?? null : null,
    [member, orderedEntries],
  );

  const memberOptionById = useMemo(
    () => new Map(memberOptions.options.map((option) => [option.id, option])),
    [memberOptions.options],
  );
  const memberOptionIdByName = useMemo(
    () => new Map(memberOptions.options.map((option) => [option.name.trim().toLowerCase(), option.id])),
    [memberOptions.options],
  );
  const joiningMemberName = member?.name ?? 'You';

  const joinTeamRosterMemberIds = useMemo(
    () =>
      member
        ? teammateIdsFromRosterText(joinTeamRosterText, member.id, joiningMemberName, memberOptionIdByName)
        : [],
    [joinTeamRosterText, joiningMemberName, member, memberOptionIdByName],
  );

  const joinByotRosterComplete = useMemo(() => {
    if (!joinContext?.requiresByotRoster) return true;
    return placementsAreComplete(joinPlacements, joinContext.expectedByotRosterSize);
  }, [joinContext, joinPlacements]);

  const updateJoinTeamRosterMembers = (memberIds: number[]) => {
    if (!member) return;
    setJoinTeamRosterText(buildTeamRosterTextFromMembers(joiningMemberName, memberIds, memberOptionById));
    const members = buildTeamMemberList(
      { memberId: member.id, memberName: joiningMemberName },
      memberIds,
      memberOptionById,
    );
    setJoinPlacements((current) => syncPlacementsWithMembers(members, current));
  };

  const requiresByotRoster = data?.league.leagueType === 'bring_your_own_team';
  const expectedByotSize = data ? expectedByotRosterSize({ format: data.league.format }) : null;

  const editTeammateIds = useMemo(
    () =>
      editEntry
        ? teammateIdsFromRosterText(
            editRosterText,
            editEntry.memberId,
            editEntry.memberName,
            memberOptionIdByName,
          )
        : [],
    [editEntry, editRosterText, memberOptionIdByName],
  );

  const editByotRosterComplete = useMemo(() => {
    if (!requiresByotRoster || !editEntry) return true;
    return placementsAreComplete(editPlacements, expectedByotSize);
  }, [editEntry, editPlacements, expectedByotSize, requiresByotRoster]);

  const addMemberName =
    typeof addMemberId === 'number' ? memberOptionById.get(addMemberId)?.name ?? '' : '';

  const addByotRosterComplete = useMemo(() => {
    if (!requiresByotRoster) return true;
    return placementsAreComplete(addPlacements, expectedByotSize);
  }, [addPlacements, expectedByotSize, requiresByotRoster]);

  useEffect(() => {
    if (typeof addMemberId !== 'number') {
      setAddTeammateIds([]);
      setAddPlacements([]);
      return;
    }
    const name = memberOptionById.get(addMemberId)?.name;
    if (!name) return;
    setAddTeammateIds([]);
    setAddPlacements([{ memberId: addMemberId, memberName: name }]);
  }, [addMemberId, memberOptionById]);

  const openEditEntryModal = (entry: WaitlistEntry) => {
    setEditEntry(entry);
    setEditRosterText(waitlistEntryTeamRosterText(entry) ?? entry.memberName);
    const initialPlacements =
      entry.teamRosterPlacements ??
      syncPlacementsWithMembers(
        buildTeamMemberList(
          { memberId: entry.memberId, memberName: entry.memberName },
          teammateIdsFromRosterText(
            waitlistEntryTeamRosterText(entry) ?? entry.memberName,
            entry.memberId,
            entry.memberName,
            memberOptionIdByName,
          ),
          memberOptionById,
        ),
        [],
      );
    setEditPlacements(initialPlacements);
    setEditReason('');
  };

  const updateEditRosterMembers = (memberIds: number[]) => {
    if (!editEntry) return;
    setEditRosterText(buildTeamRosterTextFromMembers(editEntry.memberName, memberIds, memberOptionById));
    const members = buildTeamMemberList(
      { memberId: editEntry.memberId, memberName: editEntry.memberName },
      memberIds,
      memberOptionById,
    );
    setEditPlacements((current) => syncPlacementsWithMembers(members, current));
  };

  const updateAddTeamRosterMembers = (memberIds: number[]) => {
    if (typeof addMemberId !== 'number' || !addMemberName) return;
    setAddTeammateIds(memberIds);
    const members = buildTeamMemberList(
      { memberId: addMemberId, memberName: addMemberName },
      memberIds,
      memberOptionById,
    );
    setAddPlacements((current) => syncPlacementsWithMembers(members, current));
  };

  const submitEditEntry = async () => {
    if (!editEntry || !editReason.trim()) return;
    if (requiresByotRoster && !editByotRosterComplete) {
      showAlert('Add every team member before saving.', 'warning');
      return;
    }
    setEditSubmitting(true);
    try {
      await api.patch(`/waitlists/entries/${editEntry.id}`, {
        ...(requiresByotRoster ? { teamRosterPlacements: toPlacementPayload(editPlacements) } : {}),
        reason: editReason.trim(),
      });
      showAlert('Waitlist entry updated.', 'success');
      setEditEntry(null);
      await load();
    } catch (err) {
      showAlert(getApiErrorMessage(err, 'Unable to update waitlist entry.'), 'error');
    } finally {
      setEditSubmitting(false);
    }
  };

  const openJoinModal = useCallback(async () => {
    setJoinModalOpen(true);
    setJoinContextLoading(true);
    setJoinContextError(null);
    setJoinTeamRosterText('');
    setJoinPlacements(member ? [{ memberId: member.id, memberName: joiningMemberName }] : []);
    try {
      const res = await api.get<WaitlistJoinContext>(`/waitlists/${waitlistId}/join-context`);
      setJoinContext(res.data);
    } catch (err) {
      setJoinContextError(getApiErrorMessage(err, 'Unable to load waitlist join options.'));
      setJoinContext(null);
    } finally {
      setJoinContextLoading(false);
    }
  }, [waitlistId]);

  const submitJoinWaitlist = async () => {
    if (!joinContext) return;
    if (joinContext.requiresByotRoster && !joinByotRosterComplete) {
      showAlert('Add every team member before joining.', 'warning');
      return;
    }
    setJoinSubmitting(true);
    try {
      await api.post(`/waitlists/${waitlistId}/join`, {
        ...(joinContext.requiresByotRoster
          ? { teamRosterPlacements: toPlacementPayload(joinPlacements) }
          : {}),
      });
      showAlert('You have joined the waitlist.', 'success');
      setJoinModalOpen(false);
      await load();
    } catch (err) {
      showAlert(getApiErrorMessage(err, 'Unable to join waitlist.'), 'error');
    } finally {
      setJoinSubmitting(false);
    }
  };

  const leaveWaitlist = async () => {
    if (!currentMemberEntry) return;
    const isByot = data?.league.leagueType === 'bring_your_own_team';
    const confirmed = await confirm({
      title: 'Leave waitlist?',
      message: isByot
        ? 'Leaving will remove the entire team from this waitlist. Everyone on the roster will get an email, and the team will lose its position.'
        : 'You will lose your position on this waitlist. If you join again later, you will be placed with other unfrozen entries according to club tenure.',
      confirmText: 'Leave waitlist',
      cancelText: 'Keep my position',
      variant: 'danger',
    });
    if (!confirmed) return;
    try {
      await api.post(`/registration/member/waitlist-entries/${currentMemberEntry.id}/remove`, {});
      showAlert('You have been removed from the waitlist.', 'success');
      await load();
    } catch (err) {
      showAlert(getApiErrorMessage(err, 'Unable to leave waitlist.'), 'error');
    }
  };

  const openRenameModal = () => {
    if (!data) return;
    setRenameName(data.waitlist.name);
    setRenameModalOpen(true);
  };

  const submitRename = async () => {
    const name = renameName.trim();
    if (!name) {
      showAlert('Enter a waitlist name.', 'warning');
      return;
    }
    setRenameSubmitting(true);
    try {
      await api.patch(`/waitlists/${waitlistId}`, { name });
      showAlert('Waitlist renamed.', 'success');
      setRenameModalOpen(false);
      await load();
    } catch (err) {
      showAlert(getApiErrorMessage(err, 'Unable to rename waitlist.'), 'error');
    } finally {
      setRenameSubmitting(false);
    }
  };

  const frozenCount = data?.frozenEntryCount ?? data?.waitlist.frozenEntryCount ?? 0;

  const handleReorder = async (
    nextEntries: WaitlistEntry[],
    meta: { activeIndex: number; overIndex: number },
  ) => {
    if (!canManage || !data) return;
    const previousIds = orderedEntries.map((entry) => entry.id);
    const nextIds = nextEntries.map((entry) => entry.id);
    if (previousIds.join(',') === nextIds.join(',')) return;
    const nextFrozen = nextFrozenCountAfterMove({
      frozenCount,
      activeIndex: meta.activeIndex,
      overIndex: meta.overIndex,
      total: nextEntries.length,
    });

    setDialog({
      title: 'Save queue order',
      description: 'Reorder the active waitlist queue. Frozen rows keep their locked places; unfrozen rows stay sorted by tenure unless you move them into the frozen set.',
      confirmText: 'Save order',
      onSubmit: runAction(async (reason) => {
        await api.post(`/waitlists/${waitlistId}/entries/reorder`, {
          entryIds: nextIds,
          frozenEntryCount: nextFrozen,
          reason,
        });
        setOrderedEntries(
          nextEntries.map((entry, index) => ({
            ...entry,
            position: index + 1,
            frozen: index < nextFrozen,
          })),
        );
      }, 'Waitlist order saved.'),
    });
  };

  const submitAddEntry = async () => {
    if (!data || addMemberId === '' || !addReason.trim()) return;
    if (requiresByotRoster && !addByotRosterComplete) {
      showAlert('Add every team member before saving.', 'warning');
      return;
    }
    setAddSubmitting(true);
    try {
      await api.post(`/waitlists/${waitlistId}/entries`, {
        placementLeagueId: data.placementLeagueId,
        memberId: addMemberId,
        ...(requiresByotRoster ? { teamRosterPlacements: toPlacementPayload(addPlacements) } : {}),
        reason: addReason.trim(),
      });
      showAlert('Waitlist entry added.', 'success');
      setAddModalOpen(false);
      setAddMemberId('');
      setAddReason('');
      await load();
    } catch (err) {
      showAlert(getApiErrorMessage(err, 'Unable to add waitlist entry.'), 'error');
    } finally {
      setAddSubmitting(false);
    }
  };

  if (loading) {
    return (
      <>
        <AppPage>
          <AppStateCard title="Loading waitlist" description="Gathering queue entries, placements, and audit history." />
        </AppPage>
      </>
    );
  }

  if (error || !data) {
    return (
      <>
        <AppPage>
          <AppStateCard
            title="Unable to load waitlist"
            description={error ?? 'Waitlist was not found.'}
            action={<Button onClick={() => void load()}>Try again</Button>}
          />
        </AppPage>
      </>
    );
  }

  return (
    <>
      <AppPage>
        <AppPageHeader
          title={data.waitlist.name}
          description="See who is on this waitlist and in what order. Club tenure decides unfrozen order until staff freeze the list."
          actions={
            <>
              <BackButton label="All waitlists" to="/waitlists?tab=all" />
              {member && !currentMemberEntry ? (
                <Button onClick={() => void openJoinModal()}>Join waitlist</Button>
              ) : null}
              {currentMemberEntry ? (
                <Button variant="danger" onClick={() => void leaveWaitlist()}>
                  Leave waitlist
                </Button>
              ) : null}
              {canManage ? (
                <Button variant="secondary" onClick={openRenameModal}>
                  Rename
                </Button>
              ) : null}
            </>
          }
        />

        <div className="grid gap-4 md:grid-cols-2">
          <div className="app-card">
            <p className="text-sm text-gray-500 dark:text-gray-400">Active entries</p>
            <p className="mt-2 text-3xl font-semibold text-gray-900 dark:text-white">{orderedEntries.length}</p>
          </div>
          <div className="app-card">
            <div className="flex items-center gap-1.5">
              <p className="text-sm text-gray-500 dark:text-gray-400">Temporary fill vacancies</p>
              <HelpCallout
                text={TEMPORARY_FILL_VACANCIES_HELP}
                label="About temporary fill vacancies"
                align="end"
              />
            </div>
            <p className="mt-2 text-3xl font-semibold text-gray-900 dark:text-white">{data.league.temporarySabbaticalFillVacancies}</p>
          </div>
        </div>

        {canManage ? (
          <AppPageControlsRow
            left={
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Drag frozen rows to reorder them, or drag across the frozen boundary. Unfrozen rows stay sorted by tenure.
              </p>
            }
            right={
              <>
                <Button
                  variant="secondary"
                  onClick={() =>
                    setDialog({
                      title: 'Freeze this waitlist',
                      description:
                        'Lock the current order. Anyone already on the list keeps their place; later joiners line up below them by tenure.',
                      confirmText: 'Freeze waitlist',
                      onSubmit: runAction(async (reason) => {
                        await api.post(`/waitlists/${waitlistId}/freeze`, { reason });
                      }, 'Waitlist frozen.'),
                    })
                  }
                >
                  Freeze waitlist
                </Button>
                <Button onClick={() => setAddModalOpen(true)}>Add member</Button>
                <Button
                  onClick={() =>
                    setDialog({
                      title: 'Send permanent offer',
                      description:
                        'Send one permanent spot offer to the top eligible active waitlist entry. Choose when the offer should expire if the curler does not respond.',
                      confirmText: 'Send offer',
                      requireExpiresAt: true,
                      onSubmit: runAction(
                        (reason, options) =>
                          api.post(`/waitlists/${waitlistId}/offers`, {
                            placementLeagueId: data.placementLeagueId,
                            offerType: 'permanent',
                            count: 1,
                            reason,
                            expiresAt: options?.expiresAt,
                          }),
                        'Permanent offer sent.'
                      ),
                    })
                  }
                >
                  Send permanent offer
                </Button>
              </>
            }
          />
        ) : null}

        <section className="app-card">
          <h2 className="app-section-title">Queue</h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            {canManage ? WAITLIST_QUEUE_STAFF_HELP : WAITLIST_POSITION_HELP}
          </p>
          {canManage ? (
            <div className="mt-4 max-w-xs">
              <FormField
                label="Frozen entries"
                htmlFor={frozenCountId}
                helperText="First this many rows stay locked. Changing this number requires a reason."
              >
                <input
                  id={frozenCountId}
                  type="number"
                  min={0}
                  max={orderedEntries.length}
                  className="app-input"
                  defaultValue={frozenCount}
                  key={`frozen-${frozenCount}-${orderedEntries.length}-${frozenCountFieldKey}`}
                  onBlur={(event) => {
                    const next = Number(event.target.value);
                    if (!Number.isInteger(next) || next === frozenCount) return;
                    if (next < 0 || next > orderedEntries.length) {
                      showAlert(`Frozen entries must be between 0 and ${orderedEntries.length}.`, 'warning');
                      event.target.value = String(frozenCount);
                      return;
                    }
                    setDialog({
                      title: 'Change frozen count',
                      description:
                        next > frozenCount
                          ? 'The current top unfrozen entries will be locked into the frozen set in tenure order.'
                          : 'The last frozen entries will return to the unfrozen set and sort by tenure.',
                      confirmText: 'Save frozen count',
                      onSubmit: runAction(async (reason) => {
                        await api.post(`/waitlists/${waitlistId}/frozen-count`, {
                          frozenEntryCount: next,
                          reason,
                        });
                      }, 'Frozen count updated.'),
                    });
                  }}
                />
              </FormField>
            </div>
          ) : null}
          {orderedEntries.length === 0 ? (
            <p className="mt-4 text-sm text-gray-500">No active waitlist entries.</p>
          ) : canManage ? (
            <div className="mt-4">
              <SortableList
                items={orderedEntries}
                getId={(entry) => entry.id}
                getItemLabel={(entry) => waitlistEntryHeadline(entry)}
                canDropOnItem={(_active, _over, activeIndex, overIndex) =>
                  !(activeIndex >= frozenCount && overIndex >= frozenCount)
                }
                onReorder={(next, meta) => void handleReorder(next, meta)}
                itemClassName="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-900"
                renderBeforeItem={(_item, index) =>
                  frozenCount > 0 && index === frozenCount ? <WaitlistUnfrozenBoundaryLabel /> : null
                }
                renderItem={({ item, index, dragHandle }) => (
                  <WaitlistEntryRow
                    entry={item}
                    index={index}
                    frozen={index < frozenCount}
                    dragHandle={dragHandle}
                    canManage={canManage}
                    onEdit={() => openEditEntryModal(item)}
                    onAction={(state) => setDialog(state)}
                    runAction={runAction}
                  />
                )}
              />
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              {orderedEntries.map((entry, index) => (
                <Fragment key={entry.id}>
                  {frozenCount > 0 && index === frozenCount ? <WaitlistUnfrozenBoundaryLabel /> : null}
                  <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                    <WaitlistEntryRow
                      entry={entry}
                      index={index}
                      frozen={index < frozenCount}
                      canManage={false}
                      onAction={() => {}}
                      runAction={runAction}
                    />
                  </div>
                </Fragment>
              ))}
            </div>
          )}
        </section>

        <section className="app-card">
          <h2 className="app-section-title">Audit history</h2>
          <div className="mt-4 max-h-96 space-y-3 overflow-y-auto">
            {data.auditEvents.length ? (
              data.auditEvents.map((event) => (
                <div key={event.id} className="rounded-lg border border-gray-200 p-3 text-sm dark:border-gray-700">
                  <div className="font-medium text-gray-900 dark:text-white">
                    {event.summary ?? formatStatus(event.action)}
                  </div>
                  {event.reason && event.reason !== event.summary ? (
                    <p className="mt-1 text-gray-600 dark:text-gray-300">{event.reason}</p>
                  ) : null}
                  <p className="mt-1 text-xs text-gray-500">{new Date(event.created_at).toLocaleString()}</p>
                </div>
              ))
            ) : (
              <p className="text-sm text-gray-500">No audit events yet.</p>
            )}
          </div>
        </section>

        <ReasonDialog
          state={dialog}
          onClose={() => {
            setDialog(null);
            setFrozenCountFieldKey((key) => key + 1);
          }}
        />

        <Modal isOpen={renameModalOpen} onClose={() => setRenameModalOpen(false)} title="Rename waitlist" size="md">
          <div className="space-y-4">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Updates the display name everywhere this waitlist is referenced, including league configuration and the waitlist list.
            </p>
            <FormField label="Waitlist name" htmlFor={renameNameId} required>
              <input
                id={renameNameId}
                type="text"
                className="app-input"
                value={renameName}
                onChange={(event) => setRenameName(event.target.value)}
                required
              />
            </FormField>
            <div className="flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setRenameModalOpen(false)} disabled={renameSubmitting}>
                Cancel
              </Button>
              <Button onClick={() => void submitRename()} disabled={renameSubmitting || !renameName.trim()}>
                Save name
              </Button>
            </div>
          </div>
        </Modal>

        <Modal
          isOpen={joinModalOpen}
          onClose={() => setJoinModalOpen(false)}
          title="Join waitlist"
          size={joinContext?.requiresByotRoster ? 'lg' : 'md'}
        >
          <div className="space-y-4">
            {joinContextLoading ? (
              <p className="text-sm text-gray-600 dark:text-gray-300">Loading join options…</p>
            ) : joinContextError ? (
              <p className="text-sm text-red-700 dark:text-red-300">{joinContextError}</p>
            ) : joinContext ? (
              <>
                <p className="text-sm text-gray-600 dark:text-gray-300">
                  Join the waitlist for {joinContext.placementLeague.name}.
                  {joinContext.requiresByotRoster ? ' Add your full team to the entry.' : ''}
                </p>
                {!joinContext.usesRegistration ? (
                  <p className="text-sm text-gray-600 dark:text-gray-300">
                    League limits are based on your current session roster.
                  </p>
                ) : null}
                {joinContext.warnings.length > 0 ? (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100">
                    {joinContext.warnings.join(' ')}
                  </div>
                ) : null}
                {joinContext.blockingErrors.length > 0 ? (
                  <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200">
                    {joinContext.blockingErrors.join(' ')}
                  </div>
                ) : null}
                {joinContext.requiresByotRoster ? (
                  <>
                    <FormField label="Team roster" htmlFor={joinTeamRosterId} required>
                      <MemberMultiSelect
                        inputId={joinTeamRosterId}
                        selectedIds={joinTeamRosterMemberIds}
                        onChange={updateJoinTeamRosterMembers}
                        maxSelections={
                          joinContext.expectedByotRosterSize
                            ? Math.max(joinContext.expectedByotRosterSize - 1, 0)
                            : undefined
                        }
                        placeholder="Search members..."
                        filterOption={(option) => option.id !== member?.id}
                        lockedPills={[
                          {
                            key: 'joining-member',
                            label: joiningMemberName,
                          },
                        ]}
                      />
                    </FormField>
                  </>
                ) : null}
              </>
            ) : null}
            <div className="flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setJoinModalOpen(false)} disabled={joinSubmitting}>
                Cancel
              </Button>
              <Button
                onClick={() => void submitJoinWaitlist()}
                disabled={
                  joinSubmitting ||
                  joinContextLoading ||
                  !joinContext ||
                  !joinContext.canJoin ||
                  !joinByotRosterComplete
                }
              >
                Join waitlist
              </Button>
            </div>
          </div>
        </Modal>

        <Modal
          isOpen={editEntry !== null}
          onClose={() => setEditEntry(null)}
          title="Edit waitlist entry"
          size={requiresByotRoster ? 'lg' : 'md'}
        >
          {editEntry ? (
            <div className="space-y-4">
              <p className="text-sm text-gray-600 dark:text-gray-300">
                {`Update ${editEntry.memberName}'s waitlist entry.`}
              </p>
              {requiresByotRoster ? (
                <>
                  <FormField label="Team roster" htmlFor={editRosterId} required>
                    <MemberMultiSelect
                      inputId={editRosterId}
                      selectedIds={editTeammateIds}
                      onChange={updateEditRosterMembers}
                      maxSelections={expectedByotSize ? Math.max(expectedByotSize - 1, 0) : undefined}
                      placeholder="Search members..."
                      filterOption={(option) => option.id !== editEntry.memberId}
                      lockedPills={[
                        {
                          key: 'entry-member',
                          label: editEntry.memberName,
                        },
                      ]}
                    />
                  </FormField>
                </>
              ) : null}
              <FormField label="Reason" htmlFor={editReasonId} required>
                <textarea
                  id={editReasonId}
                  className="app-input min-h-24"
                  value={editReason}
                  onChange={(event) => setEditReason(event.target.value)}
                  placeholder="Explain why staff is making this change."
                />
              </FormField>
              <div className="flex justify-end gap-3">
                <Button variant="secondary" onClick={() => setEditEntry(null)} disabled={editSubmitting}>
                  Cancel
                </Button>
                <Button
                  onClick={() => void submitEditEntry()}
                  disabled={
                    editSubmitting || !editReason.trim() || !editByotRosterComplete
                  }
                >
                  Save changes
                </Button>
              </div>
            </div>
          ) : null}
        </Modal>

        <Modal
          isOpen={addModalOpen}
          onClose={() => setAddModalOpen(false)}
          title="Add waitlist entry"
          size={requiresByotRoster ? 'lg' : 'md'}
        >
          <div className="space-y-4">
            <FormField label="Member" htmlFor="waitlistAddMember">
              <MemberAutocomplete inputId="waitlistAddMember" value={addMemberId} onChange={setAddMemberId} />
            </FormField>
            {requiresByotRoster && typeof addMemberId === 'number' && addMemberName ? (
              <>
                <FormField label="Team roster" htmlFor={addTeamRosterId} required>
                  <MemberMultiSelect
                    inputId={addTeamRosterId}
                    selectedIds={addTeammateIds}
                    onChange={updateAddTeamRosterMembers}
                    maxSelections={expectedByotSize ? Math.max(expectedByotSize - 1, 0) : undefined}
                    placeholder="Search members..."
                    filterOption={(option) => option.id !== addMemberId}
                    lockedPills={[
                      {
                        key: 'entry-member',
                        label: addMemberName,
                      },
                    ]}
                  />
                </FormField>
              </>
            ) : null}
            <FormField label="Reason" htmlFor="waitlistAddReason" required>
              <textarea
                id="waitlistAddReason"
                className="app-input min-h-24"
                value={addReason}
                onChange={(event) => setAddReason(event.target.value)}
              />
            </FormField>
            <div className="flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setAddModalOpen(false)} disabled={addSubmitting}>
                Cancel
              </Button>
              <Button
                onClick={() => void submitAddEntry()}
                disabled={
                  addSubmitting ||
                  addMemberId === '' ||
                  !addReason.trim() ||
                  (requiresByotRoster && !addByotRosterComplete)
                }
              >
                Add entry
              </Button>
            </div>
          </div>
        </Modal>
      </AppPage>
    </>
  );
}

function WaitlistUnfrozenBoundaryLabel() {
  return (
    <p className="px-1 py-1 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
      Unfrozen · sorted by club tenure
    </p>
  );
}

function WaitlistEntryRow({
  entry,
  index,
  frozen = false,
  dragHandle,
  canManage,
  onEdit,
  onAction,
  runAction,
}: {
  entry: WaitlistEntry;
  index: number;
  frozen?: boolean;
  dragHandle?: React.ReactNode;
  canManage: boolean;
  onEdit?: () => void;
  onAction: (state: ReasonDialogState) => void;
  runAction: (
    action: (reason: string, options?: { expiresAt?: string }) => Promise<void>,
    successMessage: string
  ) => (reason: string, options?: { expiresAt?: string }) => Promise<void>;
}) {
  const headline = waitlistEntryHeadline(entry);

  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="flex min-w-0 flex-1 gap-3">
          {dragHandle}
          <div className="min-w-0">
          <p className="font-medium text-gray-900 dark:text-white">
            {index + 1}. {headline}
            {frozen ? (
              <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-normal text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                Frozen
              </span>
            ) : null}
            {entry.isLifetimeMember ? (
              <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-normal text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">
                Lifetime
              </span>
            ) : null}
          </p>
          <p className="mt-1 text-xs text-gray-500">
            If a spot opens: {waitlistOfferPreferenceLabel(entry)}
          </p>
          {entry.priorityRank != null ? (
            <p className="mt-1 text-xs text-gray-500">
              Waitlist preference {entry.priorityRank}
              {entry.desiredLeagueCount != null
                ? ` · wants up to ${entry.desiredLeagueCount} ${entry.desiredLeagueCount === 1 ? 'league' : 'leagues'}`
                : ''}
            </p>
          ) : null}
          {entry.pendingOffer ? (
            <p className="mt-1 text-xs text-gray-500">
              Pending {formatStatus(entry.pendingOffer.offer_type)} offer
            </p>
          ) : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
        {canManage ? (
          <>
            {onEdit ? (
              <Button variant="secondary" className="px-3 py-1.5" onClick={onEdit}>
                Edit
              </Button>
            ) : null}
            {entry.pendingOffer ? (
              <>
                <Button
                  className="px-3 py-1.5"
                  onClick={() =>
                    onAction({
                      title: 'Mark offer accepted',
                      description: 'Place the member according to the pending offer.',
                      confirmText: 'Mark accepted',
                      onSubmit: runAction(
                        (reason) => api.post(`/waitlists/offers/${entry.pendingOffer?.id}/accept`, { reason }),
                        'Offer accepted.'
                      ),
                    })
                  }
                >
                  Accept
                </Button>
                <Button
                  variant="secondary"
                  className="px-3 py-1.5"
                  onClick={() =>
                    onAction({
                      title: 'Mark offer declined',
                      description: 'Apply decline rules for this waitlist entry.',
                      confirmText: 'Mark declined',
                      variant: 'danger',
                      onSubmit: runAction(
                        (reason) => api.post(`/waitlists/offers/${entry.pendingOffer?.id}/decline`, { reason }),
                        'Offer declined.'
                      ),
                    })
                  }
                >
                  Decline
                </Button>
              </>
            ) : null}
            <Button
              variant="outline-danger"
              className="px-3 py-1.5"
              onClick={() =>
                onAction({
                  title: 'Remove waitlist entry',
                  description: 'Remove this member from the active waitlist.',
                  confirmText: 'Remove',
                  variant: 'danger',
                  onSubmit: runAction(
                    (reason) => api.delete(`/waitlists/entries/${entry.id}`, { data: { reason } }),
                    'Waitlist entry removed.'
                  ),
                })
              }
            >
              Remove
            </Button>
          </>
        ) : null}
        </div>
    </div>
  );
}
