import { useState, useEffect, FormEvent, useId } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useAlert } from '../contexts/AlertContext';
import { useConfirm } from '../contexts/ConfirmContext';
import { useLeagueOptions } from '../contexts/LeagueOptionsContext';
import { AppPage, AppPageHeader } from '../components/AppPage';
import AppStateCard from '../components/AppStateCard';
import MemberMultiSelect from '../components/MemberMultiSelect';
import FormField from '../components/FormField';
import FormSection from '../components/FormSection';
import ChoiceInput, { type ChoiceOption } from '../components/ChoiceInput';
import { get, post } from '../api/client';
import { formatApiError } from '../utils/api';
import {
  LEAGUE_PROCESSING_ROSTER_MESSAGE,
  memberCanBypassLeagueProcessingHold,
} from '../utils/leagueProcessing';
import Button from '../components/Button';
import MemberEmail from '../components/MemberEmail';
import { format } from 'date-fns';

type SparePosition = 'lead' | 'second' | 'vice' | 'skip';

type SpareRequestPlayer = {
  memberId: number;
  name: string;
  role: string | null;
  sparePosition: SparePosition | null;
  isSelf: boolean;
};

type SpareRequestGame = {
  id: number;
  date: string;
  time: string;
  opponentName: string | null;
};

type SpareRequestTeam = {
  id: number;
  name: string | null;
  players: SpareRequestPlayer[];
  games: SpareRequestGame[];
};

type SpareRequestLeague = {
  id: number;
  name: string;
  dayOfWeek: number;
  format: string;
  teamId: number | null;
  teamName: string | null;
  players: SpareRequestPlayer[];
  games: SpareRequestGame[];
  isManager: boolean;
  managedTeams: SpareRequestTeam[];
};

/** A player who can be covered, with the team context their request is tied to. */
type PlayerChoice = SpareRequestPlayer & {
  teamName: string | null;
  teammates: SpareRequestPlayer[];
  games: SpareRequestGame[];
};

function playerChoicesForLeague(league: SpareRequestLeague | null): PlayerChoice[] {
  if (!league) return [];
  if (league.isManager) {
    const seen = new Set<number>();
    const choices: PlayerChoice[] = [];
    for (const team of league.managedTeams) {
      for (const player of team.players) {
        if (seen.has(player.memberId)) continue;
        seen.add(player.memberId);
        choices.push({ ...player, teamName: team.name, teammates: team.players, games: team.games });
      }
    }
    return choices;
  }
  if (league.teamId == null) return [];
  return league.players.map((player) => ({
    ...player,
    teamName: league.teamName,
    teammates: league.players,
    games: league.games,
  }));
}

function defaultPlayerId(league: SpareRequestLeague | null): number | null {
  const choices = playerChoicesForLeague(league);
  const self = choices.find((player) => player.isSelf);
  if (self) return self.memberId;
  return league?.isManager ? null : (choices[0]?.memberId ?? null);
}

type AvailableMember = {
  id: number;
  name: string;
  email?: string | null;
  parentEmail?: string | null;
};

const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function formatTimeShort(time: string): string {
  const [hours, minutes] = time.split(':').map(Number);
  const period = hours >= 12 ? 'PM' : 'AM';
  const displayHour = hours % 12 || 12;
  return `${displayHour}:${String(minutes).padStart(2, '0')} ${period}`;
}

function rosterRoleLabel(role: string | null | undefined): string | null {
  if (!role) return null;
  switch (role.toLowerCase()) {
    case 'lead':
      return 'Lead';
    case 'second':
      return 'Second';
    case 'third':
      return 'Third';
    case 'fourth':
      return 'Fourth';
    case 'player1':
      return 'Player 1';
    case 'player2':
      return 'Player 2';
    default:
      return role.charAt(0).toUpperCase() + role.slice(1);
  }
}

export default function RequestSpare() {
  const { member } = useAuth();
  const { leagueProcessingActive } = useLeagueOptions({ autoLoad: true });
  const { showAlert } = useAlert();
  const { confirm } = useConfirm();
  const navigate = useNavigate();
  const isSpareOnly = Boolean(member?.spareOnly);
  const isSocialMember = Boolean(member?.socialMember);
  const cannotRequestForSelf = isSpareOnly || isSocialMember;

  const leagueFieldId = useId();
  const gameSlotFieldId = useId();
  const playerFieldId = useId();
  const messageFieldId = useId();

  const [leagues, setLeagues] = useState<SpareRequestLeague[]>([]);
  const [selectedLeagueId, setSelectedLeagueId] = useState<string>('');
  const [selectedGameSlot, setSelectedGameSlot] = useState('');
  const [selectedPlayerId, setSelectedPlayerId] = useState<number | null>(null);
  const [message, setMessage] = useState('');
  const [requestType, setRequestType] = useState<'public' | 'private'>('public');
  const [selectedInvitees, setSelectedInvitees] = useState<number[]>([]);
  const [availableMembers, setAvailableMembers] = useState<AvailableMember[]>([]);

  const [loading, setLoading] = useState(true);
  const [loadingAvailableMembers, setLoadingAvailableMembers] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const selectedLeague = leagues.find((league) => league.id.toString() === selectedLeagueId) ?? null;
  const isManagerLeague = Boolean(selectedLeague?.isManager);
  const managesAnyLeague = leagues.some((league) => league.isManager);
  const cannotCreateSpareRequest = cannotRequestForSelf && !loading && !managesAnyLeague;
  const playerChoices = playerChoicesForLeague(selectedLeague);
  const hasTeamAssignment = isManagerLeague || selectedLeague?.teamId != null;
  const selectedPlayer =
    playerChoices.find((player) => player.memberId === selectedPlayerId) ?? null;
  const upcomingGames = selectedPlayer?.games ?? [];
  const hasUpcomingGames = upcomingGames.length > 0;
  const ownTeamHasGames = (selectedLeague?.games.length ?? 0) > 0;
  const selectedGame =
    upcomingGames.find((game) => `${game.date}|${game.time}` === selectedGameSlot) ?? null;
  const showPlayerStep = playerChoices.length > 0 && (isManagerLeague || ownTeamHasGames);
  const showGameStep = showPlayerStep && selectedPlayer != null && hasUpcomingGames;
  const showPreferencesStep = showGameStep && selectedGame != null;
  const canSubmit =
    !submitting &&
    !cannotCreateSpareRequest &&
    (requestType !== 'private' || selectedInvitees.length > 0);

  useEffect(() => {
    let canceled = false;
    setLoading(true);
    setLoadError(false);

    void get('/spares/request-context')
      .then((response) => {
        if (canceled) return;
        const nextLeagues = response.leagues ?? [];
        setLeagues(nextLeagues);
        if (nextLeagues.length === 1) {
          const only = nextLeagues[0];
          setSelectedLeagueId(String(only.id));
          setSelectedPlayerId(defaultPlayerId(only));
        }
      })
      .catch((error) => {
        console.error('Failed to load spare request context:', error);
        if (!canceled) {
          setLoadError(true);
          setLeagues([]);
        }
      })
      .finally(() => {
        if (!canceled) setLoading(false);
      });

    return () => {
      canceled = true;
    };
  }, [member?.id]);

  useEffect(() => {
    setSelectedGameSlot('');
  }, [selectedLeagueId]);

  useEffect(() => {
    if (!showPreferencesStep || requestType !== 'private') {
      setAvailableMembers([]);
      return;
    }

    let canceled = false;
    setLoadingAvailableMembers(true);
    const position = selectedPlayer?.sparePosition ?? undefined;

    void get(
      '/availability/league/{leagueId}/members',
      position ? { position } : undefined,
      { leagueId: selectedLeagueId },
    )
      .then((response) => {
        if (canceled) return;
        const teammateIds = new Set(selectedPlayer?.teammates.map((player) => player.memberId) ?? []);
        setAvailableMembers(
          response.filter(
            (candidate) => candidate.id !== member?.id && !teammateIds.has(candidate.id),
          ),
        );
      })
      .catch((error) => {
        console.error('Failed to load available members:', error);
        if (!canceled) setAvailableMembers([]);
      })
      .finally(() => {
        if (!canceled) setLoadingAvailableMembers(false);
      });

    return () => {
      canceled = true;
    };
  }, [
    showPreferencesStep,
    requestType,
    selectedPlayer?.sparePosition,
    selectedPlayer?.teammates,
    member?.id,
    selectedLeagueId,
  ]);

  const leagueOptions: ChoiceOption<string>[] = leagues.map((league) => ({
    value: String(league.id),
    label: `${league.name} · ${dayNames[league.dayOfWeek] ?? ''}`,
  }));

  const gameSlotOptions: ChoiceOption<string>[] = upcomingGames.map((slot) => {
    const value = `${slot.date}|${slot.time}`;
    const opponent = slot.opponentName ? ` vs ${slot.opponentName}` : '';
    return {
      value,
      label: `${format(new Date(`${slot.date}T12:00:00`), 'EEE, MMM d')} · ${formatTimeShort(slot.time)}${opponent}`,
    };
  });

  const playerOptions: ChoiceOption<string>[] = playerChoices.map((player) => {
    const role = rosterRoleLabel(player.role);
    const suffix = role ? ` (${role})` : '';
    const team = isManagerLeague && player.teamName ? ` · ${player.teamName}` : '';
    return {
      value: String(player.memberId),
      label: `${player.name}${suffix}${team}`,
    };
  });

  const handleLeagueChange = (next: string | string[] | null) => {
    const value = typeof next === 'string' ? next : '';
    setSelectedLeagueId(value);
    setSelectedInvitees([]);
    setSelectedGameSlot('');
    const league = leagues.find((row) => String(row.id) === value) ?? null;
    setSelectedPlayerId(defaultPlayerId(league));
  };

  const handlePlayerChange = (next: string | string[] | null) => {
    const value = typeof next === 'string' ? Number(next) : NaN;
    setSelectedPlayerId(Number.isFinite(value) ? value : null);
    setSelectedGameSlot('');
    setSelectedInvitees([]);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (cannotCreateSpareRequest || (cannotRequestForSelf && !isManagerLeague)) {
      showAlert(
        isSocialMember
          ? 'Social memberships do not include spare requests.'
          : 'Your account is set to spare-only, so you cannot request a spare.',
        'error',
      );
      return;
    }

    if (!selectedLeague || !selectedPlayer) {
      showAlert('Please choose a league and player.', 'warning');
      return;
    }
    if (!selectedGame) {
      showAlert(
        isManagerLeague
          ? "Please select a game that player's team is scheduled to play."
          : 'Please select a game your team is scheduled to play.',
        'warning',
      );
      return;
    }
    if (requestType === 'private' && selectedInvitees.length === 0) {
      showAlert('Please select at least one member for a private request.', 'warning');
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        leagueId: selectedLeague.id,
        requestedForName: selectedPlayer.name,
        requestedForMemberId: selectedPlayer.memberId,
        gameId: selectedGame.id,
        gameDate: selectedGame.date,
        gameTime: selectedGame.time,
        position: selectedPlayer.sparePosition ?? undefined,
        message: message.trim() || undefined,
        requestType,
        invitedMemberIds: requestType === 'private' ? selectedInvitees : undefined,
      };

      let response = await post('/spares', payload);

      if ('duplicate' in response && response.duplicate) {
        const existing = response.existingRequest;
        const proceed = await confirm({
          title: 'Similar request already exists',
          message: `There is already a spare request for ${existing.requestedForName} on ${existing.gameDate} at ${existing.gameTime}${
            existing.leagueName ? ` (${existing.leagueName})` : ''
          }. Create another anyway?`,
          confirmText: 'Create anyway',
          cancelText: 'Cancel',
        });
        if (!proceed) {
          setSubmitting(false);
          return;
        }
        response = await post('/spares', { ...payload, allowDuplicate: true });
      }

      if ('id' in response && response.success) {
        showAlert('Spare request submitted.', 'success');
        navigate('/my-requests');
        return;
      }

      showAlert('Spare request submitted.', 'success');
      navigate('/my-requests');
    } catch (error) {
      console.error('Failed to create spare request:', error);
      showAlert(formatApiError(error, 'Failed to submit spare request'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AppPage narrow>
      <AppPageHeader
        title="Request a spare"
        description="Choose your league, who needs covering, and the game. Your teammates are notified automatically."
      />

      {cannotCreateSpareRequest && isSpareOnly && (
        <div className="app-alert border-yellow-200 bg-yellow-50 text-yellow-800 dark:border-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-300">
          Your account is marked as <span className="font-semibold">spare-only</span>, so you
          can&apos;t create spare requests. If this is a mistake, please ask an admin to update your
          account.
        </div>
      )}
      {cannotCreateSpareRequest && isSocialMember && !isSpareOnly && (
        <div className="app-alert border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
          Your account is a <span className="font-semibold">social membership</span>, which does not
          include spare requests. If this is a mistake, ask an administrator to update your account.
        </div>
      )}

      {loading ? <AppStateCard title="Loading your leagues…" /> : null}

      {!cannotCreateSpareRequest && !loading && loadError ? (
        <AppStateCard
          title="Could not load your leagues"
          description="Please try again in a moment."
        />
      ) : null}

      {!cannotCreateSpareRequest && !loading && !loadError && leagues.length === 0 ? (
        <AppStateCard
          title={
            leagueProcessingActive && !memberCanBypassLeagueProcessingHold(member)
              ? 'League rosters are currently being processed'
              : 'No leagues available for spare requests'
          }
          description={
            leagueProcessingActive && !memberCanBypassLeagueProcessingHold(member)
              ? LEAGUE_PROCESSING_ROSTER_MESSAGE
              : 'You need to be on a team in a league this session. Instructional and drop-in leagues are not eligible for spare requests.'
          }
          action={
            <Link to="/dashboard" className="text-sm font-semibold text-primary-teal-link hover:underline">
              Back to dashboard
            </Link>
          }
        />
      ) : null}

      {!cannotCreateSpareRequest && !loading && !loadError && leagues.length > 0 ? (
        <form onSubmit={handleSubmit} className="app-card space-y-8 p-6">
          <FormSection
            title="Game details"
            description={
              managesAnyLeague
                ? 'Leagues you are on a team for this session are listed, plus leagues you manage. League managers can request a spare for any player in leagues they manage. Instructional and drop-in leagues are not eligible.'
                : 'Only leagues you are on a team for this session are listed. Instructional and drop-in leagues are not eligible.'
            }
          >
            {leagues.length === 1 && selectedLeague ? (
              <FormField label="League">
                <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-800 dark:border-gray-600 dark:bg-gray-700/40 dark:text-gray-100">
                  <div className="font-medium">{selectedLeague.name}</div>
                  <div className="text-xs text-gray-600 dark:text-gray-300">
                    {dayNames[selectedLeague.dayOfWeek]}
                    {selectedLeague.isManager
                      ? ' · You manage this league'
                      : selectedLeague.teamName
                        ? ` · ${selectedLeague.teamName}`
                        : ''}
                  </div>
                </div>
              </FormField>
            ) : (
              <FormField label="League" htmlFor={leagueFieldId} required>
                {({ describedBy, invalid }) => (
                  <ChoiceInput<string>
                    inputId={leagueFieldId}
                    options={leagueOptions}
                    value={selectedLeagueId || null}
                    onChange={handleLeagueChange}
                    placeholder="Select a league"
                    listboxLabel="League"
                    required
                    disabled={loading}
                    ariaDescribedBy={describedBy}
                    ariaInvalid={invalid}
                  />
                )}
              </FormField>
            )}

            {selectedLeagueId && !hasTeamAssignment ? (
              <div
                className="app-alert border-sky-200 bg-sky-50 text-sky-950 dark:border-sky-800 dark:bg-sky-900/20 dark:text-sky-100"
                role="status"
              >
                You are on this league&apos;s roster, but you have not been assigned to a team yet.
                Spare requests are available after your league coordinator places you on a team.
              </div>
            ) : null}

            {selectedLeagueId && isManagerLeague && playerChoices.length === 0 ? (
              <div
                className="app-alert border-sky-200 bg-sky-50 text-sky-950 dark:border-sky-800 dark:bg-sky-900/20 dark:text-sky-100"
                role="status"
              >
                No players have been placed on teams in this league yet.
              </div>
            ) : null}

            {selectedLeagueId && !isManagerLeague && hasTeamAssignment && !ownTeamHasGames ? (
              <div
                className="app-alert border-sky-200 bg-sky-50 text-sky-950 dark:border-sky-800 dark:bg-sky-900/20 dark:text-sky-100"
                role="status"
              >
                Your team does not have any upcoming scheduled games in this league, so there is
                nothing to request a spare for right now.
              </div>
            ) : null}

            {showPlayerStep ? (
              <FormField label="Who needs a spare" htmlFor={playerFieldId} required>
                {({ describedBy, invalid }) => (
                  <ChoiceInput<string>
                    inputId={playerFieldId}
                    options={playerOptions}
                    value={selectedPlayerId != null ? String(selectedPlayerId) : null}
                    onChange={handlePlayerChange}
                    placeholder="Select a player"
                    listboxLabel="Who needs a spare"
                    required
                    disabled={playerOptions.length === 0}
                    ariaDescribedBy={describedBy}
                    ariaInvalid={invalid}
                  />
                )}
              </FormField>
            ) : null}

            {isManagerLeague && selectedPlayer && !hasUpcomingGames ? (
              <div
                className="app-alert border-sky-200 bg-sky-50 text-sky-950 dark:border-sky-800 dark:bg-sky-900/20 dark:text-sky-100"
                role="status"
              >
                {selectedPlayer.teamName ?? 'That player’s team'} does not have any upcoming
                scheduled games in this league.
              </div>
            ) : null}

            {showGameStep ? (
              <FormField label="Which game" htmlFor={gameSlotFieldId} required>
                {({ describedBy, invalid }) => (
                  <ChoiceInput<string>
                    inputId={gameSlotFieldId}
                    options={gameSlotOptions}
                    value={selectedGameSlot || null}
                    onChange={(next) => setSelectedGameSlot(typeof next === 'string' ? next : '')}
                    placeholder="Select a game"
                    listboxLabel="Which game"
                    required
                    ariaDescribedBy={describedBy}
                    ariaInvalid={invalid}
                  />
                )}
              </FormField>
            ) : null}
          </FormSection>

          {showPreferencesStep ? (
            <>
              <FormSection>
                <FormField label="Personal message" htmlFor={messageFieldId} optional>
                  <textarea
                    id={messageFieldId}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    className="app-input"
                    rows={3}
                    placeholder="Any additional details for potential spares."
                  />
                </FormField>

                <FormField label="Request type" required>
                  <div className="space-y-2">
                    <label className="flex cursor-pointer items-start rounded-md border border-gray-300 p-4 hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-700/50">
                      <input
                        type="radio"
                        name="requestType"
                        value="public"
                        checked={requestType === 'public'}
                        onChange={() => setRequestType('public')}
                        className="mr-3 mt-1"
                      />
                      <div>
                        <div className="font-medium dark:text-gray-100">Public</div>
                        <div className="text-sm text-gray-600 dark:text-gray-400">
                          Open to all club members. League members on bye are prioritized
                          automatically.
                        </div>
                      </div>
                    </label>

                    <div
                      className={`rounded-md border border-gray-300 p-4 dark:border-gray-600 ${
                        requestType === 'private'
                          ? 'bg-gray-50 dark:bg-gray-700/40'
                          : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'
                      }`}
                    >
                      <label className="flex cursor-pointer items-start">
                        <input
                          type="radio"
                          name="requestType"
                          value="private"
                          checked={requestType === 'private'}
                          onChange={() => setRequestType('private')}
                          className="mr-3 mt-1"
                        />
                        <div>
                          <div className="font-medium dark:text-gray-100">Private</div>
                          <div className="text-sm text-gray-600 dark:text-gray-400">
                            Invite specific members only.
                          </div>
                        </div>
                      </label>

                      {requestType === 'private' ? (
                        <div className="mt-4 space-y-3 border-t border-gray-200 pt-4 dark:border-gray-600">
                          <FormField
                            label="Select members to invite"
                            required
                          >
                            <MemberMultiSelect
                              selectedIds={selectedInvitees}
                              onChange={setSelectedInvitees}
                              placeholder="Search for members…"
                              disabled={loading}
                              noMatchesText="No members found"
                              filterOption={(option) => {
                                if (option.id === member?.id) return false;
                                return !(
                                  selectedPlayer?.teammates.some(
                                    (player) => player.memberId === option.id,
                                  ) ?? false
                                );
                              }}
                            />
                          </FormField>

                          {loadingAvailableMembers || availableMembers.length > 0 ? (
                            <div>
                              <div className="app-label mb-3">
                                Members available for {selectedLeague?.name || 'this league'}
                              </div>
                              {loadingAvailableMembers ? (
                                <div className="py-2 text-center text-sm text-gray-500 dark:text-gray-400">
                                  Loading…
                                </div>
                              ) : availableMembers.filter((m) => !selectedInvitees.includes(m.id))
                                  .length === 0 ? (
                                <div className="py-2 text-center text-sm text-gray-500 dark:text-gray-400">
                                  All available members have been selected
                                </div>
                              ) : (
                                <div className="max-h-48 space-y-2 overflow-y-auto">
                                  {availableMembers
                                    .filter((m) => !selectedInvitees.includes(m.id))
                                    .map((m) => (
                                      <div
                                        key={m.id}
                                        className="flex items-center justify-between rounded border border-gray-200 bg-white p-2 transition-colors hover:border-primary-teal dark:border-gray-600 dark:bg-gray-800"
                                      >
                                        <div className="flex-1">
                                          <div className="text-sm font-medium dark:text-gray-100">
                                            {m.name}
                                          </div>
                                          {m.email ? (
                                            <div className="text-xs text-gray-500 dark:text-gray-400">
                                              <MemberEmail email={m.email} parentEmail={m.parentEmail} />
                                            </div>
                                          ) : null}
                                        </div>
                                        <button
                                          type="button"
                                          onClick={() =>
                                            setSelectedInvitees((prev) =>
                                              prev.includes(m.id) ? prev : [...prev, m.id],
                                            )
                                          }
                                          className="ml-3 rounded bg-primary-teal-solid px-3 py-1 text-sm text-white transition-colors hover:bg-opacity-80"
                                        >
                                          +
                                        </button>
                                      </div>
                                    ))}
                                </div>
                              )}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </FormField>
              </FormSection>

              <div className="flex justify-end">
                <Button type="submit" disabled={!canSubmit}>
                  {submitting ? 'Submitting…' : 'Submit request'}
                </Button>
              </div>
            </>
          ) : null}
        </form>
      ) : null}
    </AppPage>
  );
}
