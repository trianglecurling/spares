import { splitDisplayName } from './personName';
import { formatTeamDisplayName } from './tournamentDisplay';
import type { TournamentDrawState, TournamentGameNode } from './tournamentDrawModel';
import {
  PRINT_BRACKET_LAYOUT_METRICS,
  placeRoutingLinesOnCard,
} from './tournamentDrawBracketLayout';

export type PrintCompetitorTeamRef = {
  teamName: string | null;
  sortOrder: number;
  roster?: Array<{ slotCode: string; playerName: string | null }>;
};

const PLACEHOLDER_LABELS = new Set(['TBD', '…', '—', 'Team…', '...']);

function rosterName(team: PrintCompetitorTeamRef, slotCode: string): string | null {
  const raw = team.roster?.find((row) => row.slotCode === slotCode)?.playerName?.trim();
  return raw || null;
}

/** Last name of the fourth; doubles fall back to player 2, then player 1. */
export function fourthPositionLastName(team: PrintCompetitorTeamRef): string | null {
  const raw =
    rosterName(team, 'fourth') ?? rosterName(team, 'player2') ?? rosterName(team, 'player1');
  if (!raw) return null;
  const { firstName, lastName } = splitDisplayName(raw);
  return lastName || firstName || null;
}

export function printCompetitorDisplayText(
  text: string,
  teamsById: Map<number, PrintCompetitorTeamRef>,
  registrationId?: number | null
): string {
  if (registrationId != null) {
    const team = teamsById.get(registrationId);
    if (team) {
      return fourthPositionLastName(team) ?? formatTeamDisplayName(team.teamName, team.sortOrder);
    }
  }
  const t = text.trim();
  for (const team of teamsById.values()) {
    if (formatTeamDisplayName(team.teamName, team.sortOrder) === t) {
      return fourthPositionLastName(team) ?? t;
    }
  }
  return t;
}

/** Short glyph for a circled sheet mark (`Sheet A` → `A`). */
export function sheetBadgeGlyph(sheetName: string): string {
  const stripped = sheetName
    .trim()
    .replace(/^sheet\s+/i, '')
    .trim();
  if (!stripped) return '?';
  const token = stripped.split(/\s+/)[0] ?? stripped;
  return token.length <= 2 ? token : token.slice(0, 1);
}

export function printLoserRouteFromLines(
  lines: Array<{ key: string; text: string }>
): string | null {
  const loser = lines.find(
    (line) => line.text.startsWith('L-') || line.key.startsWith('g-2-') || line.key === 'out-2'
  );
  return loser?.text ?? null;
}

export function printLoserRouteLabel(
  draw: TournamentDrawState,
  g: TournamentGameNode
): string | null {
  return printLoserRouteFromLines(placeRoutingLinesOnCard(draw, g));
}

/** Multi-entry games (3+ sides) cannot infer place routes from winner lines. */
export function printCardShowsFullRouting(slotCount: number): boolean {
  return slotCount >= 3;
}

export const PRINT_FULL_ROUTING_LINE_H = 11;
export const PRINT_FULL_ROUTING_PAD = 2;

export function printGameCardHeight(draw: TournamentDrawState, g: TournamentGameNode): number {
  const base = PRINT_BRACKET_LAYOUT_METRICS.cardH;
  if (!printCardShowsFullRouting(g.slots.length)) return base;
  const routeCount = placeRoutingLinesOnCard(draw, g).length;
  if (routeCount === 0) return base;
  return base + PRINT_FULL_ROUTING_PAD + routeCount * PRINT_FULL_ROUTING_LINE_H;
}

/**
 * True when a competitor label is a real side (named team, bye) rather than a
 * feeder pipe such as W-B6 or 3rd C1.
 */
export function competitorLabelIsActualParticipant(
  text: string,
  teamsById: Map<number, PrintCompetitorTeamRef>
): boolean {
  const t = text.trim();
  if (!t) return false;
  for (const team of teamsById.values()) {
    if (formatTeamDisplayName(team.teamName, team.sortOrder) === t) return true;
    if (fourthPositionLastName(team) === t) return true;
  }
  if (t === 'Bye') return true;
  if (PLACEHOLDER_LABELS.has(t)) return false;
  if (/^Team #\d+$/.test(t)) return true;
  if (/^[WL]-/.test(t)) return false;
  if (/^\d+(st|nd|rd|th)\s/i.test(t)) return false;
  return true;
}

export function printCardShowsParticipants(
  segments: Array<{ text: string }>,
  teamsById: Map<number, PrintCompetitorTeamRef>
): boolean {
  return segments.some((seg) => competitorLabelIsActualParticipant(seg.text, teamsById));
}
