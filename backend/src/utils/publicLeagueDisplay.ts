export type PublicLeagueFormationInput = {
  format: 'teams' | 'doubles' | 'instructional';
  leagueType: 'standard' | 'bring_your_own_team';
  teamFormation: 'coordinator' | 'skips_draft';
  allowsDropIns: boolean;
  isPlayInBased: boolean;
  minAge: number | null;
  maxAge: number | null;
  maxExperienceYears: number | null;
};

function formatExperienceYears(value: number): string {
  return Number.isInteger(value) ? String(value) : String(value);
}

export function buildPublicLeagueTypeText(league: PublicLeagueFormationInput): string {
  const parts: string[] = [];

  if (league.allowsDropIns) {
    parts.push('Pick-up style; teams formed each week.');
  } else if (league.format === 'teams') {
    parts.push('Open teams.');
  } else if (league.format === 'doubles') {
    parts.push('Open doubles.');
  } else if (league.format === 'instructional') {
    parts.push('Instructional program.');
  }

  if (league.isPlayInBased) {
    parts.push('Competitive; entry into the league determined by playdowns as needed.');
  }

  if (!league.allowsDropIns) {
    if (league.leagueType === 'bring_your_own_team') {
      parts.push('Build your own team.');
    } else if (league.teamFormation === 'skips_draft') {
      parts.push("Teams formed by skips' draft.");
    } else {
      parts.push('Teams formed by coordinator.');
    }
  }

  if (league.minAge != null && league.maxAge != null) {
    parts.push(`Ages ${league.minAge} to ${league.maxAge}.`);
  } else if (league.minAge != null) {
    parts.push(`Ages ${league.minAge} and up.`);
  } else if (league.maxAge != null) {
    parts.push(`Ages ${league.maxAge} and under.`);
  }

  if (league.maxExperienceYears != null) {
    parts.push(`Curlers under ${formatExperienceYears(league.maxExperienceYears)} years of experience only.`);
  }

  return parts.join(' ');
}

export function buildPublicLeagueCapacityText(input: {
  format: 'teams' | 'doubles' | 'instructional';
  capacityType: 'individual' | 'team';
  capacityValue: number;
  allowsDropIns: boolean;
}): string {
  const value = Math.max(0, input.capacityValue);
  if (value === 0) return 'Capacity TBD.';

  if (input.capacityType === 'individual') {
    if (input.allowsDropIns) {
      return `${value} curlers per week.`;
    }
    return `Maximum of ${value} curlers.`;
  }

  const curlersPerTeam = input.format === 'doubles' ? 2 : 4;
  const curlers = value * curlersPerTeam;
  return `Maximum of ${value} teams / ${curlers} curlers.`;
}

function parseDateParts(dateString: string): { year: number; month: number; day: number } {
  const [year, month, day] = dateString.split('-').map((part) => Number.parseInt(part, 10));
  return { year, month, day };
}

function formatLongDate(dateString: string): string {
  const { year, month, day } = parseDateParts(dateString);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' });
}

function formatLongDateWithYear(dateString: string): string {
  const { year, month, day } = parseDateParts(dateString);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

export function buildPublicLeagueDatesText(input: {
  firstDayOfPlay: string | null;
  lastDayOfPlay: string | null;
  startDate: string;
  endDate: string;
  exceptions: string[];
}): string {
  const start = input.firstDayOfPlay ?? input.startDate;
  const end = input.lastDayOfPlay ?? input.endDate;
  if (!start || !end) return 'Dates TBD.';

  const startYear = parseDateParts(start).year;
  const endYear = parseDateParts(end).year;
  const startText = startYear === endYear ? formatLongDate(start) : formatLongDateWithYear(start);
  const endText = formatLongDateWithYear(end);

  const exceptions = [...input.exceptions].sort();
  if (exceptions.length === 0) {
    return `${startText} through ${endText}.`;
  }

  const exceptionText =
    exceptions.length === 1
      ? formatLongDateWithYear(exceptions[0]!)
      : `${exceptions.slice(0, -1).map(formatLongDateWithYear).join(', ')} and ${formatLongDateWithYear(exceptions[exceptions.length - 1]!)}`;

  return `${startText} through ${endText} except ${exceptionText}.`;
}

export function formatPublicDrawTime(time: string): string {
  if (!time) return '';
  const [hourStr, minuteStr] = time.split(':');
  const hour = Number.parseInt(hourStr ?? '', 10);
  const minutes = (minuteStr ?? '00').padStart(2, '0');
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return `${displayHour}:${minutes} ${ampm}`;
}

export function buildPublicLeagueCostText(registrationFeeMinor: number): string {
  if (registrationFeeMinor <= 0) {
    return 'Free with basic ice privileges';
  }
  return `$${(registrationFeeMinor / 100).toFixed(2)}`;
}
