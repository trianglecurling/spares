import { useEffect, useMemo, useState } from 'react';
import { del, get, patch, post, put } from '../../api/client';
import { formatApiError } from '../../utils/api';
import { useAlert } from '../../contexts/AlertContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import Button from '../../components/Button';
import Modal from '../../components/Modal';

interface Team {
  id: number;
  name: string | null;
  divisionName: string;
}

interface Game {
  id: number;
  leagueId: number;
  team1Id: number;
  team2Id: number;
  team1Name: string | null;
  team2Name: string | null;
  gameDate: string | null;
  gameTime: string | null;
  sheetId: number | null;
  sheetName: string | null;
  status: 'scheduled' | 'unscheduled';
  hasResult?: boolean;
  team1Results?: number[];
  team2Results?: number[];
}

interface DrawSlot {
  date: string;
  time: string;
  isExtra: boolean;
  extraDrawId: number | null;
  sheets: Array<{ id: number; name: string; isAvailable: boolean }>;
}

interface Sheet {
  id: number;
  name: string;
  sortOrder: number;
  isActive: boolean;
}

interface LeagueScheduleProps {
  leagueId: number;
  teams: Team[];
  canManage: boolean;
  memberTeamIds: number[];
  leagueFormat: 'teams' | 'doubles';
}

const formatDateDisplay = (dateString: string) => {
  if (!dateString) return '';
  const date = new Date(dateString);
  const userTimezoneOffset = date.getTimezoneOffset() * 60000;
  const adjustedDate = new Date(date.getTime() + userTimezoneOffset);
  return adjustedDate.toLocaleDateString();
};

const formatTime = (time: string) => {
  if (!time) return '';
  const [hourStr, minuteStr] = time.split(':');
  const hour = parseInt(hourStr, 10);
  const minutes = minuteStr.padStart(2, '0');
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return `${displayHour}:${minutes} ${ampm}`;
};

function isGameInPast(game: Game): boolean {
  if (!game.gameDate) return false;
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  return game.gameDate < todayStr;
}

const roleLabels: Record<string, string> = {
  lead: 'Lead',
  second: 'Second',
  third: 'Third',
  fourth: 'Fourth',
  player1: 'Player 1',
  player2: 'Player 2',
};
const teamRoleOrder = ['fourth', 'third', 'second', 'lead'] as const;

export default function LeagueSchedule({ leagueId, teams, canManage, memberTeamIds, leagueFormat }: LeagueScheduleProps) {
  const { showAlert } = useAlert();
  const { confirm } = useConfirm();
  const [games, setGames] = useState<Game[]>([]);
  const [drawSlots, setDrawSlots] = useState<DrawSlot[]>([]);
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [loadingGames, setLoadingGames] = useState(true);
  const [loadingDraws, setLoadingDraws] = useState(true);
  const [savingGame, setSavingGame] = useState(false);

  const [gameModalOpen, setGameModalOpen] = useState(false);
  const [editingGame, setEditingGame] = useState<Game | null>(null);
  const [gameForm, setGameForm] = useState({
    team1Id: '',
    team2Id: '',
    gameDate: '',
    gameTime: '',
    sheetId: '',
    status: 'scheduled' as 'scheduled' | 'unscheduled',
  });

  const [extraDrawForm, setExtraDrawForm] = useState({
    date: '',
    time: '',
  });

  const [addingDrawTime, setAddingDrawTime] = useState(false);
  const [showMineOnly, setShowMineOnly] = useState(false);

  const [detailsGame, setDetailsGame] = useState<Game | null>(null);
  const [detailsLineups, setDetailsLineups] = useState<{
    team1Lineup: Array<{ memberName: string; role: string; isSpare: boolean; sparingForMemberName: string | null; isSkip?: boolean; isVice?: boolean }>;
    team2Lineup: Array<{ memberName: string; role: string; isSpare: boolean; sparingForMemberName: string | null; isSkip?: boolean; isVice?: boolean }>;
  } | null>(null);
  const [loadingDetailsLineups, setLoadingDetailsLineups] = useState(false);

  const [resultForm, setResultForm] = useState<{ team1Values: number[]; team2Values: number[] }>({
    team1Values: [0],
    team2Values: [0],
  });
  const [resultLabels, setResultLabels] = useState<string[]>([]);
  const [savingResult, setSavingResult] = useState(false);
  const [editTab, setEditTab] = useState<'details' | 'results' | null>(null);
  const [loadingEditData, setLoadingEditData] = useState(false);

  const selectedDrawKey = useMemo(() => {
    if (!gameForm.gameDate || !gameForm.gameTime) return '';
    return `${gameForm.gameDate}|${gameForm.gameTime}`;
  }, [gameForm.gameDate, gameForm.gameTime]);

  const teamsInSelectedDraw = useMemo(() => {
    if (!selectedDrawKey || addingDrawTime) return new Set<number>();
    const teamsInDraw = new Set<number>();
    games.forEach((game) => {
      if (editingGame && game.id === editingGame.id) return;
      if (game.status !== 'scheduled' || !game.gameDate || !game.gameTime) return;
      const key = `${game.gameDate}|${game.gameTime}`;
      if (key !== selectedDrawKey) return;
      teamsInDraw.add(game.team1Id);
      teamsInDraw.add(game.team2Id);
    });
    return teamsInDraw;
  }, [games, selectedDrawKey, addingDrawTime, editingGame]);

  const selectedDrawSlot = useMemo(() => {
    if (!selectedDrawKey) return null;
    return drawSlots.find((slot) => `${slot.date}|${slot.time}` === selectedDrawKey) ?? null;
  }, [drawSlots, selectedDrawKey]);

  const teamLabelById = useMemo(() => {
    const map = new Map<number, string>();
    teams.forEach((team) => {
      const name = team.name?.trim();
      map.set(team.id, name || `Team ${team.id}`);
    });
    return map;
  }, [teams]);

  const teamOptions = useMemo(() => {
    return teams
      .slice()
      .sort((a, b) => {
        const divisionOrder = a.divisionName.localeCompare(b.divisionName);
        if (divisionOrder !== 0) return divisionOrder;
        const nameA = a.name || `Team ${a.id}`;
        const nameB = b.name || `Team ${b.id}`;
        return nameA.localeCompare(nameB);
      })
      .map((team) => ({
        id: team.id,
        label: `${team.name || `Team ${team.id}`} · ${team.divisionName}`,
      }));
  }, [teams]);

  const filteredTeam1Options = useMemo(() => {
    const team2Id = Number(gameForm.team2Id);
    return teamOptions.filter((team) => team.id !== team2Id && !teamsInSelectedDraw.has(team.id));
  }, [teamOptions, gameForm.team2Id, teamsInSelectedDraw]);

  const filteredTeam2Options = useMemo(() => {
    const team1Id = Number(gameForm.team1Id);
    return teamOptions.filter((team) => team.id !== team1Id && !teamsInSelectedDraw.has(team.id));
  }, [teamOptions, gameForm.team1Id, teamsInSelectedDraw]);

  const availableTeamsForDrawCount = useMemo(() => {
    if (!selectedDrawKey || addingDrawTime) return teamOptions.length;
    return teamOptions.filter((team) => !teamsInSelectedDraw.has(team.id)).length;
  }, [teamOptions, teamsInSelectedDraw, selectedDrawKey, addingDrawTime]);

  const availableSheetsForDrawCount = useMemo(() => {
    if (!selectedDrawSlot || addingDrawTime) return 0;
    return selectedDrawSlot.sheets.filter((sheet) => sheet.isAvailable).length;
  }, [selectedDrawSlot, addingDrawTime]);

  const filteredGames = useMemo(() => {
    if (!showMineOnly || memberTeamIds.length === 0) {
      return games;
    }
    return games.filter(
      (game) => memberTeamIds.includes(game.team1Id) || memberTeamIds.includes(game.team2Id)
    );
  }, [games, showMineOnly, memberTeamIds]);

  const scheduledGames = useMemo(() => {
    return filteredGames
      .filter((game) => game.status === 'scheduled' && game.gameDate && game.gameTime)
      .sort((a, b) => {
        if (a.gameDate !== b.gameDate) {
          return (a.gameDate || '').localeCompare(b.gameDate || '');
        }
        if (a.gameTime !== b.gameTime) {
          return (a.gameTime || '').localeCompare(b.gameTime || '');
        }
        return a.id - b.id;
      });
  }, [filteredGames]);

  const drawSlotKeys = useMemo(() => {
    return new Set(drawSlots.map((slot) => `${slot.date}|${slot.time}`));
  }, [drawSlots]);

  const invalidScheduledGames = useMemo(() => {
    return scheduledGames.filter((game) => {
      const key = `${game.gameDate}|${game.gameTime}`;
      return !drawSlotKeys.has(key);
    });
  }, [scheduledGames, drawSlotKeys]);

  const gamesByDrawKey = useMemo(() => {
    const map = new Map<string, Game[]>();
    scheduledGames.forEach((game) => {
      if (!game.gameDate || !game.gameTime) return;
      const key = `${game.gameDate}|${game.gameTime}`;
      if (!drawSlotKeys.has(key)) return;
      const list = map.get(key) ?? [];
      list.push(game);
      map.set(key, list);
    });
    for (const [key, list] of map.entries()) {
      list.sort((a, b) => {
        const sheetA = a.sheetName || '';
        const sheetB = b.sheetName || '';
        return sheetA.localeCompare(sheetB);
      });
      map.set(key, list);
    }
    return map;
  }, [scheduledGames, drawSlotKeys]);

  const unscheduledGames = useMemo(() => {
    return filteredGames
      .filter((game) => game.status === 'unscheduled')
      .sort((a, b) => a.id - b.id);
  }, [filteredGames]);

  const loadGames = async () => {
    setLoadingGames(true);
    try {
      const response = await (get as (path: string, query?: unknown, pathParams?: Record<string, string>) => Promise<unknown>)(
        '/leagues/{id}/games/with-results',
        undefined,
        { id: String(leagueId) }
      );
      setGames(response as Game[]);
    } catch (error: unknown) {
      console.error('Failed to load games:', error);
      showAlert(formatApiError(error, 'Failed to load games'), 'error');
    } finally {
      setLoadingGames(false);
    }
  };

  const loadDrawSlots = async () => {
    setLoadingDraws(true);
    try {
      const response = await get('/leagues/{id}/draw-slots', undefined, { id: String(leagueId) });
      setDrawSlots(response);
    } catch (error: unknown) {
      console.error('Failed to load draw slots:', error);
      showAlert(formatApiError(error, 'Failed to load draw slots'), 'error');
    } finally {
      setLoadingDraws(false);
    }
  };

  const loadSheets = async () => {
    try {
      const response = await get('/sheets');
      setSheets(response.filter((sheet: Sheet) => sheet.isActive));
    } catch (error: unknown) {
      console.error('Failed to load sheets:', error);
    }
  };

  useEffect(() => {
    loadGames();
    loadDrawSlots();
    loadSheets();
  }, [leagueId]);

  const openGameModal = (game?: Game) => {
    if (game) {
      setEditingGame(game);
      setEditTab(isGameInPast(game) ? 'results' : 'details');
      setGameForm({
        team1Id: String(game.team1Id),
        team2Id: String(game.team2Id),
        gameDate: game.gameDate ?? '',
        gameTime: game.gameTime ?? '',
        sheetId: game.sheetId ? String(game.sheetId) : '',
        status: game.status,
      });
      setAddingDrawTime(false);
      setExtraDrawForm({ date: '', time: '' });
      setResultForm({ team1Values: [0], team2Values: [0] });
      setResultLabels([]);
      setLoadingEditData(true);
      setGameModalOpen(true);
      const getUntyped = get as (path: string, query?: unknown, pathParams?: Record<string, string>) => Promise<unknown>;
      Promise.all([
        getUntyped('/games/{gameId}/results', undefined, { gameId: String(game.id) }),
        getUntyped('/leagues/{id}/settings', undefined, { id: String(leagueId) }),
      ])
        .then(([resultsRes, settingsRes]) => {
          const results = resultsRes as { team1Results: Array<{ resultOrder: number; value: number }>; team2Results: Array<{ resultOrder: number; value: number }> };
          const settings = settingsRes as { resultLabels: string[] | null };
          setResultLabels(settings?.resultLabels ?? []);
          const len = Math.max(results?.team1Results?.length ?? 0, results?.team2Results?.length ?? 0, 1);
          const t1 = Array.from({ length: len }, (_, i) => results?.team1Results?.find((r) => r.resultOrder === i)?.value ?? 0);
          const t2 = Array.from({ length: len }, (_, i) => results?.team2Results?.find((r) => r.resultOrder === i)?.value ?? 0);
          setResultForm({ team1Values: t1, team2Values: t2 });
        })
        .catch(() => {
          setResultForm({ team1Values: [0], team2Values: [0] });
          setResultLabels([]);
        })
        .finally(() => setLoadingEditData(false));
    } else {
      setEditingGame(null);
      setEditTab(null);
      setLoadingEditData(false);
      setGameForm({
        team1Id: '',
        team2Id: '',
        gameDate: '',
        gameTime: '',
        sheetId: '',
        status: 'scheduled',
      });
      setAddingDrawTime(false);
      setExtraDrawForm({ date: '', time: '' });
      setResultForm({ team1Values: [0], team2Values: [0] });
      setResultLabels([]);
      setGameModalOpen(true);
    }
  };

  const openGameDetails = async (game: Game) => {
    setDetailsGame(game);
    setDetailsLineups(null);
    setLoadingDetailsLineups(true);
    try {
      const res = await (get as (path: string, query?: unknown, pathParams?: Record<string, string>) => Promise<unknown>)(
        '/games/{gameId}/lineups',
        undefined,
        { gameId: String(game.id) }
      ) as { team1Lineup: Array<{ memberName: string; role: string; isSpare: boolean; sparingForMemberName: string | null }>; team2Lineup: Array<{ memberName: string; role: string; isSpare: boolean; sparingForMemberName: string | null }> };
      setDetailsLineups({ team1Lineup: res.team1Lineup, team2Lineup: res.team2Lineup });
    } catch {
      setDetailsLineups({ team1Lineup: [], team2Lineup: [] });
    } finally {
      setLoadingDetailsLineups(false);
    }
  };

  const closeGameModal = () => {
    setGameModalOpen(false);
    setEditingGame(null);
    setEditTab(null);
    setLoadingEditData(false);
  };

  const handleSaveGame = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canManage) return;

    const team1Id = Number(gameForm.team1Id);
    const team2Id = Number(gameForm.team2Id);

    if (!team1Id || !team2Id) {
      showAlert('Select both teams before saving.', 'warning');
      return;
    }
    if (team1Id === team2Id) {
      showAlert('Teams must be different.', 'warning');
      return;
    }

    const isScheduled = gameForm.status === 'scheduled';
    if (isScheduled && addingDrawTime && (!extraDrawForm.date || !extraDrawForm.time)) {
      showAlert('Select a date and time for the new draw.', 'warning');
      return;
    }
    if (isScheduled && !addingDrawTime && (!gameForm.gameDate || !gameForm.gameTime)) {
      showAlert('Scheduled games need a draw time.', 'warning');
      return;
    }
    if (isScheduled && !gameForm.sheetId) {
      showAlert('Scheduled games need a sheet selection.', 'warning');
      return;
    }

    let gameDate = gameForm.gameDate;
    let gameTime = gameForm.gameTime;
    let createdExtraDrawId: number | null = null;

    const payload = {
      team1Id,
      team2Id,
      status: gameForm.status,
      ...(isScheduled
        ? {
            gameDate,
            gameTime,
            sheetId: Number(gameForm.sheetId),
          }
        : {}),
    };

    setSavingGame(true);
    try {
      if (isScheduled && addingDrawTime) {
        const extraDraw = await post('/leagues/{id}/extra-draws', extraDrawForm, { id: String(leagueId) });
        createdExtraDrawId = extraDraw.id;
        gameDate = extraDrawForm.date;
        gameTime = extraDrawForm.time;
        payload.gameDate = gameDate;
        payload.gameTime = gameTime;
      }

      if (editingGame) {
        await patch('/games/{gameId}', payload, { gameId: String(editingGame.id) });
        setSavingResult(true);
        try {
          await saveResultForGame(editingGame.id);
          setGames((prev) =>
            prev.map((g) =>
              g.id === editingGame.id
                ? {
                    ...g,
                    ...payload,
                    hasResult: true,
                    team1Results: resultForm.team1Values,
                    team2Results: resultForm.team2Values,
                  }
                : g
            )
          );
        } catch (err) {
          showAlert(formatApiError(err, 'Failed to save result'), 'error');
        } finally {
          setSavingResult(false);
        }
        closeGameModal();
        return;
      } else {
        await post('/leagues/{id}/games', payload, { id: String(leagueId) });
      }
      await loadGames();
      closeGameModal();
      if (createdExtraDrawId) {
        await loadDrawSlots();
      }
    } catch (error: unknown) {
      console.error('Failed to save game:', error);
      showAlert(formatApiError(error, 'Failed to save game'), 'error');
      if (createdExtraDrawId) {
        try {
          await del('/leagues/{leagueId}/extra-draws/{drawId}', undefined, {
            leagueId: String(leagueId),
            drawId: String(createdExtraDrawId),
          });
        } catch (cleanupError) {
          console.error('Failed to clean up extra draw:', cleanupError);
        }
      }
    } finally {
      setSavingGame(false);
    }
  };

  const handleDeleteGame = async (game: Game) => {
    if (!canManage) return;
    const confirmed = await confirm({
      title: 'Delete game',
      message: 'Are you sure you want to delete this game?',
      confirmText: 'Delete',
      variant: 'danger',
    });
    if (!confirmed) return;

    try {
      await del('/games/{gameId}', undefined, { gameId: String(game.id) });
      setGames((prev) => prev.filter((g) => g.id !== game.id));
      if (editingGame?.id === game.id) {
        closeGameModal();
      }
    } catch (error: unknown) {
      console.error('Failed to delete game:', error);
      showAlert(formatApiError(error, 'Failed to delete game'), 'error');
    }
  };

  const saveResultForGame = async (gameId: number) => {
    (put as (path: string, body: unknown, pathParams?: Record<string, string>) => Promise<unknown>)(
      '/games/{gameId}/results',
      {
        team1Results: resultForm.team1Values.map((value, resultOrder) => ({ resultOrder, value })),
        team2Results: resultForm.team2Values.map((value, resultOrder) => ({ resultOrder, value })),
      },
      { gameId: String(gameId) }
    );
  };

  const formatResultSummary = (game: Game) => {
    if (!game.hasResult || !game.team1Results?.length) return null;
    const t1 = game.team1Results;
    const t2 = game.team2Results ?? [];
    if (t1.length === 1 && t2.length <= 1) return `${t1[0]} - ${t2[0] ?? 0}`;
    return `${t1.join(' - ')} vs ${t2.join(' - ')}`;
  };

  const getWinnerTeamId = (game: Game): number | null => {
    if (!game.hasResult || !game.team1Results?.length) return null;
    const t1 = game.team1Results;
    const t2 = game.team2Results ?? [];
    for (let i = 0; i < Math.max(t1.length, t2.length); i++) {
      const v1 = t1[i] ?? 0;
      const v2 = t2[i] ?? 0;
      if (v1 > v2) return game.team1Id;
      if (v2 > v1) return game.team2Id;
    }
    return null;
  };

  if (loadingDraws || loadingGames) {
    return <div className="text-sm text-gray-500 dark:text-gray-400">Loading schedule...</div>;
  }

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-1">
            <button
              type="button"
              onClick={() => setShowMineOnly(false)}
              className={`px-3 py-1 text-sm font-medium rounded-md ${
                showMineOnly
                  ? 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                  : 'bg-primary-teal text-white'
              }`}
            >
              Show all games
            </button>
            <button
              type="button"
              onClick={() => setShowMineOnly(true)}
              disabled={memberTeamIds.length === 0}
              className={`px-3 py-1 text-sm font-medium rounded-md ${
                showMineOnly
                  ? 'bg-primary-teal text-white'
                  : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
              } ${memberTeamIds.length === 0 ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              Show my games
            </button>
          </div>
          {canManage && (
            <Button onClick={() => openGameModal()} variant="secondary">
              Add game
            </Button>
          )}
        </div>

        {drawSlots.length === 0 ? (
          <div className="text-sm text-gray-500 dark:text-gray-400">No draws configured yet.</div>
        ) : (
          <div className="space-y-3">
            {drawSlots.map((draw) => {
              return (
                <div
                  key={`${draw.date}-${draw.time}`}
                  className="flex flex-col gap-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-sm font-medium text-gray-800 dark:text-gray-200">
                        {formatDateDisplay(draw.date)} · {formatTime(draw.time)}
                        {draw.isExtra && (
                          <span className="ml-2 rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-700">
                            Extra
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="text-sm text-gray-700 dark:text-gray-300">
                    {(gamesByDrawKey.get(`${draw.date}|${draw.time}`) ?? []).length === 0 ? (
                      <span className="text-gray-500 dark:text-gray-400">
                        {showMineOnly ? 'No games scheduled for your teams.' : 'No games scheduled.'}
                      </span>
                    ) : (
                      <div className="space-y-1">
                        {(gamesByDrawKey.get(`${draw.date}|${draw.time}`) ?? []).map((game) => {
                          const winnerId = getWinnerTeamId(game);
                          const t1Label = teamLabelById.get(game.team1Id);
                          const t2Label = teamLabelById.get(game.team2Id);
                          return (
                            <div key={game.id} className="flex flex-wrap items-center gap-2">
                              <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">
                                {game.sheetName || 'Sheet TBD'}
                              </span>
                              <button
                                type="button"
                                onClick={() => openGameDetails(game)}
                                className="font-medium text-gray-800 dark:text-gray-100 hover:text-primary-teal hover:underline"
                              >
                                <span className={winnerId === game.team1Id ? 'font-semibold text-primary-teal' : ''}>
                                  {t1Label}
                                </span>
                                {' vs '}
                                <span className={winnerId === game.team2Id ? 'font-semibold text-primary-teal' : ''}>
                                  {t2Label}
                                </span>
                              </button>
                              {formatResultSummary(game) && (
                                <span className="text-sm text-gray-500 dark:text-gray-400">
                                  ({formatResultSummary(game)})
                                </span>
                              )}
                              {canManage && (
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); openGameModal(game); }}
                                  className="rounded p-1 text-gray-500 hover:bg-gray-200 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200"
                                  title="Edit game"
                                  aria-label="Edit game"
                                >
                                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                  </svg>
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  {!showMineOnly && (() => {
                    const scheduledTeamIds = new Set<number>();
                    (gamesByDrawKey.get(`${draw.date}|${draw.time}`) ?? []).forEach((game) => {
                      scheduledTeamIds.add(game.team1Id);
                      scheduledTeamIds.add(game.team2Id);
                    });
                    const byeTeams = teams.filter((team) => !scheduledTeamIds.has(team.id));
                    if (byeTeams.length === 0) return null;
                    return (
                      <div className="text-sm text-gray-500 dark:text-gray-400">
                        Bye: {byeTeams.map((team) => team.name || `Team ${team.id}`).join(', ')}
                      </div>
                    );
                  })()}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {canManage && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Unscheduled games</h3>
          {unscheduledGames.length === 0 && invalidScheduledGames.length === 0 ? (
            <div className="text-sm text-gray-500 dark:text-gray-400">No unscheduled games.</div>
          ) : (
            <div className="space-y-2">
            {unscheduledGames.map((game) => {
                const winnerId = getWinnerTeamId(game);
                const t1Label = teamLabelById.get(game.team1Id);
                const t2Label = teamLabelById.get(game.team2Id);
                return (
                <div
                  key={game.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/40 px-3 py-2"
                >
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => openGameDetails(game)}
                    className="text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-primary-teal hover:underline"
                  >
                    <span className={winnerId === game.team1Id ? 'font-semibold text-primary-teal' : ''}>
                      {t1Label}
                    </span>
                    {' vs '}
                    <span className={winnerId === game.team2Id ? 'font-semibold text-primary-teal' : ''}>
                      {t2Label}
                    </span>
                  </button>
                  {formatResultSummary(game) && (
                    <span className="text-sm text-gray-500 dark:text-gray-400">({formatResultSummary(game)})</span>
                  )}
                  {canManage && (
                    <>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); openGameModal(game); }}
                        className="rounded p-1 text-gray-500 hover:bg-gray-200 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200"
                        title="Edit game"
                        aria-label="Edit game"
                      >
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                        </svg>
                      </button>
                      <Button onClick={() => handleDeleteGame(game)} variant="danger">
                        Delete
                      </Button>
                    </>
                  )}
                </div>
                </div>
              );
              })}
              {invalidScheduledGames.map((game) => (
                <div
                  key={`orphan-${game.id}`}
                  className="flex flex-wrap items-center justify-between gap-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900 dark:border-amber-600/70 dark:bg-amber-900/20 dark:text-amber-100"
                >
                  <div className="text-sm flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => openGameDetails(game)}
                      className="font-medium text-amber-800 hover:underline dark:text-amber-100"
                    >
                      {teamLabelById.get(game.team1Id)} vs {teamLabelById.get(game.team2Id)}
                    </button>
                    <span className="text-xs text-amber-700 dark:text-amber-200">
                      Orphaned draw time
                    </span>
                    {canManage && (
                      <>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); openGameModal(game); }}
                          className="rounded p-1 text-amber-600 hover:bg-amber-200 dark:text-amber-300 dark:hover:bg-amber-800"
                          title="Edit game"
                          aria-label="Edit game"
                        >
                          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                          </svg>
                        </button>
                        <Button onClick={() => handleDeleteGame(game)} variant="danger">
                          Delete
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      <Modal
        isOpen={gameModalOpen}
        onClose={closeGameModal}
        title={editingGame ? 'Edit game' : 'Add game'}
      >
        <form onSubmit={handleSaveGame} className="space-y-4">
          {editingGame && (
            <div className="flex border-b border-gray-200 dark:border-gray-700 -mx-4 px-4">
              <button
                type="button"
                onClick={() => setEditTab('details')}
                className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                  editTab === 'details'
                    ? 'border-primary-teal text-primary-teal'
                    : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
                }`}
              >
                Game details
              </button>
              <button
                type="button"
                onClick={() => setEditTab('results')}
                className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                  editTab === 'results'
                    ? 'border-primary-teal text-primary-teal'
                    : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
                }`}
              >
                Results
              </button>
            </div>
          )}

          {(!editingGame || editTab === 'details') && (
            <div className="space-y-4">
          <div className="flex items-center gap-2">
            <input
              id="unscheduled"
              type="checkbox"
              checked={gameForm.status === 'unscheduled'}
              onChange={(event) =>
                setGameForm((prev) => ({
                  ...prev,
                  status: event.target.checked ? 'unscheduled' : 'scheduled',
                  ...(event.target.checked ? { gameDate: '', gameTime: '', sheetId: '' } : {}),
                }))
              }
              className="rounded border-gray-300 text-primary-teal focus:ring-primary-teal"
            />
            <label htmlFor="unscheduled" className="text-sm text-gray-700 dark:text-gray-300">
              Unscheduled game
            </label>
          </div>

          {gameForm.status !== 'unscheduled' && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Draw time
                </label>
                <select
                  value={addingDrawTime ? '__add__' : selectedDrawKey}
                  onChange={(event) => {
                    const value = event.target.value;
                    if (value === '__add__') {
                      setAddingDrawTime(true);
                      setGameForm((prev) => ({
                        ...prev,
                        gameDate: '',
                        gameTime: '',
                        sheetId: '',
                      }));
                      return;
                    }
                    const [date, time] = value.split('|');
                    setAddingDrawTime(false);
                    setExtraDrawForm({ date: '', time: '' });
                    const drawTeamIds = new Set<number>();
                    games.forEach((game) => {
                      if (editingGame && game.id === editingGame.id) return;
                      if (game.status !== 'scheduled' || !game.gameDate || !game.gameTime) return;
                      const key = `${game.gameDate}|${game.gameTime}`;
                      if (key !== `${date}|${time}`) return;
                      drawTeamIds.add(game.team1Id);
                      drawTeamIds.add(game.team2Id);
                    });
                    setGameForm((prev) => ({
                      ...prev,
                      gameDate: date || '',
                      gameTime: time || '',
                      sheetId: '',
                      team1Id: drawTeamIds.has(Number(prev.team1Id)) ? '' : prev.team1Id,
                      team2Id: drawTeamIds.has(Number(prev.team2Id)) ? '' : prev.team2Id,
                    }));
                  }}
                  className="w-full rounded border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 px-3 py-2"
                >
                  <option value="">Select draw time</option>
                  {drawSlots.map((slot) => (
                    <option key={`${slot.date}|${slot.time}`} value={`${slot.date}|${slot.time}`}>
                      {formatDateDisplay(slot.date)} · {formatTime(slot.time)}
                      {slot.isExtra ? ' (Extra)' : ''}
                    </option>
                  ))}
                  <option value="__add__">Add draw time</option>
                </select>
              </div>

              {addingDrawTime && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      New draw date
                    </label>
                    <input
                      type="date"
                      value={extraDrawForm.date}
                      onChange={(event) => setExtraDrawForm({ ...extraDrawForm, date: event.target.value })}
                      className="w-full rounded border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 px-3 py-2"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      New draw time
                    </label>
                    <input
                      type="time"
                      value={extraDrawForm.time}
                      onChange={(event) => setExtraDrawForm({ ...extraDrawForm, time: event.target.value })}
                      className="w-full rounded border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 px-3 py-2"
                    />
                  </div>
                </div>
              )}

              {!addingDrawTime && selectedDrawKey && availableSheetsForDrawCount === 0 && (
                <div className="text-sm text-amber-700 dark:text-amber-200">
                  There are no available sheets during the selected draw time.
                </div>
              )}

              {!addingDrawTime && selectedDrawKey && availableTeamsForDrawCount < 2 && (
                <div className="text-sm text-amber-700 dark:text-amber-200">
                  Not enough teams are available for a game. Are they already scheduled during this draw?
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Sheet
                </label>
                {addingDrawTime ? (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {sheets.map((sheet) => (
                      <label
                        key={sheet.id}
                        className="flex items-center gap-2 rounded border border-gray-200 dark:border-gray-700 px-3 py-2 text-sm"
                      >
                        <input
                          type="radio"
                          name="sheet"
                          value={sheet.id}
                          checked={gameForm.sheetId === String(sheet.id)}
                          onChange={(event) => setGameForm({ ...gameForm, sheetId: event.target.value })}
                          className="text-primary-teal focus:ring-primary-teal"
                        />
                        {sheet.name}
                      </label>
                    ))}
                  </div>
                ) : !selectedDrawSlot ? (
                  <div className="text-sm text-gray-500 dark:text-gray-400">
                    Select a draw time to see sheet options.
                  </div>
                ) : (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {selectedDrawSlot.sheets.map((sheet) => {
                      const sheetKey = `${selectedDrawSlot.date}|${selectedDrawSlot.time}|${sheet.id}`;
                      const hasGameOnSheet = games.some((game) => {
                        if (editingGame && game.id === editingGame.id) return false;
                        if (game.status !== 'scheduled' || !game.gameDate || !game.gameTime || !game.sheetId) return false;
                        return `${game.gameDate}|${game.gameTime}|${game.sheetId}` === sheetKey;
                      });
                      const isDisabled = hasGameOnSheet || !sheet.isAvailable;
                      return (
                        <label
                          key={sheet.id}
                          className={`flex items-center gap-2 rounded border px-3 py-2 text-sm ${
                            isDisabled
                              ? 'border-gray-200 bg-gray-100 text-gray-400 dark:border-gray-700 dark:bg-gray-800/60'
                              : 'border-gray-200 dark:border-gray-700'
                          }`}
                        >
                          <input
                            type="radio"
                            name="sheet"
                            value={sheet.id}
                            checked={gameForm.sheetId === String(sheet.id)}
                            onChange={(event) => setGameForm({ ...gameForm, sheetId: event.target.value })}
                            disabled={isDisabled}
                            className="text-primary-teal focus:ring-primary-teal"
                          />
                          {sheet.name}
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Team 1
            </label>
            <select
              value={gameForm.team1Id}
              onChange={(event) =>
                setGameForm((prev) => ({
                  ...prev,
                  team1Id: event.target.value,
                  team2Id: prev.team2Id === event.target.value ? '' : prev.team2Id,
                }))
              }
              className="w-full rounded border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 px-3 py-2"
              required
            >
              <option value="">Select team</option>
              {filteredTeam1Options.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Team 2
            </label>
            <select
              value={gameForm.team2Id}
              onChange={(event) =>
                setGameForm((prev) => ({
                  ...prev,
                  team2Id: event.target.value,
                  team1Id: prev.team1Id === event.target.value ? '' : prev.team1Id,
                }))
              }
              className="w-full rounded border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 px-3 py-2"
              required
            >
              <option value="">Select team</option>
              {filteredTeam2Options.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.label}
                </option>
              ))}
            </select>
          </div>
            </div>
          )}

          {editingGame && editTab === 'results' && (
            <div className="space-y-3">
              {loadingEditData ? (
                <div className="flex items-center justify-center py-8 text-gray-500 dark:text-gray-400">
                  <span className="text-sm">Loading result…</span>
                </div>
              ) : (
                <>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Enter a single point value for each team. Add tiebreakers (e.g. ends, total score) if needed.
              </p>
              {resultForm.team1Values.map((_, i) => (
                <div key={i} className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                      {teamLabelById.get(editingGame.team1Id)} — {resultLabels[i] ?? (i === 0 ? 'Points' : `Tiebreaker ${i + 1}`)}
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={resultForm.team1Values[i] ?? 0}
                      onChange={(e) => {
                        const v = parseInt(e.target.value, 10) || 0;
                        setResultForm((prev) => {
                          const next = [...prev.team1Values];
                          next[i] = v;
                          return { ...prev, team1Values: next };
                        });
                      }}
                      className="w-full rounded border border-gray-300 dark:border-gray-600 dark:bg-gray-700 px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                      {teamLabelById.get(editingGame.team2Id)} — {resultLabels[i] ?? (i === 0 ? 'Points' : `Tiebreaker ${i + 1}`)}
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={resultForm.team2Values[i] ?? 0}
                      onChange={(e) => {
                        const v = parseInt(e.target.value, 10) || 0;
                        setResultForm((prev) => {
                          const next = [...prev.team2Values];
                          next[i] = v;
                          return { ...prev, team2Values: next };
                        });
                      }}
                      className="w-full rounded border border-gray-300 dark:border-gray-600 dark:bg-gray-700 px-3 py-2 text-sm"
                    />
                  </div>
                </div>
              ))}
              <button
                type="button"
                onClick={() =>
                  setResultForm((prev) => ({
                    team1Values: [...prev.team1Values, 0],
                    team2Values: [...prev.team2Values, 0],
                  }))
                }
                className="text-sm text-primary-teal hover:underline"
              >
                {resultForm.team1Values.length === 1 ? 'Add first tiebreaker' : 'Add another tiebreaker'}
              </button>
                </>
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-3">
            {editingGame && (
              <Button
                type="button"
                variant="danger"
                onClick={() => handleDeleteGame(editingGame)}
                disabled={savingGame}
              >
                Delete game
              </Button>
            )}
            <div className="ml-auto flex flex-1 gap-3">
              <Button
                type="submit"
                disabled={
                  savingGame ||
                  savingResult ||
                  !gameForm.team1Id ||
                  !gameForm.team2Id ||
                  (gameForm.status === 'scheduled' &&
                    (addingDrawTime
                      ? !extraDrawForm.date || !extraDrawForm.time || !gameForm.sheetId
                      : !selectedDrawKey || !gameForm.sheetId))
                }
                className="flex-1"
              >
                {savingGame || savingResult ? 'Saving...' : 'Save'}
              </Button>
              <Button type="button" variant="secondary" onClick={closeGameModal} className="flex-1">
                Cancel
              </Button>
            </div>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={detailsGame != null}
        onClose={() => { setDetailsGame(null); setDetailsLineups(null); }}
        title={detailsGame ? `${teamLabelById.get(detailsGame.team1Id)} vs ${teamLabelById.get(detailsGame.team2Id)}` : 'Game details'}
      >
        {detailsGame && (
          <div className="space-y-4">
            <div className="text-sm text-gray-600 dark:text-gray-400">
              {detailsGame.gameDate && detailsGame.gameTime ? (
                <>
                  {formatDateDisplay(detailsGame.gameDate)} · {formatTime(detailsGame.gameTime)}
                  {detailsGame.sheetName && ` · ${detailsGame.sheetName}`}
                </>
              ) : (
                'Unscheduled'
              )}
            </div>
            {detailsGame.hasResult && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-gray-800 dark:text-gray-200">Result:</span>
                <span className="text-sm text-gray-600 dark:text-gray-400">
                  {(() => {
                    const winnerId = getWinnerTeamId(detailsGame);
                    const t1 = teamLabelById.get(detailsGame.team1Id);
                    const t2 = teamLabelById.get(detailsGame.team2Id);
                    return (
                      <>
                        <span className={winnerId === detailsGame.team1Id ? 'font-semibold text-primary-teal' : ''}>{t1}</span>
                        {' '}
                        {formatResultSummary(detailsGame)}
                        {' '}
                        <span className={winnerId === detailsGame.team2Id ? 'font-semibold text-primary-teal' : ''}>{t2}</span>
                      </>
                    );
                  })()}
                </span>
              </div>
            )}
            <div>
              <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Lineups</div>
              {loadingDetailsLineups ? (
                <div className="text-sm text-gray-500 dark:text-gray-400">Loading…</div>
              ) : detailsLineups ? (
                <div className="space-y-3">
                  <div>
                    <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-0.5">{teamLabelById.get(detailsGame.team1Id)}</div>
                    <ul className={leagueFormat === 'teams' ? 'mt-2 space-y-1' : 'list-disc list-inside text-sm text-gray-600 dark:text-gray-400 space-y-0.5'}>
                      {detailsLineups.team1Lineup.length === 0 ? (
                        <li className="text-gray-400">No roster</li>
                      ) : leagueFormat === 'teams' ? (
                        teamRoleOrder.map((role) => {
                          const entry = detailsLineups.team1Lineup.find((e) => e.role === role);
                          const suffix = entry?.isSkip ? '*' : entry?.isVice ? '**' : '';
                          return (
                            <li key={role} className="text-sm text-gray-600 dark:text-gray-400">
                              {roleLabels[role] ?? role}: {entry?.memberName ?? 'Unassigned'}
                              {suffix}
                              {entry?.isSpare && entry?.sparingForMemberName && (
                                <span className="text-gray-500"> (sparing for {entry.sparingForMemberName})</span>
                              )}
                            </li>
                          );
                        })
                      ) : (
                        detailsLineups.team1Lineup.map((entry, i) => (
                          <li key={i} className="text-sm text-gray-600 dark:text-gray-400">
                            {entry.memberName}
                            {entry.isSpare && entry.sparingForMemberName && (
                              <span className="text-gray-500"> (sparing for {entry.sparingForMemberName})</span>
                            )}
                          </li>
                        ))
                      )}
                    </ul>
                  </div>
                  <div>
                    <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-0.5">{teamLabelById.get(detailsGame.team2Id)}</div>
                    <ul className={leagueFormat === 'teams' ? 'mt-2 space-y-1' : 'list-disc list-inside text-sm text-gray-600 dark:text-gray-400 space-y-0.5'}>
                      {detailsLineups.team2Lineup.length === 0 ? (
                        <li className="text-gray-400">No roster</li>
                      ) : leagueFormat === 'teams' ? (
                        teamRoleOrder.map((role) => {
                          const entry = detailsLineups.team2Lineup.find((e) => e.role === role);
                          const suffix = entry?.isSkip ? '*' : entry?.isVice ? '**' : '';
                          return (
                            <li key={role} className="text-sm text-gray-600 dark:text-gray-400">
                              {roleLabels[role] ?? role}: {entry?.memberName ?? 'Unassigned'}
                              {suffix}
                              {entry?.isSpare && entry?.sparingForMemberName && (
                                <span className="text-gray-500"> (sparing for {entry.sparingForMemberName})</span>
                              )}
                            </li>
                          );
                        })
                      ) : (
                        detailsLineups.team2Lineup.map((entry, i) => (
                          <li key={i} className="text-sm text-gray-600 dark:text-gray-400">
                            {entry.memberName}
                            {entry.isSpare && entry.sparingForMemberName && (
                              <span className="text-gray-500"> (sparing for {entry.sparingForMemberName})</span>
                            )}
                          </li>
                        ))
                      )}
                    </ul>
                  </div>
                  {leagueFormat === 'teams' && (
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      * Skip · ** Vice
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-sm text-gray-500 dark:text-gray-400">No lineup data.</div>
              )}
            </div>
            {canManage && (
              <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    const gameToEdit = detailsGame;
                    setDetailsGame(null);
                    setDetailsLineups(null);
                    if (gameToEdit) openGameModal(gameToEdit);
                  }}
                >
                  Edit game
                </Button>
              </div>
            )}
          </div>
        )}
      </Modal>

    </div>
  );
}
