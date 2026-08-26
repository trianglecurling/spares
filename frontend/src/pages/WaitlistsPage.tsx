import { useCallback, useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { Link, useBeforeUnload, useNavigate, useSearchParams } from 'react-router-dom';
import { AppPage, AppPageHeader } from '../components/AppPage';
import AppPageControlsRow from '../components/AppPageControlsRow';
import AppStateCard from '../components/AppStateCard';
import Button from '../components/Button';
import ChoiceInput from '../components/ChoiceInput';
import FormField from '../components/FormField';
import InlineStateMessage from '../components/InlineStateMessage';
import MemberMultiSelect from '../components/MemberMultiSelect';
import Modal from '../components/Modal';
import PageTabs from '../components/PageTabs';
import SortableList from '../components/dragDrop/SortableList';
import { useAlert } from '../contexts/AlertContext';
import { useAuth } from '../contexts/AuthContext';
import { useConfirm } from '../contexts/ConfirmContext';
import { useMemberOptions } from '../contexts/MemberOptionsContext';
import {
  canReorderWaitlistPreferenceDrop,
  clampWaitlistPreferenceOrder,
  formatAttachedLeagueNames,
  formatWaitlistQueuePosition,
  insertWaitlistInPreferenceOrder,
  ROSTERED_WAITLIST_ORDER_TOOLTIP,
  summarizeMemberWaitlistChanges,
} from '../components/waitlists/memberWaitlistPriorityShared';
import { WAITLIST_POSITION_HELP } from '../components/waitlists/waitlistQueueCopy';
import {
  placementsAreComplete,
  syncPlacementsWithMembers,
  toPlacementPayload,
  type WaitlistTeamMemberPlacement,
} from '../components/waitlists/waitlistTeamRosterShared';
import { WaitlistOverviewPanel } from './admin/AdminWaitlists';
import api, { getApiErrorMessage } from '../utils/api';

type WaitlistsTab = 'mine' | 'all';

type AttachedLeague = {
  id: number;
  name: string;
  sessionId: number | null;
  sessionName: string | null;
  leagueType: string;
};

type MemberWaitlistEntry = {
  entryId: number;
  waitlistId: number;
  waitlistName: string;
  priorityRank: number;
  queuePosition: number | null;
  queueTotal: number | null;
  desiredLeagueCount: number | null;
  offerResponsePreference: string;
  offerResponsePreferenceLabel: string;
  pendingOffer: { id: number; offerType: string; expiresAt: string } | null;
  requiresByotRoster: boolean;
  attachedLeagues: AttachedLeague[];
  canLeave: boolean;
  isPrimaryMember?: boolean;
  addedByMemberName?: string | null;
  teamMemberNames?: string[];
};

type JoinableWaitlist = {
  waitlistId: number;
  name: string;
  requiresByotRoster: boolean;
  attachedLeagues: AttachedLeague[];
};

type MemberWaitlistsPayload = {
  entries: MemberWaitlistEntry[];
  joinableWaitlists: JoinableWaitlist[];
};

type WaitlistJoinContext = {
  waitlistId: number;
  placementLeague: { id: number; name: string; leagueType: string; format: string };
  alreadyOnWaitlist: boolean;
  requiresByotRoster: boolean;
  expectedByotRosterSize: number | null;
  blockingErrors: string[];
  warnings: string[];
  canJoin: boolean;
};

type DraftEntry = MemberWaitlistEntry & {
  isNew?: boolean;
  teamRosterPlacements?: WaitlistTeamMemberPlacement[];
};

function resolveTab(tabParam: string | null): WaitlistsTab {
  return tabParam === 'all' ? 'all' : 'mine';
}

function toChangeEntry(entry: Pick<DraftEntry, 'waitlistId' | 'waitlistName' | 'requiresByotRoster'>) {
  return { waitlistId: entry.waitlistId, waitlistName: entry.waitlistName, requiresByotRoster: entry.requiresByotRoster };
}

export default function WaitlistsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = resolveTab(searchParams.get('tab'));
  const navigate = useNavigate();
  const { confirm } = useConfirm();
  const [editing, setEditing] = useState(false);
  const [draftDirty, setDraftDirty] = useState(false);

  const confirmDiscardUnsavedChanges = useCallback(
    async (message: string) => {
      if (!draftDirty) return true;
      return confirm({
        title: 'Discard unsaved changes?',
        message,
        confirmText: 'Discard changes',
        cancelText: 'Keep editing',
        variant: 'warning',
      });
    },
    [confirm, draftDirty],
  );

  const discardEditState = useCallback(() => {
    setEditing(false);
    setDraftDirty(false);
  }, []);

  useBeforeUnload(
    useCallback(
      (event) => {
        if (!draftDirty) return;
        event.preventDefault();
        event.returnValue = '';
      },
      [draftDirty],
    ),
  );

  useEffect(() => {
    if (!draftDirty) return;
    const handleDocumentClick = (event: MouseEvent) => {
      if (event.defaultPrevented) return;
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target as Element | null;
      const anchor = target?.closest('a[href]') as HTMLAnchorElement | null;
      if (!anchor) return;
      if (anchor.target && anchor.target !== '_self') return;
      if (anchor.hasAttribute('download')) return;
      const rawHref = anchor.getAttribute('href');
      if (!rawHref || rawHref.startsWith('#') || rawHref.startsWith('mailto:') || rawHref.startsWith('tel:')) {
        return;
      }
      const destination = new URL(anchor.href, window.location.href);
      const current = new URL(window.location.href);
      if (destination.origin !== current.origin) return;
      if (
        destination.pathname === current.pathname &&
        destination.search === current.search &&
        destination.hash === current.hash
      ) {
        return;
      }
      event.preventDefault();
      void (async () => {
        const shouldLeave = await confirmDiscardUnsavedChanges(
          'You have unsaved waitlist changes. Leave this page and discard them?',
        );
        if (!shouldLeave) return;
        discardEditState();
        navigate(`${destination.pathname}${destination.search}${destination.hash}`);
      })();
    };
    document.addEventListener('click', handleDocumentClick, true);
    return () => document.removeEventListener('click', handleDocumentClick, true);
  }, [confirmDiscardUnsavedChanges, discardEditState, draftDirty, navigate]);

  const setTab = async (next: WaitlistsTab) => {
    if (next === activeTab) return;
    if (editing && draftDirty) {
      const discard = await confirmDiscardUnsavedChanges(
        'You have unsaved waitlist changes. Leave this tab without saving?',
      );
      if (!discard) return;
      discardEditState();
    } else if (editing) {
      setEditing(false);
    }
    if (next === 'all') {
      setSearchParams({ tab: 'all' });
    } else {
      setSearchParams({});
    }
  };

  return (
    <AppPage>
      <AppPageHeader
        title="Waitlists"
        description={
          activeTab === 'mine'
            ? 'Your waitlists, in preference order. Team waitlists stay above individual waitlists. Queue position is based on club tenure and can change until staff freeze the list.'
            : 'Browse every league waitlist and see who is in line.'
        }
      />
      <PageTabs
        ariaLabel="Waitlist views"
        items={[
          {
            key: 'mine',
            label: 'My waitlists',
            isActive: activeTab === 'mine',
            onClick: () => void setTab('mine'),
          },
          {
            key: 'all',
            label: 'All waitlists',
            isActive: activeTab === 'all',
            onClick: () => void setTab('all'),
          },
        ]}
      />
      {activeTab === 'mine' ? (
        <MyWaitlistsPanel
          editing={editing}
          onEditingChange={setEditing}
          onDirtyChange={setDraftDirty}
        />
      ) : (
        <WaitlistOverviewPanel />
      )}
    </AppPage>
  );
}

function MyWaitlistsPanel({
  editing,
  onEditingChange,
  onDirtyChange,
}: {
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const { showAlert } = useAlert();
  const { confirm } = useConfirm();
  const { member } = useAuth();
  const memberOptions = useMemberOptions();
  const addWaitlistInputId = useId();
  const joinTeamRosterId = useId();
  const [payload, setPayload] = useState<MemberWaitlistsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draftEntries, setDraftEntries] = useState<DraftEntry[]>([]);
  const [saving, setSaving] = useState(false);
  const [joinPickerValue, setJoinPickerValue] = useState<number | null>(null);
  const [joinContextLoading, setJoinContextLoading] = useState(false);
  const [joinModal, setJoinModal] = useState<{
    waitlist: JoinableWaitlist;
    context: WaitlistJoinContext;
  } | null>(null);
  const [joinPlacements, setJoinPlacements] = useState<WaitlistTeamMemberPlacement[]>([]);
  const [joinSubmitting, setJoinSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<MemberWaitlistsPayload>('/waitlists/mine');
      setPayload(res.data);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Unable to load your waitlists.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!editing && payload) {
      setDraftEntries(payload.entries);
    }
  }, [editing, payload]);

  const savedEntries = payload?.entries ?? [];
  const dirty = useMemo(() => {
    const summary = summarizeMemberWaitlistChanges(
      savedEntries.map(toChangeEntry),
      draftEntries.map(toChangeEntry),
    );
    return summary.hasChanges;
  }, [draftEntries, savedEntries]);

  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  const memberOptionById = useMemo(
    () => new Map(memberOptions.options.map((option) => [option.id, option])),
    [memberOptions.options],
  );
  const joiningMemberName = member?.name ?? 'You';

  const joinableOptions = useMemo(() => {
    const draftIds = new Set(draftEntries.map((entry) => entry.waitlistId));
    return (payload?.joinableWaitlists ?? []).filter((waitlist) => !draftIds.has(waitlist.waitlistId));
  }, [draftEntries, payload?.joinableWaitlists]);

  const enterEdit = () => {
    setDraftEntries(savedEntries);
    onEditingChange(true);
  };

  const cancelEdit = async () => {
    if (dirty) {
      const discard = await confirm({
        title: 'Discard waitlist changes?',
        message: 'Leave edit mode without saving your waitlist changes?',
        confirmText: 'Discard changes',
        cancelText: 'Keep editing',
        variant: 'warning',
      });
      if (!discard) return;
    }
    setDraftEntries(savedEntries);
    onEditingChange(false);
  };

  const saveEdit = async () => {
    const summary = summarizeMemberWaitlistChanges(
      savedEntries.map(toChangeEntry),
      draftEntries.map(toChangeEntry),
    );
    if (!summary.hasChanges) {
      onEditingChange(false);
      return;
    }
    const confirmed = await confirm({
      title: 'Save waitlist changes?',
      message: summary.message,
      confirmText: 'Save changes',
      cancelText: 'Keep editing',
      variant: summary.left.length > 0 ? 'danger' : 'info',
    });
    if (!confirmed) return;
    setSaving(true);
    try {
      const res = await api.put<MemberWaitlistsPayload>('/waitlists/mine', {
        entries: draftEntries.map((entry) => ({
          waitlistId: entry.waitlistId,
          ...(entry.isNew && entry.requiresByotRoster
            ? { teamRosterPlacements: toPlacementPayload(entry.teamRosterPlacements ?? []) }
            : {}),
        })),
      });
      setPayload(res.data);
      setDraftEntries(res.data.entries);
      onEditingChange(false);
      showAlert('Waitlist preference saved.', 'success');
    } catch (err) {
      showAlert(getApiErrorMessage(err, 'Unable to save waitlist changes.'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const beginJoin = async (waitlistId: number) => {
    const waitlist = joinableOptions.find((item) => item.waitlistId === waitlistId);
    if (!waitlist || !member) return;
    setJoinPickerValue(null);
    setJoinPlacements([{ memberId: member.id, memberName: joiningMemberName }]);
    setJoinContextLoading(true);
    try {
      const res = await api.get<WaitlistJoinContext>(`/waitlists/${waitlistId}/join-context`);
      const context = res.data;
      const needsDetails =
        context.requiresByotRoster || context.blockingErrors.length > 0 || context.warnings.length > 0;
      if (!needsDetails && context.canJoin) {
        addDraftWaitlist(waitlist, []);
        return;
      }
      setJoinModal({ waitlist, context });
    } catch (err) {
      showAlert(getApiErrorMessage(err, 'Unable to load waitlist join options.'), 'error');
    } finally {
      setJoinContextLoading(false);
    }
  };

  const addDraftWaitlist = (waitlist: JoinableWaitlist, placements: WaitlistTeamMemberPlacement[]) => {
    setDraftEntries((current) =>
      insertWaitlistInPreferenceOrder(current, {
        entryId: -waitlist.waitlistId,
        waitlistId: waitlist.waitlistId,
        waitlistName: waitlist.name,
        priorityRank: current.length + 1,
        queuePosition: null,
        queueTotal: null,
        desiredLeagueCount: null,
        offerResponsePreference: 'ask',
        offerResponsePreferenceLabel: 'Ask me',
        pendingOffer: null,
        requiresByotRoster: waitlist.requiresByotRoster,
        attachedLeagues: waitlist.attachedLeagues,
        canLeave: true,
        isPrimaryMember: true,
        addedByMemberName: null,
        teamMemberNames: placements.map((placement) => placement.memberName),
        isNew: true,
        teamRosterPlacements: placements,
      }),
    );
  };

  const confirmJoinModal = () => {
    if (!joinModal?.context.canJoin) return;
    if (joinModal.context.requiresByotRoster && !placementsAreComplete(joinPlacements, joinModal.context.expectedByotRosterSize)) {
      showAlert('Add every team member before joining.', 'warning');
      return;
    }
    setJoinSubmitting(true);
    addDraftWaitlist(joinModal.waitlist, joinPlacements);
    setJoinModal(null);
    setJoinSubmitting(false);
  };

  const updateJoinTeamRosterMembers = (memberIds: number[]) => {
    if (!member) return;
    const members = [
      { memberId: member.id, memberName: joiningMemberName },
      ...memberIds
        .map((id) => {
          const name = memberOptionById.get(id)?.name;
          return name ? { memberId: id, memberName: name } : null;
        })
        .filter((item): item is { memberId: number; memberName: string } => item != null),
    ];
    setJoinPlacements((current) => syncPlacementsWithMembers(members, current));
  };

  const joinTeamRosterMemberIds = joinPlacements
    .map((placement) => placement.memberId)
    .filter((id) => id !== member?.id);

  if (loading) {
    return <AppStateCard title="Loading your waitlists" description="Gathering the waitlists you are on." />;
  }

  if (error || !payload) {
    return (
      <AppStateCard
        title="Unable to load your waitlists"
        description={error ?? 'Your waitlists could not be loaded.'}
        action={<Button onClick={() => void load()}>Try again</Button>}
      />
    );
  }

  const visibleEntries = editing ? draftEntries : savedEntries;

  return (
    <>
      <AppPageControlsRow
        left={
          editing ? (
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Drag to set preference order, most wanted first. {ROSTERED_WAITLIST_ORDER_TOOLTIP} Leave a waitlist or add
              another, then save.
            </p>
          ) : (
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Your waitlists are shown in preference order. Enter edit mode to reorder, join, or leave.{' '}
              {WAITLIST_POSITION_HELP}
            </p>
          )
        }
        right={
          editing ? (
            <>
              <Button variant="secondary" onClick={() => void cancelEdit()} disabled={saving}>
                Cancel
              </Button>
              <Button onClick={() => void saveEdit()} disabled={saving || !dirty}>
                {saving ? 'Saving…' : 'Save'}
              </Button>
            </>
          ) : (
            <Button onClick={enterEdit}>Edit</Button>
          )
        }
      />

      {visibleEntries.length === 0 ? (
        <AppStateCard
          title="You are not on any waitlists"
          description={
            editing
              ? 'Add a waitlist below. Your first choice should be the league you most want to join.'
              : 'Join a waitlist during registration, or enter edit mode to add one here.'
          }
        />
      ) : editing ? (
        <div className="app-card">
          <h2 className="app-section-title">Your waitlists</h2>
          <div className="mt-4">
            <SortableList
              items={draftEntries}
              itemNoun="waitlist"
              getId={(entry) => entry.waitlistId}
              getItemLabel={(entry) => entry.waitlistName}
              canDropOnItem={(active, over) => canReorderWaitlistPreferenceDrop(active, over)}
              onReorder={(next) => setDraftEntries(clampWaitlistPreferenceOrder(next))}
              itemClassName="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-900"
              renderItem={({ item, index, dragHandle, isInvalidDropTarget }) => (
                <MemberWaitlistRow
                  entry={item}
                  index={index}
                  editing
                  dragHandle={dragHandle}
                  isInvalidDropTarget={isInvalidDropTarget}
                  onLeave={() =>
                    setDraftEntries((current) => current.filter((entry) => entry.waitlistId !== item.waitlistId))
                  }
                />
              )}
            />
          </div>
        </div>
      ) : (
        <div className="app-card">
          <h2 className="app-section-title">Your waitlists</h2>
          <ul className="mt-4 space-y-3">
            {visibleEntries.map((entry, index) => (
              <li key={entry.waitlistId} className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                <MemberWaitlistRow entry={entry} index={index} editing={false} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {editing ? (
        <div className="app-card">
          {joinableOptions.length === 0 ? (
            <InlineStateMessage
              title="No other waitlists available"
              description="You are already on every waitlist you can join."
            />
          ) : (
            <FormField
              label="Join another waitlist"
              htmlFor={addWaitlistInputId}
              helperText={
                joinContextLoading
                  ? 'Checking whether you can join this waitlist…'
                  : 'Team waitlists are added after your other team waitlists. Individual waitlists are added at the bottom. Drag them to the preference you want before you save.'
              }
            >
              <ChoiceInput
                inputId={addWaitlistInputId}
                layout="popover"
                value={joinPickerValue}
                placeholder="Select a waitlist"
                disabled={joinContextLoading}
                onChange={(next) => {
                  if (typeof next === 'number') void beginJoin(next);
                  else setJoinPickerValue(null);
                }}
                options={joinableOptions.map((waitlist) => ({
                  value: waitlist.waitlistId,
                  label: waitlist.name,
                  description: formatAttachedLeagueNames(waitlist.attachedLeagues) || undefined,
                }))}
              />
            </FormField>
          )}
        </div>
      ) : null}

      <Modal
        isOpen={joinModal != null}
        onClose={() => setJoinModal(null)}
        title="Join waitlist"
        size={joinModal?.context.requiresByotRoster ? 'lg' : 'md'}
      >
        {joinModal ? (
          <div className="space-y-4">
            <p className="text-sm text-gray-600 dark:text-gray-300">
              Add {joinModal.waitlist.name} to your waitlist preference list.
              {joinModal.context.requiresByotRoster ? ' Add your full team to the entry.' : ''}
            </p>
            {joinModal.context.warnings.length > 0 ? (
              <InlineStateMessage tone="warning" title="Before you join" description={joinModal.context.warnings.join(' ')} />
            ) : null}
            {joinModal.context.blockingErrors.length > 0 ? (
              <InlineStateMessage tone="error" title="You cannot join this waitlist" description={joinModal.context.blockingErrors.join(' ')} />
            ) : null}
            {joinModal.context.requiresByotRoster ? (
              <FormField label="Team roster" htmlFor={joinTeamRosterId} required>
                <MemberMultiSelect
                  inputId={joinTeamRosterId}
                  selectedIds={joinTeamRosterMemberIds}
                  onChange={updateJoinTeamRosterMembers}
                  maxSelections={
                    joinModal.context.expectedByotRosterSize
                      ? Math.max(joinModal.context.expectedByotRosterSize - 1, 0)
                      : undefined
                  }
                  placeholder="Search members..."
                  filterOption={(option) => option.id !== member?.id}
                  lockedPills={[{ key: 'joining-member', label: joiningMemberName }]}
                />
              </FormField>
            ) : null}
            <div className="flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setJoinModal(null)} disabled={joinSubmitting}>
                Cancel
              </Button>
              <Button
                onClick={confirmJoinModal}
                disabled={
                  joinSubmitting ||
                  !joinModal.context.canJoin ||
                  (joinModal.context.requiresByotRoster &&
                    !placementsAreComplete(joinPlacements, joinModal.context.expectedByotRosterSize))
                }
              >
                Add to my waitlists
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>
    </>
  );
}

function MemberWaitlistRow({
  entry,
  index,
  editing,
  dragHandle,
  isInvalidDropTarget = false,
  onLeave,
}: {
  entry: DraftEntry;
  index: number;
  editing: boolean;
  dragHandle?: ReactNode;
  isInvalidDropTarget?: boolean;
  onLeave?: () => void;
}) {
  const leagues = formatAttachedLeagueNames(entry.attachedLeagues);
  const queue = formatWaitlistQueuePosition(entry.queuePosition, entry.queueTotal);
  const teamNames = (entry.teamMemberNames ?? []).filter(Boolean);

  return (
    <div
      className={`flex flex-col gap-3 md:flex-row md:items-start md:justify-between${
        isInvalidDropTarget ? ' pointer-events-none opacity-40 grayscale' : ''
      }`}
    >
      <div className="flex min-w-0 flex-1 gap-3">
        {editing ? dragHandle : null}
        <div className="min-w-0">
          <p className="font-medium text-gray-900 dark:text-white">
            {index + 1}.{' '}
            {editing ? (
              entry.waitlistName
            ) : (
              <Link
                to={`/waitlists/${entry.waitlistId}`}
                className="text-primary-teal-link hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-teal/40"
              >
                {entry.waitlistName}
              </Link>
            )}
            {entry.isNew ? <span className="ml-2 text-xs font-normal text-gray-500">New</span> : null}
          </p>
          {leagues ? <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{leagues}</p> : null}
          {teamNames.length > 0 ? (
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">Team: {teamNames.join(', ')}</p>
          ) : null}
          {entry.addedByMemberName ? (
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">Added by {entry.addedByMemberName}</p>
          ) : null}
          <p className="mt-1 text-xs text-gray-500">
            {[
              queue,
              entry.offerResponsePreferenceLabel ? `If a spot opens: ${entry.offerResponsePreferenceLabel}` : null,
              entry.desiredLeagueCount != null
                ? `Wants up to ${entry.desiredLeagueCount} ${entry.desiredLeagueCount === 1 ? 'league' : 'leagues'}`
                : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
          {entry.pendingOffer ? (
            <p className="mt-1 text-xs text-amber-800 dark:text-amber-200">Pending offer</p>
          ) : null}
        </div>
      </div>
      {editing && onLeave ? (
        <Button variant="outline-danger" className="px-3 py-1.5" onClick={onLeave} aria-label={`Leave ${entry.waitlistName}`}>
          Leave
        </Button>
      ) : null}
    </div>
  );
}
