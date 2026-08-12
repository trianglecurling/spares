// ─── Input types ────────────────────────────────────────────────────────────

export interface ScheduleDivision {
  id: number;
  name: string;
}

export interface ScheduleTeam {
  id: number;
  divisionId: number;
  name: string | null;
}

export interface ScheduleDrawSlot {
  date: string;
  time: string;
  sheets: ScheduleSheet[];
}

export interface ScheduleSheet {
  id: number;
  name: string;
  isAvailable: boolean;
}

export interface ScheduleByeRequest {
  teamId: number;
  drawDate: string;
  /** Lower number = higher preference (1 = most preferred). */
  priority: number;
}

/** Hard constraint: team must not play on this date (any draw that day). */
export interface ScheduleHardConstraintBye {
  type: 'bye';
  teamId: number;
  drawDate: string;
}

/**
 * Hard constraint: pin a specific matchup to a draw (and optional sheet).
 * Only applied when that pairing already exists in generated matchups.
 */
export interface ScheduleHardConstraintMatchup {
  type: 'matchup';
  team1Id: number;
  team2Id: number;
  drawDate: string;
  drawTime: string;
  sheetId: number | null;
}

export type ScheduleHardConstraint = ScheduleHardConstraintBye | ScheduleHardConstraintMatchup;

/** How teams are paired within a schedule round. */
export type SchedulePairingMode = 'intra' | 'cross' | 'any';

export interface ScheduleStrategy {
  localId: string;
  priority: number;
  pairingMode: SchedulePairingMode;
  /** Required when pairingMode is `intra`; ignored otherwise. */
  divisionId: number | null;
  gamesPerTeam: number;
  /** Draw slot keys ("date|time") this strategy may use. */
  drawSlotKeys: string[];
}

export interface ScheduleInput {
  strategies: ScheduleStrategy[];
  teams: ScheduleTeam[];
  divisions: ScheduleDivision[];
  drawSlots: ScheduleDrawSlot[];
  byeRequests: ScheduleByeRequest[];
  /** Admin-imposed hard constraints for this generation run. */
  hardConstraints?: ScheduleHardConstraint[];
  /** Team IDs that prefer the later draw time when a date has multiple draws. */
  preferLateDrawTeamIds?: number[];
  /** Team IDs that prefer the earlier draw time when a date has multiple draws. */
  preferEarlyDrawTeamIds?: number[];
  /** Seed for the PRNG used to break ties during assignment. Different seeds produce different schedules. */
  seed: number;
  /** Time budget for the SA optimization phase in ms. Defaults to 30 000. */
  optimizationTimeBudgetMs?: number;
  /**
   * Stop SA early when the best penalty has not improved for this many ms.
   * Defaults to max(2000, 15% of the time budget).
   */
  optimizationEarlyStopPatienceMs?: number;
}

// ─── Algorithm output types ─────────────────────────────────────────────────

/** A pairing of two teams produced during matchup generation. */
export interface Matchup {
  team1Id: number;
  team2Id: number;
  /** Which strategy generated this matchup. */
  strategyLocalId: string;
  /** Stable identity for the generated matchup round, used by structural optimization moves. */
  roundLocalId?: string;
}

/** A game produced by the scheduler, ready to be committed. */
export interface GeneratedGame {
  team1Id: number;
  team2Id: number;
  gameDate: string;
  gameTime: string;
  sheetId: number;
  /** Which strategy produced this matchup; used to enforce draw-slot restrictions. */
  strategyLocalId: string;
  /** Stable identity for the generated matchup round, used by structural optimization moves. */
  roundLocalId?: string;
}

/** A matchup that could not be assigned to any available slot. */
export interface UnschedulableMatchup {
  team1Id: number;
  team2Id: number;
  strategyLocalId: string;
  roundLocalId?: string;
  reason: string;
}

/** Per-team balance statistics. */
export interface TeamStats {
  teamId: number;
  /** How many games as Team 1 vs Team 2. */
  asTeam1: number;
  asTeam2: number;
  /** Map from draw time ("HH:MM") to number of games at that time. */
  drawTimeCounts: Record<string, number>;
  /** Map from sheet id to number of games on that sheet. */
  sheetCounts: Record<number, number>;
  /** Number of bye-request conflicts (listed by priority). */
  byeConflicts: Array<{ drawDate: string; priority: number }>;
}

/** A warning about the generated schedule. */
export interface ScheduleWarning {
  severity: 'info' | 'warning' | 'error';
  message: string;
}

export interface ScheduleResult {
  games: GeneratedGame[];
  unschedulable: UnschedulableMatchup[];
  teamStats: TeamStats[];
  warnings: ScheduleWarning[];
  /** Total penalty score from the scoring function (lower is better). */
  totalScore: number;
}

// ─── Worker communication types ─────────────────────────────────────────────

export interface ProgressUpdate {
  phase: string;
  percent: number;
  message: string;
}

export type WorkerInMessage = {
  type: 'generate';
  payload: ScheduleInput;
};

export type WorkerOutMessage =
  | { type: 'progress'; payload: ProgressUpdate }
  | { type: 'complete'; payload: ScheduleResult }
  | { type: 'error'; message: string };
