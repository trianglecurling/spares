export const VOLUNTEER_HOUR_LOG_MIN = 0.5;
export const VOLUNTEER_HOUR_LOG_MAX = 8;
export const VOLUNTEER_HOUR_LOG_STEP = 0.5;
export const VOLUNTEER_HOUR_LOG_DESCRIPTION_MAX = 2000;
export const VOLUNTEER_HOUR_LOG_MAX_MESSAGE =
  'The maximum number of hours per report is 8. If you need to log more time, create an additional report.';

export type VolunteerHourLogFieldErrors = {
  volunteerDate?: string;
  hours?: string;
  description?: string;
  memberId?: string;
};

export class VolunteerHourLogValidationError extends Error {
  constructor(
    message: string,
    public details: VolunteerHourLogFieldErrors
  ) {
    super(message);
    this.name = 'VolunteerHourLogValidationError';
  }
}

export function isValidVolunteerHourIncrement(hours: number): boolean {
  if (!Number.isFinite(hours)) return false;
  if (hours < VOLUNTEER_HOUR_LOG_MIN || hours > VOLUNTEER_HOUR_LOG_MAX) return false;
  return Math.abs(hours * 2 - Math.round(hours * 2)) < 1e-9;
}

/** Round up to the next 0.5-hour increment (1.1 → 1.5, 1.5 → 1.5). */
export function roundVolunteerHoursUp(hours: number): number {
  return Math.ceil(hours * 2 - 1e-9) / 2;
}

export function parseVolunteerHourLogHours(value: unknown): number {
  const hours = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(hours) || hours <= 0) {
    throw new VolunteerHourLogValidationError('Enter the number of hours.', {
      hours: 'Enter the number of hours.',
    });
  }
  if (hours > VOLUNTEER_HOUR_LOG_MAX) {
    throw new VolunteerHourLogValidationError(VOLUNTEER_HOUR_LOG_MAX_MESSAGE, {
      hours: VOLUNTEER_HOUR_LOG_MAX_MESSAGE,
    });
  }
  const rounded = Math.round(roundVolunteerHoursUp(hours) * 10) / 10;
  if (rounded < VOLUNTEER_HOUR_LOG_MIN || rounded > VOLUNTEER_HOUR_LOG_MAX) {
    throw new VolunteerHourLogValidationError(VOLUNTEER_HOUR_LOG_MAX_MESSAGE, {
      hours: VOLUNTEER_HOUR_LOG_MAX_MESSAGE,
    });
  }
  return rounded;
}

export function parseVolunteerHourLogDate(value: unknown, todayDateOnly: string): string {
  const trimmed = String(value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    throw new VolunteerHourLogValidationError('Volunteer date must be YYYY-MM-DD.', {
      volunteerDate: 'Enter a valid date.',
    });
  }
  const [year, month, day] = trimmed.split('-').map(Number);
  const utc = Date.UTC(year, month - 1, day);
  const parsed = new Date(utc);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new VolunteerHourLogValidationError('Volunteer date must be a real calendar date.', {
      volunteerDate: 'Enter a valid date.',
    });
  }
  if (trimmed > todayDateOnly) {
    throw new VolunteerHourLogValidationError('Volunteer date cannot be in the future.', {
      volunteerDate: 'Choose today or an earlier date.',
    });
  }
  return trimmed;
}

export function parseVolunteerHourLogDescription(value: unknown): string {
  const description = String(value ?? '').trim();
  if (!description) {
    throw new VolunteerHourLogValidationError('Describe how you volunteered your time.', {
      description: 'Describe how you volunteered your time.',
    });
  }
  if (description.length > VOLUNTEER_HOUR_LOG_DESCRIPTION_MAX) {
    throw new VolunteerHourLogValidationError(
      `Description must be ${VOLUNTEER_HOUR_LOG_DESCRIPTION_MAX} characters or fewer.`,
      {
        description: `Use ${VOLUNTEER_HOUR_LOG_DESCRIPTION_MAX} characters or fewer.`,
      }
    );
  }
  return description;
}

export function parseVolunteerHourLogInput(
  input: { volunteerDate?: unknown; hours?: unknown; description?: unknown },
  todayDateOnly: string
): { volunteerDate: string; hours: number; description: string } {
  const details: VolunteerHourLogFieldErrors = {};
  let volunteerDate = '';
  let hours = 0;
  let description = '';

  try {
    volunteerDate = parseVolunteerHourLogDate(input.volunteerDate, todayDateOnly);
  } catch (err) {
    if (err instanceof VolunteerHourLogValidationError) {
      Object.assign(details, err.details);
    } else {
      throw err;
    }
  }

  try {
    hours = parseVolunteerHourLogHours(input.hours);
  } catch (err) {
    if (err instanceof VolunteerHourLogValidationError) {
      Object.assign(details, err.details);
    } else {
      throw err;
    }
  }

  try {
    description = parseVolunteerHourLogDescription(input.description);
  } catch (err) {
    if (err instanceof VolunteerHourLogValidationError) {
      Object.assign(details, err.details);
    } else {
      throw err;
    }
  }

  if (Object.keys(details).length > 0) {
    throw new VolunteerHourLogValidationError('Please fix the highlighted fields.', details);
  }

  return { volunteerDate, hours, description };
}
