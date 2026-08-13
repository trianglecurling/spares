import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { format } from 'date-fns';
import { RRule } from 'rrule';
import ChoiceInput, { type ChoiceOption } from './ChoiceInput';
import FormField from './FormField';
import {
  RECURRENCE_PRESETS,
  RRULE_DAY_LABELS,
  RRULE_DAYS,
  getWeekdayFromDate,
  matchRecurrencePreset,
  parseRecurrenceLimits,
} from '../pages/calendarEventFormShared';

export type RecurrenceSubmitPayload = {
  rrule: string;
  endDate?: string;
  count?: number;
};

export type RecurrenceFieldsState = {
  preset: string;
  custom: string;
  weekdays: (typeof RRULE_DAYS)[number][];
  endDate: string;
  count: number | '';
  rrule: string;
  payload: RecurrenceSubmitPayload | null;
  previewCount: number | null;
};

function rruleFromParts(
  preset: string,
  custom: string,
  weekdays: (typeof RRULE_DAYS)[number][]
): string {
  if (preset === 'custom' && custom.trim()) return custom.trim();
  if (preset === 'weekly' && weekdays.length > 0) {
    return `FREQ=WEEKLY;BYDAY=${weekdays.join(',')}`;
  }
  const found = RECURRENCE_PRESETS.find((p) => p.value === preset);
  return found?.rrule ?? '';
}

function payloadFromParts(
  preset: string,
  custom: string,
  weekdays: (typeof RRULE_DAYS)[number][],
  endDate: string,
  count: number | ''
): RecurrenceSubmitPayload | null {
  const rrule = rruleFromParts(preset, custom, weekdays);
  if (!rrule || preset === 'none') return null;
  return {
    rrule,
    endDate: endDate || undefined,
    count: count !== '' ? count : undefined,
  };
}

function previewCountFromParts(
  rrule: string,
  startDate: string,
  startTime: string,
  allDay: boolean,
  endDate: string,
  count: number | ''
): number | null {
  if (!rrule || !startDate) return null;
  try {
    const options = RRule.parseString(rrule) as {
      dtstart?: Date;
      until?: Date;
      count?: number;
    };
    options.dtstart = new Date(`${startDate}T${allDay ? '00:00' : startTime || '00:00'}:00`);
    if (endDate) {
      options.until = new Date(`${endDate}T23:59:59`);
      delete options.count;
    } else if (count !== '' && typeof count === 'number' && count >= 1) {
      options.count = count;
      delete options.until;
    } else {
      return null;
    }
    const dates = new RRule(options).all();
    return dates.length;
  } catch {
    return null;
  }
}

export function useRecurrenceState(
  initialRrule: string,
  startDate: string,
  options?: { fallbackPreset?: string }
): RecurrenceFieldsState & {
  setPreset: (value: string) => void;
  setCustom: (value: string) => void;
  toggleWeekday: (day: (typeof RRULE_DAYS)[number]) => void;
  setWeekdays: (days: (typeof RRULE_DAYS)[number][]) => void;
  setEndDate: (value: string) => void;
  setCount: (value: number | '') => void;
  handleEndDateChange: (value: string, startTime: string, allDay: boolean) => void;
  handleCountChange: (value: number | '', startTime: string, allDay: boolean) => void;
} {
  const initial = matchRecurrencePreset(initialRrule);
  const initialLimits = parseRecurrenceLimits(initialRrule);
  const start = startDate ? new Date(`${startDate}T12:00:00`) : new Date();
  const defaultWeeklyDays =
    initial.preset === 'weekly' && initial.weeklyDays
      ? initial.weeklyDays
      : [getWeekdayFromDate(Number.isNaN(start.getTime()) ? new Date() : start)];
  const [preset, setPreset] = useState(() => {
    if (initial.preset !== 'none') return initial.preset;
    return options?.fallbackPreset || 'none';
  });
  const [custom, setCustom] = useState(initial.custom);
  const [weekdays, setWeekdays] = useState<(typeof RRULE_DAYS)[number][]>(() => {
    if (initial.preset === 'weekly') return defaultWeeklyDays;
    if ((options?.fallbackPreset || initial.preset) === 'weekly') return defaultWeeklyDays;
    return [];
  });
  const [endDate, setEndDate] = useState(initial.preset === 'custom' ? '' : initialLimits.endDate);
  const [count, setCount] = useState<number | ''>(
    initial.preset === 'custom' ? '' : initialLimits.count
  );
  const lastEditedLimitRef = useRef<'endDate' | 'count' | null>(null);
  const previousPresetRef = useRef(preset);

  useEffect(() => {
    if (preset === 'weekly' && weekdays.length === 0 && startDate) {
      const d = new Date(`${startDate}T12:00:00`);
      if (!Number.isNaN(d.getTime())) setWeekdays([getWeekdayFromDate(d)]);
    }
  }, [preset, startDate, weekdays.length]);

  useEffect(() => {
    if (previousPresetRef.current === preset) return;
    previousPresetRef.current = preset;
    setEndDate('');
    setCount('');
    lastEditedLimitRef.current = null;
  }, [preset]);

  useEffect(() => {
    if (preset === 'custom') {
      setEndDate('');
      setCount('');
      lastEditedLimitRef.current = null;
    }
  }, [preset, custom]);

  const rrule = rruleFromParts(preset, custom, weekdays);
  const payload = payloadFromParts(preset, custom, weekdays, endDate, count);

  const toggleWeekday = (day: (typeof RRULE_DAYS)[number]) => {
    setWeekdays((prev) => {
      if (prev.includes(day)) {
        const next = prev.filter((d) => d !== day);
        return next.length > 0 ? next : prev;
      }
      return [...prev, day];
    });
  };

  const handleEndDateChange = useCallback(
    (value: string, startTime: string, allDay: boolean) => {
      lastEditedLimitRef.current = 'endDate';
      setEndDate(value);
      if (!value) {
        setCount('');
        return;
      }
      const rruleStr = rruleFromParts(preset, custom, weekdays);
      if (!rruleStr || !startDate) return;
      try {
        const options = RRule.parseString(rruleStr) as {
          dtstart?: Date;
          until?: Date;
          count?: number;
        };
        options.dtstart = new Date(`${startDate}T${allDay ? '00:00' : startTime}:00`);
        options.until = new Date(`${value}T23:59:59`);
        delete options.count;
        setCount(new RRule(options).all().length);
      } catch {
        // ignore parse errors
      }
    },
    [preset, custom, weekdays, startDate]
  );

  const handleCountChange = useCallback(
    (value: number | '', startTime: string, allDay: boolean) => {
      lastEditedLimitRef.current = 'count';
      setCount(value);
      if (value === '' || typeof value !== 'number' || Number.isNaN(value) || value < 1) {
        setEndDate('');
        return;
      }
      const rruleStr = rruleFromParts(preset, custom, weekdays);
      if (!rruleStr || !startDate) return;
      try {
        const options = RRule.parseString(rruleStr) as { dtstart?: Date; count?: number };
        options.dtstart = new Date(`${startDate}T${allDay ? '00:00' : startTime}:00`);
        options.count = value;
        const dates = new RRule(options).all();
        if (dates.length > 0) {
          setEndDate(format(dates[dates.length - 1]!, 'yyyy-MM-dd'));
        }
      } catch {
        // ignore parse errors
      }
    },
    [preset, custom, weekdays, startDate]
  );

  return {
    preset,
    custom,
    weekdays,
    endDate,
    count,
    rrule,
    payload,
    previewCount: previewCountFromParts(rrule, startDate, '09:00', false, endDate, count),
    setPreset,
    setCustom,
    toggleWeekday,
    setWeekdays,
    setEndDate,
    setCount,
    handleEndDateChange,
    handleCountChange,
  };
}

type RecurrenceFieldsProps = {
  idPrefix: string;
  startDate: string;
  startTime: string;
  allDay?: boolean;
  allowNone?: boolean;
  requireLimit?: boolean;
  state: RecurrenceFieldsState & {
    setPreset: (value: string) => void;
    setCustom: (value: string) => void;
    toggleWeekday: (day: (typeof RRULE_DAYS)[number]) => void;
    setWeekdays: (days: (typeof RRULE_DAYS)[number][]) => void;
    handleEndDateChange: (value: string, startTime: string, allDay: boolean) => void;
    handleCountChange: (value: number | '', startTime: string, allDay: boolean) => void;
  };
};

export default function RecurrenceFields({
  idPrefix,
  startDate,
  startTime,
  allDay = false,
  allowNone = true,
  requireLimit = false,
  state,
}: RecurrenceFieldsProps) {
  const recurrenceChoices = useMemo<ChoiceOption<string>[]>(
    () =>
      RECURRENCE_PRESETS.filter((p) => allowNone || p.value !== 'none').map((p) => ({
        value: p.value,
        label: p.label,
      })),
    [allowNone]
  );
  const labelId = `${idPrefix}-recurrence-label`;
  const customId = `${idPrefix}-recurrence-custom`;
  const endDateId = `${idPrefix}-recurrence-end`;
  const countId = `${idPrefix}-recurrence-count`;
  const weekdaysLabelId = `${idPrefix}-recurrence-weekdays`;
  const missingLimit = requireLimit && !state.endDate && state.count === '';
  const preview = previewCountFromParts(
    state.rrule,
    startDate,
    startTime,
    allDay,
    state.endDate,
    state.count
  );

  return (
    <div className="space-y-3">
      <FormField label="Recurrence" labelId={labelId} htmlFor={`${idPrefix}-recurrence`}>
        <ChoiceInput<string>
          inputId={`${idPrefix}-recurrence`}
          ariaLabelledBy={labelId}
          options={recurrenceChoices}
          value={state.preset === 'none' && !allowNone ? 'weekly' : state.preset}
          onChange={(next) => {
            if (next != null && !Array.isArray(next)) state.setPreset(next);
          }}
          listboxLabel="Recurrence"
          inputClassName="app-input"
        />
      </FormField>
      {state.preset !== 'none' && (
        <div className="space-y-3">
          {state.preset === 'weekly' && (
            <div>
              <div className="app-label" id={weekdaysLabelId}>
                Repeat on
              </div>
              <div
                className="flex flex-wrap gap-2 mt-1"
                role="group"
                aria-labelledby={weekdaysLabelId}
              >
                {(['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const).map((day) => (
                  <label
                    key={day}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-gray-300 dark:border-gray-600 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={state.weekdays.includes(day)}
                      onChange={() => state.toggleWeekday(day)}
                      className="rounded border-gray-300 dark:border-gray-600"
                    />
                    <span className="text-sm">{RRULE_DAY_LABELS[day]}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
          {state.preset === 'custom' && (
            <FormField label="Custom RRULE" htmlFor={customId}>
              <input
                id={customId}
                type="text"
                placeholder="e.g. FREQ=WEEKLY;BYDAY=MO,WE,FR"
                value={state.custom}
                onChange={(e) => state.setCustom(e.target.value)}
                className="app-input text-sm"
              />
            </FormField>
          )}
          <div className="flex flex-wrap items-end gap-3">
            <FormField label="End date" htmlFor={endDateId} className="w-auto">
              <input
                id={endDateId}
                type="date"
                value={state.endDate}
                onChange={(e) => state.handleEndDateChange(e.target.value, startTime, allDay)}
                className="app-input"
              />
            </FormField>
            <span className="text-sm text-gray-500 dark:text-gray-400 pb-2">or</span>
            <FormField label="Count" htmlFor={countId} className="w-auto">
              <input
                id={countId}
                type="number"
                min={1}
                value={state.count}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === '') state.handleCountChange('', startTime, allDay);
                  else {
                    const n = parseInt(v, 10);
                    if (!Number.isNaN(n)) state.handleCountChange(n, startTime, allDay);
                  }
                }}
                className="app-input w-24"
              />
            </FormField>
          </div>
          {requireLimit ? (
            <p className={`text-sm ${missingLimit ? 'text-amber-800 dark:text-amber-200' : 'text-gray-600 dark:text-gray-400'}`}>
              {missingLimit
                ? 'Recurring shifts need an end date or a count.'
                : preview != null
                  ? preview === 1
                    ? 'This will create 1 shift.'
                    : `This will create ${preview} shifts.`
                  : null}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
