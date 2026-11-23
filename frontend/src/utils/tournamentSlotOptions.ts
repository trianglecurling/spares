import type { ChoiceOption } from '../components/ChoiceInput';
import type { TournamentTeamApi } from '../types/tournamentTeam';
import { formatTeamDisplayName } from './tournamentDisplay';
import {
  encodeSlotSource,
  ordinalPlaceLabel,
  type TournamentDrawState,
  type TournamentSlotSource,
} from './tournamentDrawModel';
import { earlierPhases, isPoolPhaseGame, poolEntryCode, poolsForPhase } from './tournamentDrawPhases';
import { formatSlotSourceLabel, resolvePoolSourceLabel } from './tournamentDrawRouting';

export const CUSTOM_STANDING_OPTION_VALUE = '__custom_standing';

export type SlotOptionsContext =
  /** A bracket game competitor. */
  | { kind: 'bracket_game'; phaseId: string; gameId: string | null }
  /** A pool entry (who is "A2"). */
  | { kind: 'pool_entry'; phaseId: string; entryId: string }
  /** A pool game side. */
  | { kind: 'pool_game'; phaseId: string; poolId: string | null; gameId: string | null };

type TeamsById = Map<number, { teamName: string | null; sortOrder: number }>;

function divider(label: string, key: string): ChoiceOption<string> {
  return { type: 'divider', key, label };
}

function gameResultOptions(draw: TournamentDrawState, gameIds: string[]): ChoiceOption<string>[] {
  const opts: ChoiceOption<string>[] = [];
  for (const id of gameIds) {
    const g = draw.games[id];
    if (!g) continue;
    const k = g.slots.length;
    for (let p = 1; p <= k; p++) {
      const label =
        k <= 2 ? (p === 1 ? `Winner of ${g.label}` : `Loser of ${g.label}`) : `${ordinalPlaceLabel(p)} of ${g.label}`;
      opts.push({ value: encodeSlotSource({ sourceType: 'game_place', gameId: g.id, place: p }), label });
    }
  }
  return opts;
}

function sortedGameIds(draw: TournamentDrawState, filter: (id: string) => boolean): string[] {
  return Object.values(draw.games)
    .filter((g) => filter(g.id))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }))
    .map((g) => g.id);
}

/** End-of-phase pool finishes from pool phases before `phaseId`. */
function earlierPoolPhaseOptions(draw: TournamentDrawState, phaseId: string): ChoiceOption<string>[] {
  const opts: ChoiceOption<string>[] = [];
  const poolPhases = earlierPhases(draw, phaseId).filter((p) => p.kind === 'pool');
  const multiple = poolPhases.length > 1;
  for (const phase of poolPhases) {
    const prefix = multiple ? `${phase.name}: ` : '';
    const pools = poolsForPhase(draw, phase.id);
    if (pools.length > 0) {
      opts.push(divider(`${prefix}Pool finishes`, `fin-${phase.id}`));
      for (const pool of pools) {
        for (let rank = 1; rank <= Math.max(1, pool.entries.length); rank++) {
          opts.push({
            value: encodeSlotSource({ sourceType: 'standing', phaseId: phase.id, poolId: pool.id, rank }),
            label: `${prefix}Pool ${pool.code} ${ordinalPlaceLabel(rank)}`,
          });
        }
      }
    }
  }
  return opts;
}

/** Grouped competitor choices for a game slot or pool entry, plus "Custom standing…". */
export function buildSlotSourceOptions(
  draw: TournamentDrawState,
  teams: TournamentTeamApi[],
  teamsById: TeamsById,
  ctx: SlotOptionsContext,
  current?: TournamentSlotSource,
): ChoiceOption<string>[] {
  const opts: ChoiceOption<string>[] = [{ value: encodeSlotSource({ sourceType: 'tbd' }), label: 'TBD' }];
  if (ctx.kind === 'bracket_game') opts.push({ value: encodeSlotSource({ sourceType: 'bye' }), label: 'Bye' });
  const earlierIds = new Set(earlierPhases(draw, ctx.phaseId).map((p) => p.id));

  if (ctx.kind === 'pool_game') {
    const pools = poolsForPhase(draw, ctx.phaseId);
    const ordered = [...pools.filter((p) => p.id === ctx.poolId), ...pools.filter((p) => p.id !== ctx.poolId)];
    for (const pool of ordered) {
      if (pool.entries.length === 0) continue;
      opts.push(divider(pool.name, `pool-${pool.id}`));
      pool.entries.forEach((entry, i) => {
        const source: TournamentSlotSource = { sourceType: 'pool_entry', entryId: entry.id };
        const who = resolvePoolSourceLabel(draw, source, teamsById);
        const code = poolEntryCode(pool, i);
        opts.push({ value: encodeSlotSource(source), label: who === code ? code : `${code} · ${who}` });
      });
    }
    const results = gameResultOptions(
      draw,
      sortedGameIds(draw, (id) => id !== ctx.gameId && draw.games[id]!.phaseId === ctx.phaseId),
    );
    if (results.length > 0) opts.push(divider('Game results', 'results'), ...results);
  } else {
    const placedInPhase = new Set<number>();
    if (ctx.kind === 'pool_entry') {
      for (const pool of poolsForPhase(draw, ctx.phaseId)) {
        for (const e of pool.entries) {
          if (e.id !== ctx.entryId && e.source.sourceType === 'registration' && e.source.registrationId != null) {
            placedInPhase.add(e.source.registrationId);
          }
        }
      }
    }
    const sortedTeams = [...teams].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
    const teamRows = [
      ...sortedTeams.filter((t) => !placedInPhase.has(t.id)),
      ...sortedTeams.filter((t) => placedInPhase.has(t.id)),
    ];
    if (teamRows.length > 0) {
      opts.push(divider('Teams', 'teams'));
      for (const t of teamRows) {
        opts.push({
          value: encodeSlotSource({ sourceType: 'registration', registrationId: t.id }),
          label: formatTeamDisplayName(t.teamName, t.sortOrder),
          description: placedInPhase.has(t.id) ? 'Already in a pool' : undefined,
        });
      }
    }
    opts.push(...earlierPoolPhaseOptions(draw, ctx.phaseId));
    const bracketGameIds = sortedGameIds(draw, (id) => {
      const g = draw.games[id]!;
      if (isPoolPhaseGame(draw, g)) return false;
      if (ctx.kind === 'bracket_game') return id !== ctx.gameId && (g.phaseId === ctx.phaseId || earlierIds.has(g.phaseId));
      return earlierIds.has(g.phaseId);
    });
    const results = gameResultOptions(draw, bracketGameIds);
    if (results.length > 0) opts.push(divider('Game results', 'results'), ...results);
  }

  const canUseStandings =
    ctx.kind === 'pool_game' || earlierPhases(draw, ctx.phaseId).some((p) => p.kind === 'pool');
  if (canUseStandings) {
    opts.push({ type: 'divider', key: 'custom' });
    opts.push({ value: CUSTOM_STANDING_OPTION_VALUE, label: 'Custom standing…' });
  }

  if (current) {
    const encoded = encodeSlotSource(current);
    const present = opts.some((o) => o.type !== 'divider' && o.value === encoded);
    if (!present && current.sourceType !== 'tbd') {
      opts.splice(1, 0, { value: encoded, label: formatSlotSourceLabel(current, teamsById, draw) });
    }
  }
  return opts;
}
