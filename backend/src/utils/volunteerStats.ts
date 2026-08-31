import { normalizePersonName } from './memberName.js';
import { addCalendarDays } from './timeZone.js';

/** First month volunteering hours are tracked in this system. */
export const VOLUNTEER_STATS_TRACKING_START = '2026-08-01';

/** Days before a season start that still count as that season (prep work). */
export const VOLUNTEER_STATS_SEASON_LOOKBACK_DAYS = 30;

export type VolunteerStatsPeriodTotals = {
  hours: number;
  shifts: number;
};

export type VolunteerStatsCompletedSignup = {
  signupId: number;
  memberId: number | null;
  memberName: string | null;
  shiftId: number;
  startDt: string;
  endDt: string;
  startDateOnly: string;
  programTitle?: string | null;
  roleName?: string | null;
};

export type VolunteerStatsHourLog = {
  id?: number;
  memberId: number;
  memberName: string | null;
  volunteerDate: string;
  hours: number;
  description?: string | null;
};

export type VolunteerSeasonActivity = {
  id: string;
  kind: 'shift' | 'self_report';
  date: string;
  hours: number;
  summary: string;
  detail: string | null;
};

export type VolunteerSeasonLedger = {
  memberId: number;
  memberName: string;
  season: { id: number; name: string; startDate: string; endDate: string };
  totalHours: number;
  activities: VolunteerSeasonActivity[];
};

export const VOLUNTEER_SEASON_LEDGER_UNAVAILABLE =
  'Volunteer activity is only available for the current season top 10.';

export type VolunteerStatsLeaderboardEntry = {
  rank: number;
  memberId: number;
  name: string;
  hours: number;
  isViewer: boolean;
};

export type VolunteerStatsResult = {
  season: {
    id: number;
    name: string;
    startDate: string;
    endDate: string;
  } | null;
  club: {
    hours: { month: number; season: number; lifetime: number };
    shifts: { month: number; season: number; lifetime: number };
    uniqueVolunteersSeason: number;
    membershipCountSeason: number;
    uniqueVolunteerPercentSeason: number | null;
    hoursPerMemberSeason: number | null;
  };
  me: {
    hours: { month: number; season: number; lifetime: number };
    shifts: { month: number; season: number; lifetime: number };
    seasonRank: number | null;
  };
  leaderboard: VolunteerStatsLeaderboardEntry[];
};

export function volunteerShiftDurationHours(startDt: string, endDt: string): number {
  const ms = new Date(endDt).getTime() - new Date(startDt).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return ms / (1000 * 60 * 60);
}

export function roundVolunteerHours(hours: number): number {
  return Math.round(hours * 10) / 10;
}

function personShiftKey(row: VolunteerStatsCompletedSignup): string {
  if (row.memberId != null) return `m:${row.memberId}:${row.shiftId}`;
  return `g:${row.signupId}`;
}

function inMonth(startDateOnly: string, monthPrefix: string): boolean {
  return startDateOnly.startsWith(monthPrefix);
}

export function inVolunteerStatsSeason(
  startDateOnly: string,
  seasonCountStart: string | null,
  seasonEnd: string | null
): boolean {
  if (!seasonCountStart || !seasonEnd) return false;
  return startDateOnly >= seasonCountStart && startDateOnly <= seasonEnd;
}

function inSeason(
  startDateOnly: string,
  seasonCountStart: string | null,
  seasonEnd: string | null
): boolean {
  return inVolunteerStatsSeason(startDateOnly, seasonCountStart, seasonEnd);
}

function sinceTrackingStart(startDateOnly: string): boolean {
  return startDateOnly >= VOLUNTEER_STATS_TRACKING_START;
}

/**
 * Prep work in the month before a season start still counts for that season.
 * A 30-day lookback from 1 Sep lands in August; we include the whole month.
 */
export function volunteerStatsSeasonCountStart(seasonStartDate: string): string {
  const lookback = addCalendarDays(seasonStartDate, -VOLUNTEER_STATS_SEASON_LOOKBACK_DAYS);
  return `${lookback.slice(0, 7)}-01`;
}

function emptyPeriods(): { month: number; season: number; lifetime: number } {
  return { month: 0, season: 0, lifetime: 0 };
}

function addPeriod(
  totals: { month: number; season: number; lifetime: number },
  amount: number,
  month: boolean,
  season: boolean
): void {
  totals.lifetime += amount;
  if (month) totals.month += amount;
  if (season) totals.season += amount;
}

/**
 * Aggregate completed volunteer signups. Future shifts (start after now) are omitted.
 * Hours are counted once per person per shift when the same member signed up for
 * multiple roles on one shift.
 */
export function aggregateVolunteerStats(
  rows: VolunteerStatsCompletedSignup[],
  options: {
    viewerMemberId: number;
    nowIso: string;
    monthPrefix: string;
    todayDateOnly?: string;
    season: { id: number; name: string; startDate: string; endDate: string } | null;
    membershipCount: number;
    hourLogs?: VolunteerStatsHourLog[];
  }
): VolunteerStatsResult {
  const seasonCountStart = options.season
    ? volunteerStatsSeasonCountStart(options.season.startDate)
    : null;
  const seasonEnd = options.season?.endDate ?? null;
  const todayDateOnly = options.todayDateOnly ?? options.nowIso.slice(0, 10);

  const completed = rows.filter(
    (row) => row.startDt <= options.nowIso && sinceTrackingStart(row.startDateOnly)
  );

  const clubHours = emptyPeriods();
  const clubShifts = {
    month: new Set<number>(),
    season: new Set<number>(),
    lifetime: new Set<number>(),
  };
  const meHours = emptyPeriods();
  const meShifts = {
    month: new Set<number>(),
    season: new Set<number>(),
    lifetime: new Set<number>(),
  };
  const uniqueVolunteersSeason = new Set<number>();
  const seasonHoursByMember = new Map<number, { name: string; hours: number }>();
  const countedPersonShifts = new Set<string>();

  for (const row of completed) {
    const month = inMonth(row.startDateOnly, options.monthPrefix);
    const season = inSeason(row.startDateOnly, seasonCountStart, seasonEnd);
    const key = personShiftKey(row);
    if (!countedPersonShifts.has(key)) {
      countedPersonShifts.add(key);
      const hours = volunteerShiftDurationHours(row.startDt, row.endDt);
      addPeriod(clubHours, hours, month, season);
      if (row.memberId === options.viewerMemberId) {
        addPeriod(meHours, hours, month, season);
      }
      if (season && row.memberId != null) {
        const existing = seasonHoursByMember.get(row.memberId);
        const name = normalizePersonName(row.memberName) || 'Volunteer';
        if (existing) existing.hours += hours;
        else seasonHoursByMember.set(row.memberId, { name, hours });
      }
    }

    clubShifts.lifetime.add(row.shiftId);
    if (month) clubShifts.month.add(row.shiftId);
    if (season) clubShifts.season.add(row.shiftId);

    if (row.memberId === options.viewerMemberId) {
      meShifts.lifetime.add(row.shiftId);
      if (month) meShifts.month.add(row.shiftId);
      if (season) meShifts.season.add(row.shiftId);
    }

    if (season && row.memberId != null) {
      uniqueVolunteersSeason.add(row.memberId);
    }
  }

  for (const log of options.hourLogs ?? []) {
    const hours = Number(log.hours);
    if (!Number.isFinite(hours) || hours <= 0) continue;
    if (log.volunteerDate > todayDateOnly) continue;
    if (!sinceTrackingStart(log.volunteerDate)) continue;
    const month = inMonth(log.volunteerDate, options.monthPrefix);
    const season = inSeason(log.volunteerDate, seasonCountStart, seasonEnd);
    addPeriod(clubHours, hours, month, season);
    if (log.memberId === options.viewerMemberId) {
      addPeriod(meHours, hours, month, season);
    }
    if (season) {
      uniqueVolunteersSeason.add(log.memberId);
      const existing = seasonHoursByMember.get(log.memberId);
      const name = normalizePersonName(log.memberName) || 'Volunteer';
      if (existing) existing.hours += hours;
      else seasonHoursByMember.set(log.memberId, { name, hours });
    }
  }

  const ranked = [...seasonHoursByMember.entries()]
    .map(([memberId, value]) => ({ memberId, ...value }))
    .sort((a, b) => {
      if (b.hours !== a.hours) return b.hours - a.hours;
      const nameCmp = a.name.localeCompare(b.name, 'en');
      if (nameCmp !== 0) return nameCmp;
      return a.memberId - b.memberId;
    });

  const viewerIndex = ranked.findIndex((entry) => entry.memberId === options.viewerMemberId);
  const leaderboard: VolunteerStatsLeaderboardEntry[] = ranked.slice(0, 10).map((entry, index) => ({
    rank: index + 1,
    memberId: entry.memberId,
    name: entry.name,
    hours: roundVolunteerHours(entry.hours),
    isViewer: entry.memberId === options.viewerMemberId,
  }));

  const membershipCount = Math.max(0, options.membershipCount);
  const uniqueCount = uniqueVolunteersSeason.size;
  const seasonClubHours = clubHours.season;

  return {
    season: options.season,
    club: {
      hours: {
        month: roundVolunteerHours(clubHours.month),
        season: roundVolunteerHours(clubHours.season),
        lifetime: roundVolunteerHours(clubHours.lifetime),
      },
      shifts: {
        month: clubShifts.month.size,
        season: clubShifts.season.size,
        lifetime: clubShifts.lifetime.size,
      },
      uniqueVolunteersSeason: uniqueCount,
      membershipCountSeason: membershipCount,
      uniqueVolunteerPercentSeason:
        membershipCount > 0 ? Math.round((uniqueCount / membershipCount) * 1000) / 10 : null,
      hoursPerMemberSeason:
        membershipCount > 0 ? roundVolunteerHours(seasonClubHours / membershipCount) : null,
    },
    me: {
      hours: {
        month: roundVolunteerHours(meHours.month),
        season: roundVolunteerHours(meHours.season),
        lifetime: roundVolunteerHours(meHours.lifetime),
      },
      shifts: {
        month: meShifts.month.size,
        season: meShifts.season.size,
        lifetime: meShifts.lifetime.size,
      },
      seasonRank: viewerIndex >= 0 ? viewerIndex + 1 : null,
    },
    leaderboard,
  };
}

export function buildSeasonVolunteerLedger(
  memberId: number,
  options: {
    nowIso: string;
    todayDateOnly: string;
    season: { id: number; name: string; startDate: string; endDate: string };
    signups: VolunteerStatsCompletedSignup[];
    hourLogs: VolunteerStatsHourLog[];
  }
): VolunteerSeasonLedger {
  const seasonCountStart = volunteerStatsSeasonCountStart(options.season.startDate);
  const seasonEnd = options.season.endDate;
  const shifts = new Map<number, VolunteerSeasonActivity & { roles: string[] }>();
  const activities: VolunteerSeasonActivity[] = [];
  let memberName = 'Volunteer';

  for (const row of options.signups) {
    if (row.memberId !== memberId) continue;
    if (row.startDt > options.nowIso || !sinceTrackingStart(row.startDateOnly)) continue;
    if (!inSeason(row.startDateOnly, seasonCountStart, seasonEnd)) continue;
    if (row.memberName) memberName = normalizePersonName(row.memberName) || row.memberName;
    const existing = shifts.get(row.shiftId);
    const roleName = row.roleName?.trim();
    if (existing) {
      if (roleName && !existing.roles.includes(roleName)) existing.roles.push(roleName);
      continue;
    }
    shifts.set(row.shiftId, {
      id: `shift:${row.shiftId}`,
      kind: 'shift',
      date: row.startDateOnly,
      hours: roundVolunteerHours(volunteerShiftDurationHours(row.startDt, row.endDt)),
      summary: row.programTitle?.trim() || 'Volunteer shift',
      detail: null,
      roles: roleName ? [roleName] : [],
    });
  }

  for (const shift of shifts.values()) {
    activities.push({
      id: shift.id,
      kind: shift.kind,
      date: shift.date,
      hours: shift.hours,
      summary: shift.summary,
      detail: shift.roles.length > 0 ? shift.roles.join(', ') : null,
    });
  }

  for (const log of options.hourLogs) {
    if (log.memberId !== memberId) continue;
    if (log.volunteerDate > options.todayDateOnly || !sinceTrackingStart(log.volunteerDate)) continue;
    if (!inSeason(log.volunteerDate, seasonCountStart, seasonEnd)) continue;
    if (log.memberName) memberName = normalizePersonName(log.memberName) || log.memberName;
    activities.push({
      id: `self_report:${log.id ?? `${log.volunteerDate}:${log.hours}`}`,
      kind: 'self_report',
      date: log.volunteerDate,
      hours: roundVolunteerHours(Number(log.hours)),
      summary: log.description?.trim() || 'Self-reported hours',
      detail: null,
    });
  }

  activities.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
    return a.id.localeCompare(b.id);
  });

  return {
    memberId,
    memberName,
    season: options.season,
    totalHours: roundVolunteerHours(activities.reduce((sum, activity) => sum + activity.hours, 0)),
    activities,
  };
}
