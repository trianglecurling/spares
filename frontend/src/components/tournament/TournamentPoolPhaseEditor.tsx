import { Fragment, useCallback, useId, useMemo, useState, type ReactNode } from 'react';
import { HiTrash, HiXMark } from 'react-icons/hi2';
import Button from '../Button';
import ChoiceInput, { type ChoiceOption } from '../ChoiceInput';
import SortableGroups from '../dragDrop/SortableGroups';
import FormField from '../FormField';
import FormSection from '../FormSection';
import InlineStateMessage from '../InlineStateMessage';
import CustomStandingDialog from './CustomStandingDialog';
import TournamentPoolPhaseSettings from './TournamentPoolPhaseSettings';
import { useAlert } from '../../contexts/AlertContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import type { TournamentTeamApi } from '../../types/tournamentTeam';
import {
  decodeSlotSource,
  encodeSlotSource,
  type TournamentDrawState,
  type TournamentGameNode,
  type TournamentPool,
  type TournamentPoolEntry,
  type TournamentSlotSource,
} from '../../utils/tournamentDrawModel';
import { gamesForPhase, poolEntryCode, poolsForPhase } from '../../utils/tournamentDrawPhases';
import { formatDrawBlockOptionLabel } from '../../utils/tournamentDrawSchedule';
import { formatSlotSourceLabel } from '../../utils/tournamentDrawRouting';
import {
  addPoolEntry,
  addPoolGame,
  addPoolToPhase,
  addRoundRobinGames,
  arrangePoolEntries,
  fillPools,
  removeGame,
  removePool,
  removePoolEntry,
  setPoolEntrySource,
} from '../../utils/tournamentPoolEdits';
import { MAX_POOL_COUNT } from '../../utils/tournamentDrawBuilders';
import { buildSlotSourceOptions, CUSTOM_STANDING_OPTION_VALUE } from '../../utils/tournamentSlotOptions';

type UpdateDraw = (fn: (d: TournamentDrawState) => TournamentDrawState, opts?: { markDirty?: boolean }) => void;

type TournamentPoolPhaseEditorProps = {
  draw: TournamentDrawState;
  phaseId: string;
  teams: TournamentTeamApi[];
  teamsById: Map<number, TournamentTeamApi>;
  updateDraw: UpdateDraw;
};

type CustomTarget =
  | { kind: 'entry'; poolId: string; entryId: string }
  | { kind: 'game'; gameId: string; slotIndex: number };

const CROSS_POOL = '__cross';
const NOT_SET = '__none';

export default function TournamentPoolPhaseEditor({
  draw,
  phaseId,
  teams,
  teamsById,
  updateDraw,
}: TournamentPoolPhaseEditorProps) {
  const { showAlert } = useAlert();
  const { confirm } = useConfirm();
  const [customTarget, setCustomTarget] = useState<CustomTarget | null>(null);
  const pools = useMemo(() => poolsForPhase(draw, phaseId), [draw, phaseId]);
  const games = useMemo(() => gamesForPhase(draw, phaseId), [draw, phaseId]);
  const teamIdsInSeedOrder = useMemo(
    () => [...teams].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id).map((t) => t.id),
    [teams],
  );

  const customInitial = useMemo(() => {
    if (!customTarget) return null;
    const source =
      customTarget.kind === 'entry'
        ? draw.pools.find((p) => p.id === customTarget.poolId)?.entries.find((e) => e.id === customTarget.entryId)
            ?.source
        : draw.games[customTarget.gameId]?.slots[customTarget.slotIndex];
    return source?.sourceType === 'standing' ? source : null;
  }, [draw, customTarget]);

  const deletePool = async (pool: TournamentPool) => {
    const poolGames = games.filter((g) => g.poolId === pool.id).length;
    if (pool.entries.length > 0 || poolGames > 0) {
      const ok = await confirm({
        title: `Delete ${pool.name}?`,
        message:
          poolGames > 0
            ? `Its teams and ${poolGames === 1 ? 'game' : `${poolGames} games`} are removed too.`
            : 'Its teams are removed from this phase.',
        confirmText: 'Delete pool',
        variant: 'danger',
      });
      if (!ok) return;
    }
    updateDraw((d) => removePool(d, pool.id));
  };

  const applyCustom = (source: TournamentSlotSource) => {
    const target = customTarget;
    setCustomTarget(null);
    if (!target) return;
    if (target.kind === 'entry') {
      updateDraw((d) => setPoolEntrySource(d, target.poolId, target.entryId, source));
      return;
    }
    updateDraw((d) => setGameSlot(d, target.gameId, target.slotIndex, source));
  };

  return (
    <div className="space-y-6">
      <FormSection title="Pools" surface="panel">
        <div className="mb-4 flex flex-wrap justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            disabled={pools.length === 0}
            onClick={() => {
              const result = fillPools(draw, phaseId, teamIdsInSeedOrder);
              if (result.placed === 0) {
                showAlert('Every team is already in a pool.', 'info');
                return;
              }
              updateDraw(() => result.draw);
            }}
          >
            Fill pools
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={draw.pools.length >= MAX_POOL_COUNT || pools.length >= 26}
            onClick={() => updateDraw((d) => addPoolToPhase(d, phaseId))}
          >
            Add pool
          </Button>
        </div>
        {pools.length === 0 ? (
          <InlineStateMessage title="No pools yet" />
        ) : (
          <PoolEntryBoard
            draw={draw}
            phaseId={phaseId}
            pools={pools}
            teams={teams}
            teamsById={teamsById}
            updateDraw={updateDraw}
            onDelete={(pool) => void deletePool(pool)}
            onCustom={(poolId, entryId) => setCustomTarget({ kind: 'entry', poolId, entryId })}
          />
        )}
      </FormSection>

      <PoolGamesSection
        draw={draw}
        phaseId={phaseId}
        pools={pools}
        games={games}
        teams={teams}
        teamsById={teamsById}
        updateDraw={updateDraw}
        onCustom={(gameId, slotIndex) => setCustomTarget({ kind: 'game', gameId, slotIndex })}
        onDeleteGame={async (game) => {
          if (game.result || game.standing) {
            const ok = await confirm({
              title: `Delete ${game.label}?`,
              message: 'Its recorded result is deleted too.',
              confirmText: 'Delete game',
              variant: 'danger',
            });
            if (!ok) return;
          }
          updateDraw((d) => removeGame(d, game.id));
        }}
        onRoundRobin={() => {
          const result = addRoundRobinGames(draw, phaseId);
          if (result.added === 0) {
            showAlert('Every pairing already has a game.', 'info');
            return;
          }
          updateDraw(() => result.draw);
        }}
      />

      <TournamentPoolPhaseSettings draw={draw} phaseId={phaseId} updateDraw={updateDraw} />

      <CustomStandingDialog
        isOpen={customTarget != null}
        draw={draw}
        contextPhaseId={phaseId}
        allowSamePhase={customTarget?.kind === 'game'}
        initial={customInitial}
        onCancel={() => setCustomTarget(null)}
        onConfirm={applyCustom}
      />
    </div>
  );
}

function setGameSlot(
  d: TournamentDrawState,
  gameId: string,
  slotIndex: number,
  source: TournamentSlotSource,
): TournamentDrawState {
  const g = d.games[gameId];
  if (!g) return d;
  const slots = [...g.slots];
  slots[slotIndex] = source;
  return { ...d, games: { ...d.games, [gameId]: { ...g, slots } } };
}

function patchGame(d: TournamentDrawState, gameId: string, patch: Partial<TournamentGameNode>): TournamentDrawState {
  const g = d.games[gameId];
  if (!g) return d;
  return { ...d, games: { ...d.games, [gameId]: { ...g, ...patch } } };
}

type PoolEntryBoardProps = {
  draw: TournamentDrawState;
  phaseId: string;
  pools: TournamentPool[];
  teams: TournamentTeamApi[];
  teamsById: Map<number, TournamentTeamApi>;
  updateDraw: UpdateDraw;
  onDelete: (pool: TournamentPool) => void;
  onCustom: (poolId: string, entryId: string) => void;
};

function PoolEntryBoard({
  draw,
  phaseId,
  pools,
  teams,
  teamsById,
  updateDraw,
  onDelete,
  onCustom,
}: PoolEntryBoardProps) {
  const getEntryId = useCallback((entry: TournamentPoolEntry) => entry.id, []);
  const getEntryLabel = useCallback(
    (entry: TournamentPoolEntry) => formatSlotSourceLabel(entry.source, teamsById, draw),
    [draw, teamsById],
  );
  const getPoolLabel = useCallback(
    (poolId: string | number) => pools.find((pool) => pool.id === String(poolId))?.name ?? 'Pool',
    [pools],
  );

  return (
    <SortableGroups
      className="grid gap-4 md:grid-cols-2 xl:grid-cols-3"
      groups={pools.map((pool) => ({ id: pool.id, items: pool.entries }))}
      getId={getEntryId}
      getItemLabel={getEntryLabel}
      getGroupLabel={getPoolLabel}
      itemNoun="team"
      onReorder={(groups) => {
        const entryIdsByPoolId: Record<string, string[]> = {};
        for (const group of groups) entryIdsByPoolId[String(group.id)] = group.items.map((entry) => entry.id);
        updateDraw((current) => arrangePoolEntries(current, phaseId, entryIdsByPoolId));
      }}
      renderGroup={({ groupId, items, isDropTarget, setDropRef, children }) => {
        const pool = pools.find((candidate) => candidate.id === groupId);
        if (!pool) return null;
        return (
          <PoolCard
            pool={{ ...pool, entries: items }}
            updateDraw={updateDraw}
            isDropTarget={isDropTarget}
            setDropRef={setDropRef}
            onDelete={() => onDelete(pool)}
          >
            {children}
          </PoolCard>
        );
      }}
      renderItem={({ item, groupId, index, isDragging, isOverlay, dragHandle }) => {
        const pool = pools.find((candidate) => candidate.id === groupId);
        if (!pool) return null;
        return (
          <PoolEntryRow
            draw={draw}
            pool={pool}
            entry={item}
            code={poolEntryCode(pool, index)}
            phaseId={phaseId}
            teams={teams}
            teamsById={teamsById}
            updateDraw={updateDraw}
            dragHandle={dragHandle}
            isDragging={isDragging}
            isOverlay={isOverlay}
            onCustom={(entryId) => onCustom(pool.id, entryId)}
          />
        );
      }}
    />
  );
}

type PoolCardProps = {
  pool: TournamentPool;
  updateDraw: UpdateDraw;
  isDropTarget: boolean;
  setDropRef: (element: HTMLElement | null) => void;
  onDelete: () => void;
  children: ReactNode;
};

function PoolCard({
  pool,
  updateDraw,
  isDropTarget,
  setDropRef,
  onDelete,
  children,
}: PoolCardProps) {
  const nameId = useId();
  return (
    <div
      ref={setDropRef}
      className={`space-y-3 rounded-lg border border-gray-200 border-t-4 bg-white p-3 dark:border-gray-600 dark:bg-gray-800 ${
        isDropTarget ? 'ring-2 ring-primary-teal/40' : ''
      }`}
      style={{ borderTopColor: pool.color }}
    >
      <div className="flex items-end gap-2">
        <FormField label="Pool name" htmlFor={nameId} className="min-w-0 flex-1">
          <input
            id={nameId}
            className="app-input w-full"
            value={pool.name}
            maxLength={120}
            onChange={(e) => {
              const name = e.target.value;
              updateDraw((d) => ({
                ...d,
                pools: d.pools.map((p) => (p.id === pool.id ? { ...p, name } : p)),
              }));
            }}
          />
        </FormField>
        <Button
          type="button"
          variant="outline-danger"
          className="mb-0.5 h-10 w-10 shrink-0 !p-0"
          aria-label={`Delete ${pool.name}`}
          title="Delete pool"
          onClick={onDelete}
        >
          <HiTrash className="h-5 w-5" aria-hidden />
        </Button>
      </div>
      {pool.entries.length === 0 ? (
        <p className="text-sm text-gray-600 dark:text-gray-400">No teams yet.</p>
      ) : (
        <div role="list" aria-label={`${pool.name} teams`} className="space-y-2">
          {children}
        </div>
      )}
      <button
        type="button"
        className="text-sm font-medium text-primary-teal-link hover:underline"
        onClick={() => updateDraw((d) => addPoolEntry(d, pool.id))}
      >
        Add team
      </button>
    </div>
  );
}

function PoolEntryRow({
  draw,
  pool,
  entry,
  code,
  phaseId,
  teams,
  teamsById,
  updateDraw,
  dragHandle,
  isDragging,
  isOverlay,
  onCustom,
}: {
  draw: TournamentDrawState;
  pool: TournamentPool;
  entry: TournamentPoolEntry;
  code: string;
  phaseId: string;
  teams: TournamentTeamApi[];
  teamsById: Map<number, TournamentTeamApi>;
  updateDraw: UpdateDraw;
  dragHandle: ReactNode;
  isDragging: boolean;
  isOverlay: boolean;
  onCustom: (entryId: string) => void;
}) {
  const inputId = useId();
  if (isOverlay) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-gray-200 bg-white px-2 py-1.5 shadow-lg dark:border-gray-600 dark:bg-gray-800">
        {dragHandle}
        <span className="w-9 shrink-0 font-mono text-sm font-semibold text-gray-700 dark:text-gray-300">{code}</span>
        <span className="min-w-0 truncate text-sm text-gray-900 dark:text-gray-100">
          {formatSlotSourceLabel(entry.source, teamsById, draw)}
        </span>
      </div>
    );
  }
  return (
    <div className={`flex items-center gap-2 ${isDragging ? 'opacity-0' : ''}`}>
      {dragHandle}
      <label htmlFor={inputId} className="w-9 shrink-0 font-mono text-sm font-semibold text-gray-700 dark:text-gray-300">
        {code}
      </label>
      <div className="min-w-0 flex-1">
        <ChoiceInput<string>
          inputId={inputId}
          listboxLabel={`${pool.name} ${code}`}
          options={buildSlotSourceOptions(
            draw,
            teams,
            teamsById,
            { kind: 'pool_entry', phaseId, entryId: entry.id },
            entry.source,
          )}
          value={encodeSlotSource(entry.source)}
          onChange={(v) => {
            if (typeof v !== 'string') return;
            if (v === CUSTOM_STANDING_OPTION_VALUE) {
              onCustom(entry.id);
              return;
            }
            updateDraw((d) => setPoolEntrySource(d, pool.id, entry.id, decodeSlotSource(v)));
          }}
        />
      </div>
      <button
        type="button"
        className="rounded p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-teal/30 dark:hover:bg-gray-700 dark:hover:text-gray-200"
        aria-label={`Remove ${code}`}
        title="Remove"
        onClick={() => updateDraw((d) => removePoolEntry(d, pool.id, entry.id))}
      >
        <HiXMark className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}

type PoolGamesSectionProps = {
  draw: TournamentDrawState;
  phaseId: string;
  pools: TournamentPool[];
  games: TournamentGameNode[];
  teams: TournamentTeamApi[];
  teamsById: Map<number, TournamentTeamApi>;
  updateDraw: UpdateDraw;
  onCustom: (gameId: string, slotIndex: number) => void;
  onRoundRobin: () => void;
  onDeleteGame: (game: TournamentGameNode) => Promise<void>;
};

function PoolGamesSection({
  draw,
  phaseId,
  pools,
  games,
  teams,
  teamsById,
  updateDraw,
  onCustom,
  onRoundRobin,
  onDeleteGame,
}: PoolGamesSectionProps) {
  const baseId = useId();
  const [lastPoolId, setLastPoolId] = useState<string | null>(null);

  const blocks = useMemo(() => [...draw.drawBlocks].sort((a, b) => a.order - b.order), [draw.drawBlocks]);
  const groups = useMemo(() => {
    const byBlock = new Map<string, TournamentGameNode[]>();
    for (const g of games) {
      const key = g.schedule?.drawBlockId && blocks.some((b) => b.id === g.schedule!.drawBlockId)
        ? g.schedule.drawBlockId
        : NOT_SET;
      byBlock.set(key, [...(byBlock.get(key) ?? []), g]);
    }
    const ordered: { key: string; label: string; games: TournamentGameNode[] }[] = [];
    for (const b of blocks) {
      const list = byBlock.get(b.id);
      if (list) ordered.push({ key: b.id, label: formatDrawBlockOptionLabel(b), games: list });
    }
    const unscheduled = byBlock.get(NOT_SET);
    if (unscheduled) ordered.push({ key: NOT_SET, label: 'No draw set', games: unscheduled });
    return ordered;
  }, [games, blocks]);

  const poolOptions: ChoiceOption<string>[] = [
    ...pools.map((p) => ({ value: p.id, label: p.name })),
    { value: CROSS_POOL, label: 'Cross-pool' },
  ];
  const drawOptions: ChoiceOption<string>[] = [
    { value: NOT_SET, label: 'Not set' },
    ...blocks.map((b) => ({ value: b.id, label: formatDrawBlockOptionLabel(b) })),
  ];
  const sheetOptions: ChoiceOption<string>[] = [
    { value: NOT_SET, label: 'Not set' },
    ...[...draw.sheets]
      .sort((a, b) => a.order - b.order)
      .map((s) => ({ value: String(s.clubSheetId), label: s.name })),
  ];

  const addGame = () => {
    const poolId = lastPoolId && pools.some((p) => p.id === lastPoolId) ? lastPoolId : (pools[0]?.id ?? null);
    updateDraw((d) => addPoolGame(d, phaseId, poolId).draw);
  };

  return (
    <FormSection title="Games" surface="panel">
      <div className="mb-4 flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          variant="secondary"
          onClick={onRoundRobin}
          disabled={!pools.some((p) => p.entries.length >= 2)}
        >
          Add round robin
        </Button>
        <Button type="button" variant="primary" onClick={addGame}>
          Add game
        </Button>
      </div>
      {games.length === 0 ? (
        <InlineStateMessage title="No games yet" />
      ) : (
        <div className="app-table-shell">
          <table className="app-table">
            <thead className="app-table-head">
              <tr>
                <th scope="col" className="app-table-th">Game</th>
                <th scope="col" className="app-table-th">Pool</th>
                <th scope="col" className="app-table-th">Team 1</th>
                <th scope="col" className="app-table-th">Team 2</th>
                <th scope="col" className="app-table-th">Draw</th>
                <th scope="col" className="app-table-th">Sheet</th>
                <th scope="col" className="app-table-th">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white dark:divide-gray-700 dark:bg-gray-800">
              {groups.map((group) => (
                <Fragment key={group.key}>
                  {groups.length > 1 || group.key !== NOT_SET ? (
                    <tr className="bg-gray-50 dark:bg-gray-900/40">
                      <th
                        scope="colgroup"
                        colSpan={7}
                        className="px-4 py-2 text-left text-sm font-semibold text-gray-800 dark:text-gray-200"
                      >
                        {group.label}
                      </th>
                    </tr>
                  ) : null}
                  {group.games.map((game) => (
                    <tr key={game.id}>
                      <td className="app-table-td whitespace-nowrap font-medium text-gray-900 dark:text-gray-100">
                        {game.label}
                      </td>
                      <td className="app-table-td min-w-[9rem]">
                        <ChoiceInput<string>
                          ariaLabel={`${game.label} pool`}
                          options={poolOptions}
                          value={game.poolId ?? CROSS_POOL}
                          onChange={(v) => {
                            if (typeof v !== 'string') return;
                            const poolId = v === CROSS_POOL ? null : v;
                            if (poolId) setLastPoolId(poolId);
                            updateDraw((d) => patchGame(d, game.id, { poolId }));
                          }}
                        />
                      </td>
                      {[0, 1].map((slotIndex) => {
                        const slot = game.slots[slotIndex] ?? { sourceType: 'tbd' as const };
                        return (
                          <td key={slotIndex} className="app-table-td min-w-[12rem]">
                            <ChoiceInput<string>
                              inputId={`${baseId}-${game.id}-${slotIndex}`}
                              ariaLabel={`${game.label} team ${slotIndex + 1}`}
                              options={buildSlotSourceOptions(
                                draw,
                                teams,
                                teamsById,
                                { kind: 'pool_game', phaseId, poolId: game.poolId ?? null, gameId: game.id },
                                slot,
                              )}
                              value={encodeSlotSource(slot)}
                              onChange={(v) => {
                                if (typeof v !== 'string') return;
                                if (v === CUSTOM_STANDING_OPTION_VALUE) {
                                  onCustom(game.id, slotIndex);
                                  return;
                                }
                                updateDraw((d) => setGameSlot(d, game.id, slotIndex, decodeSlotSource(v)));
                              }}
                            />
                          </td>
                        );
                      })}
                      <td className="app-table-td min-w-[10rem]">
                        <ChoiceInput<string>
                          ariaLabel={`${game.label} draw`}
                          options={drawOptions}
                          value={game.schedule?.drawBlockId ?? NOT_SET}
                          onChange={(v) => {
                            if (typeof v !== 'string') return;
                            const block = blocks.find((b) => b.id === v);
                            updateDraw((d) =>
                              patchGame(d, game.id, {
                                schedule: {
                                  ...d.games[game.id]?.schedule,
                                  drawBlockId: block?.id ?? null,
                                  startTime: block?.startTime ?? null,
                                },
                              }),
                            );
                          }}
                        />
                      </td>
                      <td className="app-table-td min-w-[8rem]">
                        <ChoiceInput<string>
                          ariaLabel={`${game.label} sheet`}
                          options={sheetOptions}
                          value={game.schedule?.sheetId != null ? String(game.schedule.sheetId) : NOT_SET}
                          onChange={(v) => {
                            if (typeof v !== 'string') return;
                            const sheet = draw.sheets.find((s) => String(s.clubSheetId) === v);
                            updateDraw((d) =>
                              patchGame(d, game.id, {
                                schedule: {
                                  ...d.games[game.id]?.schedule,
                                  sheetId: sheet?.clubSheetId ?? null,
                                  sheetLabel: sheet?.name ?? null,
                                },
                              }),
                            );
                          }}
                        />
                      </td>
                      <td className="app-table-td text-right">
                        <Button
                          type="button"
                          variant="outline-danger"
                          className="h-9 w-9 shrink-0 !p-0"
                          aria-label={`Delete ${game.label}`}
                          title="Delete game"
                          onClick={() => void onDeleteGame(game)}
                        >
                          <HiTrash className="h-4 w-4" aria-hidden />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </FormSection>
  );
}
