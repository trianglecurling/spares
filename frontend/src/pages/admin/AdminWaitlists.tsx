import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AppPage, AppPageHeader } from '../../components/AppPage';
import AppStateCard from '../../components/AppStateCard';
import AppPageControlsRow from '../../components/AppPageControlsRow';
import Button from '../../components/Button';
import FormField from '../../components/FormField';
import Modal from '../../components/Modal';
import MemberAutocomplete from '../../components/MemberAutocomplete';
import MemberMultiSelect from '../../components/MemberMultiSelect';
import ChoiceInput, { type ChoiceOption } from '../../components/ChoiceInput';
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
import InlineStateMessage from '../../components/InlineStateMessage';
import WaitlistTeamRosterPlacementsEditor from '../../components/waitlists/WaitlistTeamRosterPlacementsEditor';
import {
  placementsAreComplete,
  syncPlacementsWithMembers,
  toPlacementPayload,
  type WaitlistTeamMemberPlacement,
  type WaitlistTeamMemberPlacementOptions,
} from '../../components/waitlists/waitlistTeamRosterShared';

const PERMANENT_VACANCIES_HELP =
  'Open permanent spots at the selected placement league. Calculated from league capacity minus permanent placements and members currently on sabbatical.';

const TEMPORARY_FILL_VACANCIES_HELP =
  'Open temporary spots where a member is on sabbatical and someone else can fill that spot for the session. Staff offer these after permanent vacancies.';

type WaitlistSummary = {
  id: number;
  name: string;
  status: string;
  activeEntryCount: number;
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
  entryType: 'add' | 'replace';
  replacesLeagueId: number | null;
  teamRosterText?: string | null;
  team_roster_text?: string | null;
  teamRosterPlacements?: WaitlistTeamMemberPlacement[];
  position: number;
  declineCount: number;
  offerResponsePreference?: WaitlistOfferResponsePreference;
  offerResponsePreferenceLabel?: string;
  desiredAddWaitlistLeagueCount?: number | null;
  addWaitlistPriorityRank?: number | null;
  status: string;
  pendingOffer: WaitlistOffer | null;
  acceptedOffer: WaitlistOffer | null;
};

type WaitlistDetail = {
  waitlist: { id: number; name: string; status: string };
  placementLeagueId: number;
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

const ENTRY_TYPE_OPTIONS: ChoiceOption<'add' | 'replace'>[] = [
  { value: 'add', label: 'Add as an additional league' },
  { value: 'replace', label: 'Replace an existing league' },
];

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
  addAvailable: boolean;
  addBlockedReason: string | null;
  replacementLeagues: Array<{ id: number; name: string; format: string }>;
  activeReplaceWaitlists: number;
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

function waitlistTeammateContactMessage(primaryMemberName: string): string {
  return `You are on this waitlist because you were listed as a team member by ${primaryMemberName}. If you need to leave this waitlist or change your entry, please contact ${primaryMemberName}.`;
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
  return <WaitlistListPage />;
}

function WaitlistListPage() {
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
      <AppPage>
        <AppPageHeader
          title="Waitlists"
          description="View the current waiting lists for each league below."
          actions={
            canManage && sessionOptions.length > 0 ? (
              <Button
                onClick={() =>
                  setDialog({
                    title: 'Process session vacancies',
                    description:
                      sessionOptions.length === 1
                        ? `Send permanent offers across all leagues with vacancies in ${sessionOptions[0].label}. Members with ranked ADD waitlist preferences will only receive offers up to their chosen limit.`
                        : 'Send permanent offers across all leagues with vacancies in the selected session. Members with ranked ADD waitlist preferences will only receive offers up to their chosen limit.',
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
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
        <ReasonDialog state={dialog} onClose={() => setDialog(null)} />
      </AppPage>
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
  const [addEntryType, setAddEntryType] = useState<'add' | 'replace'>('add');
  const [addReplacesLeagueId, setAddReplacesLeagueId] = useState<number | null>(null);
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
  const [joinEntryType, setJoinEntryType] = useState<'add' | 'replace'>('add');
  const [joinReplacesLeagueId, setJoinReplacesLeagueId] = useState<number | null>(null);
  const [joinTeamRosterText, setJoinTeamRosterText] = useState('');
  const [joinSubmitting, setJoinSubmitting] = useState(false);
  const joinEntryTypeId = useId();
  const joinReplacesLeagueIdField = useId();
  const joinTeamRosterId = useId();
  const addTeamRosterId = useId();
  const [joinPlacements, setJoinPlacements] = useState<WaitlistTeamMemberPlacement[]>([]);
  const [editPlacements, setEditPlacements] = useState<WaitlistTeamMemberPlacement[]>([]);
  const [addTeammateIds, setAddTeammateIds] = useState<number[]>([]);
  const [addPlacements, setAddPlacements] = useState<WaitlistTeamMemberPlacement[]>([]);
  const [placementOptionsByMemberId, setPlacementOptionsByMemberId] = useState<
    Record<number, WaitlistTeamMemberPlacementOptions>
  >({});
  const [editEntry, setEditEntry] = useState<WaitlistEntry | null>(null);
  const [editEntryType, setEditEntryType] = useState<'add' | 'replace'>('add');
  const [editReplacesLeagueId, setEditReplacesLeagueId] = useState<number | null>(null);
  const [editRosterText, setEditRosterText] = useState('');
  const [editReason, setEditReason] = useState('');
  const [editSubmitting, setEditSubmitting] = useState(false);
  const editEntryTypeId = useId();
  const editReplacesLeagueIdField = useId();
  const editRosterId = useId();
  const editReasonId = useId();

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

  const currentMemberTeammateEntry = useMemo(() => {
    if (!member || !currentMemberEntry || currentMemberEntry.memberId === member.id) return null;
    return currentMemberEntry;
  }, [member, currentMemberEntry]);

  const currentMemberPrimaryEntry = useMemo(() => {
    if (!member || !currentMemberEntry || currentMemberEntry.memberId !== member.id) return null;
    return currentMemberEntry;
  }, [member, currentMemberEntry]);

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

  const loadPlacementOptions = useCallback(
    async (memberIds: number[]) => {
      const uniqueMemberIds = [...new Set(memberIds)];
      if (uniqueMemberIds.length === 0) {
        setPlacementOptionsByMemberId({});
        return;
      }
      try {
        const res = await api.get<Record<number, WaitlistTeamMemberPlacementOptions>>(
          `/waitlists/${waitlistId}/team-member-placement-options`,
          { params: { memberIds: uniqueMemberIds.join(',') } },
        );
        setPlacementOptionsByMemberId(res.data);
      } catch {
        setPlacementOptionsByMemberId({});
      }
    },
    [waitlistId],
  );

  const updateJoinTeamRosterMembers = (memberIds: number[]) => {
    if (!member) return;
    setJoinTeamRosterText(buildTeamRosterTextFromMembers(joiningMemberName, memberIds, memberOptionById));
    const members = buildTeamMemberList(
      { memberId: member.id, memberName: joiningMemberName },
      memberIds,
      memberOptionById,
    );
    setJoinPlacements((current) => syncPlacementsWithMembers(members, current));
    void loadPlacementOptions(members.map((entry) => entry.memberId));
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
    if (!joinModalOpen || !joinContext?.requiresByotRoster) return;
    const memberIds = joinPlacements.map((placement) => placement.memberId);
    if (memberIds.length > 0) {
      void loadPlacementOptions(memberIds);
    }
  }, [joinContext?.requiresByotRoster, joinModalOpen, joinPlacements, loadPlacementOptions]);

  useEffect(() => {
    if (typeof addMemberId !== 'number') {
      setAddTeammateIds([]);
      setAddPlacements([]);
      return;
    }
    const name = memberOptionById.get(addMemberId)?.name;
    if (!name) return;
    setAddTeammateIds([]);
    setAddPlacements([
      {
        memberId: addMemberId,
        memberName: name,
        entryType: 'add',
        replacesLeagueId: null,
      },
    ]);
    void loadPlacementOptions([addMemberId]);
  }, [addMemberId, loadPlacementOptions, memberOptionById]);

  const openEditEntryModal = (entry: WaitlistEntry) => {
    setEditEntry(entry);
    setEditEntryType(entry.entryType);
    setEditReplacesLeagueId(entry.replacesLeagueId);
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
    void loadPlacementOptions(initialPlacements.map((placement) => placement.memberId));
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
    void loadPlacementOptions(members.map((entry) => entry.memberId));
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
    void loadPlacementOptions(members.map((entry) => entry.memberId));
  };

  const submitEditEntry = async () => {
    if (!editEntry || !editReason.trim()) return;
    if (!requiresByotRoster && editEntryType === 'replace' && editReplacesLeagueId == null) {
      showAlert('Select the league being replaced for a REPLACE entry.', 'warning');
      return;
    }
    if (requiresByotRoster && !editByotRosterComplete) {
      showAlert('Complete ADD or REPLACE details for every team member.', 'warning');
      return;
    }
    setEditSubmitting(true);
    try {
      await api.patch(`/waitlists/entries/${editEntry.id}`, {
        ...(requiresByotRoster
          ? { teamRosterPlacements: toPlacementPayload(editPlacements) }
          : {
              entryType: editEntryType,
              replacesLeagueId: editEntryType === 'replace' ? editReplacesLeagueId : null,
            }),
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
    setJoinEntryType('add');
    setJoinReplacesLeagueId(null);
    setJoinTeamRosterText('');
    setJoinPlacements(
      member
        ? [
            {
              memberId: member.id,
              memberName: joiningMemberName,
              entryType: 'add',
              replacesLeagueId: null,
            },
          ]
        : [],
    );
    try {
      const res = await api.get<WaitlistJoinContext>(`/waitlists/${waitlistId}/join-context`);
      setJoinContext(res.data);
      setJoinEntryType(res.data.addAvailable ? 'add' : res.data.replacementLeagues.length > 0 ? 'replace' : 'add');
    } catch (err) {
      setJoinContextError(getApiErrorMessage(err, 'Unable to load waitlist join options.'));
      setJoinContext(null);
    } finally {
      setJoinContextLoading(false);
    }
  }, [waitlistId]);

  const memberJoinEntryTypeOptions = useMemo((): ChoiceOption<'add' | 'replace'>[] => {
    if (!joinContext) return ENTRY_TYPE_OPTIONS;
    return ENTRY_TYPE_OPTIONS.map((option) => {
      if (option.type === 'divider' || !('value' in option) || option.value !== 'add' || joinContext.addAvailable) {
        return option;
      }
      return {
        ...option,
        disabled: true,
        description: joinContext.addBlockedReason ?? 'ADD is not available for your current league schedule.',
      };
    });
  }, [joinContext]);

  const memberReplaceLeagueOptions = useMemo(
    () => (joinContext?.replacementLeagues ?? []).map((league) => ({ value: league.id, label: league.name })),
    [joinContext],
  );

  const submitJoinWaitlist = async () => {
    if (!joinContext) return;
    if (joinContext.requiresByotRoster) {
      if (!joinByotRosterComplete) {
        showAlert('Complete ADD or REPLACE details for every team member.', 'warning');
        return;
      }
    } else if (joinEntryType === 'replace' && joinReplacesLeagueId == null) {
      showAlert('Select the league you want to replace.', 'warning');
      return;
    }
    setJoinSubmitting(true);
    try {
      await api.post(`/waitlists/${waitlistId}/join`, {
        ...(joinContext.requiresByotRoster
          ? { teamRosterPlacements: toPlacementPayload(joinPlacements) }
          : {
              entryType: joinEntryType,
              replacesLeagueId: joinEntryType === 'replace' ? joinReplacesLeagueId : null,
            }),
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
    if (!currentMemberPrimaryEntry) return;
    const isByot = data?.league.leagueType === 'bring_your_own_team';
    const confirmed = await confirm({
      title: 'Leave waitlist?',
      message: isByot
        ? 'Leaving will remove your entire team from this waitlist and you will lose your position in the queue.'
        : 'You will lose your position in the queue. You can join again later if spots are still available.',
      confirmText: 'Leave waitlist',
      cancelText: 'Keep my position',
      variant: 'danger',
    });
    if (!confirmed) return;
    try {
      await api.post(`/registration/member/waitlist-entries/${currentMemberPrimaryEntry.id}/remove`, {});
      showAlert('You have been removed from the waitlist.', 'success');
      await load();
    } catch (err) {
      showAlert(getApiErrorMessage(err, 'Unable to leave waitlist.'), 'error');
    }
  };

  const replacementLeagueOptionsForMember = useCallback(
    (memberId: number | null | undefined) => {
      if (typeof memberId !== 'number') return [];
      return (placementOptionsByMemberId[memberId]?.replacementLeagues ?? []).map((league) => ({
        value: league.id,
        label: league.name,
      }));
    },
    [placementOptionsByMemberId],
  );

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

  const handleReorder = async (nextEntries: WaitlistEntry[]) => {
    if (!canManage || !data) return;
    const previousIds = orderedEntries.map((entry) => entry.id);
    const nextIds = nextEntries.map((entry) => entry.id);
    if (previousIds.join(',') === nextIds.join(',')) return;

    setDialog({
      title: 'Save queue order',
      description: 'Reorder the active waitlist queue. This updates position for all listed members.',
      confirmText: 'Save order',
      onSubmit: runAction(async (reason) => {
        await api.post(`/waitlists/${waitlistId}/entries/reorder`, {
          entryIds: nextIds,
          reason,
        });
        setOrderedEntries(nextEntries.map((entry, index) => ({ ...entry, position: index + 1 })));
      }, 'Waitlist order saved.'),
    });
  };

  const submitAddEntry = async () => {
    if (!data || addMemberId === '' || !addReason.trim()) return;
    if (requiresByotRoster) {
      if (!addByotRosterComplete) {
        showAlert('Complete ADD or REPLACE details for every team member.', 'warning');
        return;
      }
    } else if (addEntryType === 'replace' && addReplacesLeagueId == null) {
      showAlert('Select the league being replaced for a REPLACE entry.', 'warning');
      return;
    }
    setAddSubmitting(true);
    try {
      await api.post(`/waitlists/${waitlistId}/entries`, {
        placementLeagueId: data.placementLeagueId,
        memberId: addMemberId,
        ...(requiresByotRoster
          ? { teamRosterPlacements: toPlacementPayload(addPlacements), entryType: 'add' }
          : {
              entryType: addEntryType,
              replacesLeagueId: addEntryType === 'replace' ? addReplacesLeagueId : null,
            }),
        reason: addReason.trim(),
      });
      showAlert('Waitlist entry added.', 'success');
      setAddModalOpen(false);
      setAddMemberId('');
      setAddEntryType('add');
      setAddReplacesLeagueId(null);
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
          description="View and manage the waitlist queue for this league."
          actions={
            <>
              <Link
                className="inline-flex items-center rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-100 dark:hover:bg-gray-700"
                to="/waitlists"
              >
                Back to waitlists
              </Link>
              {member && !currentMemberEntry ? (
                <Button onClick={() => void openJoinModal()}>Join waitlist</Button>
              ) : null}
              {currentMemberPrimaryEntry ? (
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

        {currentMemberTeammateEntry ? (
          <InlineStateMessage
            tone="warning"
            title="You are on this waitlist as a team member"
            description={waitlistTeammateContactMessage(currentMemberTeammateEntry.memberName)}
          />
        ) : null}

        <div className="grid gap-4 md:grid-cols-3">
          <div className="app-card">
            <p className="text-sm text-gray-500 dark:text-gray-400">Active entries</p>
            <p className="mt-2 text-3xl font-semibold text-gray-900 dark:text-white">{orderedEntries.length}</p>
          </div>
          <div className="app-card">
            <div className="flex items-center gap-1.5">
              <p className="text-sm text-gray-500 dark:text-gray-400">Permanent vacancies</p>
              <HelpCallout text={PERMANENT_VACANCIES_HELP} label="About permanent vacancies" />
            </div>
            <p className="mt-2 text-3xl font-semibold text-gray-900 dark:text-white">{data.league.permanentVacancies}</p>
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
            left={<p className="text-sm text-gray-600 dark:text-gray-400">Drag entries to reorder the queue.</p>}
            right={
              <>
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
          {orderedEntries.length === 0 ? (
            <p className="mt-4 text-sm text-gray-500">No active waitlist entries.</p>
          ) : canManage ? (
            <div className="mt-4">
              <SortableList
                items={orderedEntries}
                getId={(entry) => entry.id}
                getItemLabel={(entry) => waitlistEntryHeadline(entry)}
                onReorder={(next) => void handleReorder(next)}
                itemClassName="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-900"
                renderItem={({ item, index, dragHandle }) => (
                  <WaitlistEntryRow
                    entry={item}
                    index={index}
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
                <div key={entry.id} className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                  <WaitlistEntryRow
                    entry={entry}
                    index={index}
                    canManage={false}
                    onAction={() => {}}
                    runAction={runAction}
                  />
                </div>
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

        <ReasonDialog state={dialog} onClose={() => setDialog(null)} />

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
                  {joinContext.requiresByotRoster
                    ? ' Add your team and specify whether each player is joining as an ADD or REPLACE.'
                    : ' Choose whether this is an ADD or REPLACE entry.'}
                </p>
                {joinContext.usesRegistration ? (
                  <p className="text-sm text-gray-600 dark:text-gray-300">
                    League limits are based on your submitted registration for this session.
                  </p>
                ) : (
                  <p className="text-sm text-gray-600 dark:text-gray-300">
                    League limits are based on your current session roster. Instructional leagues do not count toward the ADD limit.
                  </p>
                )}
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
                {!joinContext.requiresByotRoster ? (
                  <>
                    <FormField label="Entry type" htmlFor={joinEntryTypeId}>
                      <ChoiceInput<'add' | 'replace'>
                        inputId={joinEntryTypeId}
                        layout="popover"
                        value={joinEntryType}
                        onChange={(next) => {
                          if (next === 'add' || next === 'replace') setJoinEntryType(next);
                        }}
                        options={memberJoinEntryTypeOptions}
                      />
                    </FormField>
                    {joinEntryType === 'replace' ? (
                      <FormField label="League to replace" htmlFor={joinReplacesLeagueIdField} required>
                        <ChoiceInput<number>
                          inputId={joinReplacesLeagueIdField}
                          layout="popover"
                          value={joinReplacesLeagueId}
                          onChange={(next) => {
                            if (typeof next === 'number') setJoinReplacesLeagueId(next);
                          }}
                          options={memberReplaceLeagueOptions}
                          emptyText="No leagues available to replace."
                        />
                      </FormField>
                    ) : null}
                  </>
                ) : (
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
                    <FormField label="Team member placements" htmlFor={`${joinTeamRosterId}-placements`} required>
                      <WaitlistTeamRosterPlacementsEditor
                        placements={joinPlacements}
                        placementOptionsByMemberId={placementOptionsByMemberId}
                        onChange={setJoinPlacements}
                      />
                    </FormField>
                  </>
                )}
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
                  (!joinContext.requiresByotRoster && joinEntryType === 'replace' && joinReplacesLeagueId == null) ||
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
              {!requiresByotRoster ? (
                <>
                  <FormField label="Entry type" htmlFor={editEntryTypeId}>
                    <ChoiceInput<'add' | 'replace'>
                      inputId={editEntryTypeId}
                      layout="popover"
                      value={editEntryType}
                      onChange={(next) => {
                        if (next === 'add' || next === 'replace') setEditEntryType(next);
                      }}
                      options={ENTRY_TYPE_OPTIONS}
                    />
                  </FormField>
                  {editEntryType === 'replace' ? (
                    <FormField label="Replaces league" htmlFor={editReplacesLeagueIdField} required>
                      <ChoiceInput<number>
                        inputId={editReplacesLeagueIdField}
                        layout="popover"
                        value={editReplacesLeagueId}
                        onChange={(next) => {
                          if (typeof next === 'number') setEditReplacesLeagueId(next);
                        }}
                        options={replacementLeagueOptionsForMember(editEntry.memberId)}
                        emptyText="No leagues available to replace."
                      />
                    </FormField>
                  ) : null}
                </>
              ) : (
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
                  <FormField label="Team member placements" htmlFor={`${editRosterId}-placements`} required>
                    <WaitlistTeamRosterPlacementsEditor
                      placements={editPlacements}
                      placementOptionsByMemberId={placementOptionsByMemberId}
                      onChange={setEditPlacements}
                    />
                  </FormField>
                </>
              )}
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
                    editSubmitting ||
                    !editReason.trim() ||
                    !editByotRosterComplete ||
                    (!requiresByotRoster && editEntryType === 'replace' && editReplacesLeagueId == null)
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
            {!requiresByotRoster ? (
              <>
                <FormField label="Entry type" htmlFor="waitlistAddEntryType">
                  <ChoiceInput<'add' | 'replace'>
                    inputId="waitlistAddEntryType"
                    layout="popover"
                    value={addEntryType}
                    onChange={(next) => {
                      if (next === 'add' || next === 'replace') setAddEntryType(next);
                    }}
                    options={ENTRY_TYPE_OPTIONS}
                  />
                </FormField>
                {addEntryType === 'replace' ? (
                  <FormField label="Replaces league" htmlFor="waitlistAddReplacesLeague">
                    <ChoiceInput<number>
                      inputId="waitlistAddReplacesLeague"
                      layout="popover"
                      value={addReplacesLeagueId}
                      onChange={(next) => {
                        if (typeof next === 'number') setAddReplacesLeagueId(next);
                      }}
                      options={replacementLeagueOptionsForMember(
                        typeof addMemberId === 'number' ? addMemberId : null,
                      )}
                      emptyText="No leagues available to replace."
                    />
                  </FormField>
                ) : null}
              </>
            ) : typeof addMemberId === 'number' && addMemberName ? (
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
                <FormField label="Team member placements" htmlFor={`${addTeamRosterId}-placements`} required>
                  <WaitlistTeamRosterPlacementsEditor
                    placements={addPlacements}
                    placementOptionsByMemberId={placementOptionsByMemberId}
                    onChange={setAddPlacements}
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

function WaitlistEntryRow({
  entry,
  index,
  dragHandle,
  canManage,
  onEdit,
  onAction,
  runAction,
}: {
  entry: WaitlistEntry;
  index: number;
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
          </p>
          <p className="mt-1 text-xs text-gray-500">
            If a spot opens: {waitlistOfferPreferenceLabel(entry)}
          </p>
          {entry.entryType === 'add' && entry.addWaitlistPriorityRank != null ? (
            <p className="mt-1 text-xs text-gray-500">
              Fulfillment preference: priority {entry.addWaitlistPriorityRank}
              {entry.desiredAddWaitlistLeagueCount != null
                ? ` · up to ${entry.desiredAddWaitlistLeagueCount} ${entry.desiredAddWaitlistLeagueCount === 1 ? 'league' : 'leagues'}`
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
