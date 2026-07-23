import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  differenceInDays,
  differenceInMinutes,
  format,
} from 'date-fns';
import { RRule } from 'rrule';
import api from '../utils/api';
import Button from './Button';
import PageTabs from './PageTabs';
import ArticleAutocomplete, { type ArticleOption } from './ArticleAutocomplete';
import FormField from './FormField';
import FormSection from './FormSection';
import ChoiceInput, { type ChoiceOption } from './ChoiceInput';
import MarkdownDescriptionEditor, { type MarkdownDescriptionEditorRef } from './MarkdownDescriptionEditor';
import { useAlert } from '../contexts/AlertContext';
import { useTheme } from '../contexts/ThemeContext';
import type { CalendarEvent, CalendarEventType } from '../pages/Calendar';
import {
  LOCATION_OPTIONS,
  RECURRENCE_PRESETS,
  RRULE_DAYS,
  RRULE_DAY_LABELS,
  getWeekdayFromDate,
  matchRecurrencePreset,
  parseRecurrenceLimits,
} from '../pages/calendarEventFormShared';

export interface CalendarEventFormProps {
  event: CalendarEvent | null;
  sheets: Array<{ id: number; name: string }>;
  eventTypes: CalendarEventType[];
  initialDate: Date;
  onSaved: () => void;
}

export default function CalendarEventForm({
  event,
  sheets,
  eventTypes,
  initialDate,
  onSaved,
}: CalendarEventFormProps) {
  const { showAlert } = useAlert();
  const base = event
    ? { start: event.start, end: event.end }
    : (() => {
        const start = new Date(initialDate);
        const hasTime = start.getHours() !== 0 || start.getMinutes() !== 0;
        if (!hasTime) start.setHours(9, 0, 0);
        const end = new Date(start);
        end.setHours(end.getHours() + (hasTime ? 1 : 2), 0, 0);
        return { start, end };
      })();
  const [title, setTitle] = useState(event?.title ?? '');
  const [typeId, setTypeId] = useState(event?.typeId ?? 'other');
  const [startDate, setStartDate] = useState(format(base.start, 'yyyy-MM-dd'));
  const [startTime, setStartTime] = useState(format(base.start, 'HH:mm'));
  const [endDate, setEndDate] = useState(format(base.end, 'yyyy-MM-dd'));
  const [endTime, setEndTime] = useState(format(base.end, 'HH:mm'));
  const [allDay, setAllDay] = useState(event?.allDay ?? false);
  const [selectedSheets, setSelectedSheets] = useState<number[]>(
    () =>
      (event?.locations ?? [])
        .filter(
          (l): l is { type: 'sheet'; sheetId: number; sheetName?: string } => l.type === 'sheet'
        )
        .map((l) => l.sheetId) ?? []
  );
  const [selectedFixedLocs, setSelectedFixedLocs] = useState<
    Array<'warm-room' | 'exterior' | 'offsite' | 'virtual'>
  >(
    () =>
      (event?.locations ?? [])
        .filter(
          (l): l is { type: 'warm-room' | 'exterior' | 'offsite' | 'virtual' } => l.type !== 'sheet'
        )
        .map((l) => l.type) ?? []
  );
  const initialRecurrence = matchRecurrencePreset(event?.recurrenceRrule ?? '');
  const initialRecurrenceLimits = parseRecurrenceLimits(event?.recurrenceRrule ?? '');
  const defaultWeeklyDays =
    initialRecurrence.preset === 'weekly' && initialRecurrence.weeklyDays
      ? initialRecurrence.weeklyDays
      : [getWeekdayFromDate(base.start)];
  const [recurrencePreset, setRecurrencePreset] = useState(initialRecurrence.preset);
  const [recurrenceCustom, setRecurrenceCustom] = useState(initialRecurrence.custom);
  const [selectedWeekdays, setSelectedWeekdays] = useState<(typeof RRULE_DAYS)[number][]>(
    initialRecurrence.preset === 'weekly' ? defaultWeeklyDays : []
  );
  const [recurrenceEndDate, setRecurrenceEndDate] = useState(
    initialRecurrence.preset === 'custom' ? '' : initialRecurrenceLimits.endDate
  );
  const [recurrenceCount, setRecurrenceCount] = useState<number | ''>(
    initialRecurrence.preset === 'custom' ? '' : initialRecurrenceLimits.count
  );
  const [editScope, setEditScope] = useState<'this' | 'all'>('this');
  const [linkedArticle, setLinkedArticle] = useState<ArticleOption | null>(event?.article ?? null);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'details' | 'description'>('details');
  const descriptionEditorRef = useRef<MarkdownDescriptionEditorRef>(null);
  const lastEditedRecurrenceLimitRef = useRef<'endDate' | 'count' | null>(null);
  const previousRecurrencePresetRef = useRef(initialRecurrence.preset);
  const { resolvedTheme } = useTheme();

  const isRecurringEdit = Boolean(event?.id && event.id.split(':').length === 3);
  const isEditingSingleInstance = isRecurringEdit && editScope === 'this';

  useEffect(() => {
    if (recurrencePreset === 'weekly' && selectedWeekdays.length === 0) {
      const d = new Date(`${startDate}T12:00:00`);
      setSelectedWeekdays([getWeekdayFromDate(d)]);
    }
  }, [recurrencePreset, startDate, selectedWeekdays.length]);

  useEffect(() => {
    if (previousRecurrencePresetRef.current === recurrencePreset) return;
    previousRecurrencePresetRef.current = recurrencePreset;
    setRecurrenceEndDate('');
    setRecurrenceCount('');
    lastEditedRecurrenceLimitRef.current = null;
  }, [recurrencePreset]);

  useEffect(() => {
    if (recurrencePreset === 'custom') {
      setRecurrenceEndDate('');
      setRecurrenceCount('');
      lastEditedRecurrenceLimitRef.current = null;
    }
  }, [recurrencePreset, recurrenceCustom]);

  useEffect(() => {
    if (recurrencePreset !== 'weekly' || selectedWeekdays.length === 0) return;
    const lastEdited = lastEditedRecurrenceLimitRef.current;
    const rruleStr = `FREQ=WEEKLY;BYDAY=${selectedWeekdays.join(',')}`;
    const eventStart = new Date(`${startDate}T${allDay ? '00:00' : startTime}:00`);
    try {
      if (lastEdited === 'endDate' && recurrenceEndDate) {
        const options = RRule.parseString(rruleStr) as {
          dtstart?: Date;
          until?: Date;
          count?: number;
        };
        options.dtstart = eventStart;
        options.until = new Date(`${recurrenceEndDate}T23:59:59`);
        delete options.count;
        const rule = new RRule(options);
        const dates = rule.all();
        setRecurrenceCount(dates.length);
      } else if (
        lastEdited === 'count' &&
        recurrenceCount !== '' &&
        typeof recurrenceCount === 'number' &&
        recurrenceCount >= 1
      ) {
        const options = RRule.parseString(rruleStr) as { dtstart?: Date; count?: number };
        options.dtstart = eventStart;
        options.count = recurrenceCount;
        const rule = new RRule(options);
        const dates = rule.all();
        if (dates.length > 0) {
          const lastDate = dates[dates.length - 1]!;
          setRecurrenceEndDate(format(lastDate, 'yyyy-MM-dd'));
        }
      }
    } catch {
      // ignore parse errors
    }
  }, [recurrencePreset, selectedWeekdays, startDate, startTime, allDay]);

  const toggleWeekday = (day: (typeof RRULE_DAYS)[number]) => {
    setSelectedWeekdays((prev) => {
      if (prev.includes(day)) {
        const next = prev.filter((d) => d !== day);
        return next.length > 0 ? next : prev;
      }
      return [...prev, day];
    });
  };

  const handleStartDateChange = (v: string) => {
    setStartDate(v);
    if (startDate === endDate) setEndDate(v);
  };

  const handleStartTimeChange = (v: string) => {
    const start = new Date(`${startDate}T${startTime}:00`);
    const end = new Date(`${endDate}T${endTime}:00`);
    const durationMs = end.getTime() - start.getTime();
    const newStart = new Date(`${startDate}T${v}:00`);
    const newEnd = new Date(newStart.getTime() + durationMs);
    setStartTime(v);
    setEndTime(format(newEnd, 'HH:mm'));
    setEndDate(format(newEnd, 'yyyy-MM-dd'));
  };

  const durationLabel = useMemo(() => {
    if (allDay) {
      const start = new Date(`${startDate}T00:00:00`);
      const end = new Date(`${endDate}T23:59:59`);
      const days = differenceInDays(end, start) + 1;
      return days === 1 ? '1 day' : `${days} days`;
    }
    const start = new Date(`${startDate}T${startTime}:00`);
    const end = new Date(`${endDate}T${endTime}:00`);
    const mins = differenceInMinutes(end, start);
    if (mins < 0) return 'Invalid';
    if (mins < 60) return `${mins} min`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
  }, [allDay, startDate, startTime, endDate, endTime]);

  const eventTypeChoices = useMemo<ChoiceOption<string>[]>(
    () => eventTypes.map((t) => ({ value: t.id, label: t.label })),
    [eventTypes]
  );
  const recurrenceChoices = useMemo<ChoiceOption<string>[]>(
    () => RECURRENCE_PRESETS.map((p) => ({ value: p.value, label: p.label })),
    []
  );

  const toggleSheet = (id: number) => {
    setSelectedSheets((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));
  };
  const toggleFixedLoc = (t: 'warm-room' | 'exterior' | 'offsite' | 'virtual') => {
    setSelectedFixedLocs((prev) => (prev.includes(t) ? prev.filter((l) => l !== t) : [...prev, t]));
  };

  const getCurrentRrule = useCallback((): string => {
    if (recurrencePreset === 'custom' && recurrenceCustom.trim()) return recurrenceCustom.trim();
    if (recurrencePreset === 'weekly' && selectedWeekdays.length > 0) {
      return `FREQ=WEEKLY;BYDAY=${selectedWeekdays.join(',')}`;
    }
    const preset = RECURRENCE_PRESETS.find((p) => p.value === recurrencePreset);
    return preset?.rrule ?? '';
  }, [recurrencePreset, recurrenceCustom, selectedWeekdays]);

  const handleRecurrenceCountChange = useCallback(
    (value: number | '') => {
      lastEditedRecurrenceLimitRef.current = 'count';
      setRecurrenceCount(value);
      if (value === '' || typeof value !== 'number' || isNaN(value) || value < 1) {
        setRecurrenceEndDate('');
        return;
      }
      const rruleStr = getCurrentRrule();
      if (!rruleStr) return;
      try {
        const options = RRule.parseString(rruleStr) as { dtstart?: Date; count?: number };
        options.dtstart = new Date(`${startDate}T${allDay ? '00:00' : startTime}:00`);
        options.count = value;
        const rule = new RRule(options);
        const dates = rule.all();
        if (dates.length > 0) {
          const lastDate = dates[dates.length - 1]!;
          setRecurrenceEndDate(format(lastDate, 'yyyy-MM-dd'));
        }
      } catch {
        // ignore parse errors
      }
    },
    [getCurrentRrule, startDate, startTime, allDay]
  );

  const handleRecurrenceEndDateChange = useCallback(
    (value: string) => {
      lastEditedRecurrenceLimitRef.current = 'endDate';
      setRecurrenceEndDate(value);
      if (!value) {
        setRecurrenceCount('');
        return;
      }
      const rruleStr = getCurrentRrule();
      if (!rruleStr) return;
      try {
        const options = RRule.parseString(rruleStr) as {
          dtstart?: Date;
          until?: Date;
          count?: number;
        };
        options.dtstart = new Date(`${startDate}T${allDay ? '00:00' : startTime}:00`);
        options.until = new Date(`${value}T23:59:59`);
        delete options.count;
        const rule = new RRule(options);
        const dates = rule.all();
        setRecurrenceCount(dates.length);
      } catch {
        // ignore parse errors
      }
    },
    [getCurrentRrule, startDate, startTime, allDay]
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const start = new Date(`${startDate}T${allDay ? '00:00' : startTime}:00`);
    const end = new Date(`${endDate}T${allDay ? '23:59' : endTime}:00`);
    const locations: Array<
      | { type: 'sheet'; sheetId: number; sheetName?: string }
      | { type: 'warm-room' | 'exterior' | 'offsite' | 'virtual' }
    > = [
      ...selectedSheets.map((id) => ({
        type: 'sheet' as const,
        sheetId: id,
        sheetName: sheets.find((s) => s.id === id)?.name,
      })),
      ...selectedFixedLocs.map((type) => ({ type })),
    ];

    let rrule: string | undefined;
    if (!isEditingSingleInstance) {
      if (recurrencePreset === 'custom' && recurrenceCustom.trim()) {
        rrule = recurrenceCustom.trim();
      } else if (recurrencePreset === 'weekly' && selectedWeekdays.length > 0) {
        rrule = `FREQ=WEEKLY;BYDAY=${selectedWeekdays.join(',')}`;
      } else if (recurrencePreset !== 'none') {
        const preset = RECURRENCE_PRESETS.find((p) => p.value === recurrencePreset);
        rrule = preset?.rrule;
      }
    }

    const description =
      descriptionEditorRef.current?.getMarkdown?.() ?? event?.description ?? '';
    const payload = {
      typeId,
      title,
      start: start.toISOString(),
      end: end.toISOString(),
      allDay,
      description: description.trim() || undefined,
      articleId: linkedArticle?.id ?? null,
      locations: locations.length > 0 ? locations : undefined,
      recurrence:
        !isEditingSingleInstance && rrule
          ? {
              rrule,
              endDate: recurrenceEndDate || undefined,
              count: recurrenceCount !== '' ? recurrenceCount : undefined,
            }
          : undefined,
    };

    try {
      if (event) {
        const id = event.id;
        const scope = id.split(':').length === 3 ? editScope : undefined;
        await api.patch(`/calendar/events/${encodeURIComponent(id)}`, { ...payload, scope });
      } else {
        await api.post('/calendar/events', payload);
      }
      onSaved();
    } catch {
      showAlert('Failed to save event', 'error');
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <PageTabs
        className="shrink-0"
        items={[
          {
            key: 'details',
            label: 'Event details',
            isActive: activeTab === 'details',
            onClick: () => setActiveTab('details'),
          },
          {
            key: 'description',
            label: 'Description',
            isActive: activeTab === 'description',
            onClick: () => setActiveTab('description'),
          },
        ]}
      />

      <div className="flex min-h-[min(28rem,55dvh)] shrink-0 flex-col overflow-y-auto">
        {activeTab === 'details' && (
          <div className="space-y-4">
            <FormSection
              title="Basics"
              description="Set the event name, classification, and any linked article."
            >
              <FormField label="Title" htmlFor="calendar-event-title" required>
                <input
                  id="calendar-event-title"
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                  className="app-input"
                />
              </FormField>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <FormField label="Type" htmlFor="calendar-event-type" required>
                  <ChoiceInput<string>
                    inputId="calendar-event-type"
                    options={eventTypeChoices}
                    value={typeId}
                    onChange={(next) => {
                      if (next != null && !Array.isArray(next)) setTypeId(next);
                    }}
                    listboxLabel="Event type"
                  />
                </FormField>
                <FormField
                  label="Linked article"
                  helperText="Leave this empty when the event does not need a related article page."
                >
                  <ArticleAutocomplete
                    value={linkedArticle}
                    onChange={setLinkedArticle}
                    placeholder="Search for an article"
                  />
                </FormField>
              </div>
            </FormSection>

            <FormSection
              title="Schedule"
              description="Choose when the event starts and ends. Entered values stay in place if saving fails."
            >
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <FormField label="Start" required helperText="Choose the first occurrence start time.">
                  <div className="flex gap-2">
                    <input
                      type="date"
                      value={startDate}
                      onChange={(e) => handleStartDateChange(e.target.value)}
                      className="app-input flex-1"
                    />
                    {!allDay ? (
                      <input
                        type="time"
                        value={startTime}
                        onChange={(e) => handleStartTimeChange(e.target.value)}
                        className="app-input flex-1"
                      />
                    ) : null}
                  </div>
                </FormField>
                <FormField label="End" required helperText={`Duration: ${durationLabel}`}>
                  <div className="flex gap-2">
                    <input
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="app-input flex-1"
                    />
                    {!allDay ? (
                      <input
                        type="time"
                        value={endTime}
                        onChange={(e) => setEndTime(e.target.value)}
                        className="app-input flex-1"
                      />
                    ) : null}
                  </div>
                </FormField>
              </div>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={allDay}
                  onChange={(e) => setAllDay(e.target.checked)}
                  className="rounded"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">All day</span>
              </label>
            </FormSection>
            <div>
              <label className="app-label">Locations</label>
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2" role="group" aria-label="On ice">
                  <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide shrink-0">
                    Sheets
                  </span>
                  {sheets.map((s) => {
                    const selected = selectedSheets.includes(s.id);
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => toggleSheet(s.id)}
                        className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                          selected
                            ? 'bg-primary-teal-solid text-white'
                            : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                        }`}
                      >
                        {s.name}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() =>
                      selectedSheets.length === sheets.length
                        ? setSelectedSheets([])
                        : setSelectedSheets(sheets.map((s) => s.id))
                    }
                    className="text-xs text-primary-teal-link hover:underline shrink-0"
                  >
                    {selectedSheets.length === sheets.length ? 'Unselect all' : 'Select all'}
                  </button>
                </div>
                <div className="flex flex-wrap gap-2" role="group" aria-label="Other locations">
                  {LOCATION_OPTIONS.map((opt) => {
                    const selected = selectedFixedLocs.includes(opt.type);
                    return (
                      <button
                        key={opt.type}
                        type="button"
                        onClick={() => toggleFixedLoc(opt.type)}
                        className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                          selected
                            ? 'bg-primary-teal-solid text-white'
                            : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
            {isRecurringEdit && (
              <div className="rounded-md border border-gray-200 dark:border-gray-600 p-3 bg-gray-50 dark:bg-gray-800/50">
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  This is a recurring event. Apply changes to:
                </p>
                <div className="flex gap-4">
                  <label className="inline-flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="editScope"
                      checked={editScope === 'this'}
                      onChange={() => setEditScope('this')}
                      className="border-gray-300 dark:border-gray-600"
                    />
                    <span className="text-sm text-gray-700 dark:text-gray-300">This instance only</span>
                  </label>
                  <label className="inline-flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="editScope"
                      checked={editScope === 'all'}
                      onChange={() => setEditScope('all')}
                      className="border-gray-300 dark:border-gray-600"
                    />
                    <span className="text-sm text-gray-700 dark:text-gray-300">All instances</span>
                  </label>
                </div>
              </div>
            )}
            {!isEditingSingleInstance && (
              <div>
                <label className="app-label" id="calendar-event-recurrence-label">
                  Recurrence
                </label>
                <ChoiceInput<string>
                  ariaLabelledBy="calendar-event-recurrence-label"
                  options={recurrenceChoices}
                  value={recurrencePreset}
                  onChange={(next) => {
                    if (next != null && !Array.isArray(next)) setRecurrencePreset(next);
                  }}
                  listboxLabel="Recurrence"
                  inputClassName="app-input mb-2"
                />
                {recurrencePreset !== 'none' && (
                  <div className="space-y-2 mt-2">
                    {recurrencePreset === 'weekly' && (
                      <div>
                        <span className="text-sm text-gray-600 dark:text-gray-400 mr-2">Repeat on:</span>
                        <div className="flex flex-wrap gap-2 mt-1">
                          {(['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const).map((day) => (
                            <label
                              key={day}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-gray-300 dark:border-gray-600 cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                checked={selectedWeekdays.includes(day)}
                                onChange={() => toggleWeekday(day)}
                                className="rounded border-gray-300 dark:border-gray-600"
                              />
                              <span className="text-sm">{RRULE_DAY_LABELS[day]}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    )}
                    {recurrencePreset === 'custom' && (
                      <input
                        type="text"
                        placeholder="e.g. FREQ=WEEKLY;BYDAY=MO,WE,FR"
                        value={recurrenceCustom}
                        onChange={(e) => setRecurrenceCustom(e.target.value)}
                        className="app-input text-sm"
                      />
                    )}
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="flex items-center gap-2">
                        <span className="text-sm text-gray-600 dark:text-gray-400">End date:</span>
                        <input
                          type="date"
                          value={recurrenceEndDate}
                          onChange={(e) => handleRecurrenceEndDateChange(e.target.value)}
                          className="px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-sm"
                        />
                      </label>
                      <span className="text-sm text-gray-500 dark:text-gray-400">or</span>
                      <label className="flex items-center gap-2">
                        <span className="text-sm text-gray-600 dark:text-gray-400">Count:</span>
                        <input
                          type="number"
                          min={1}
                          value={recurrenceCount}
                          onChange={(e) => {
                            const v = e.target.value;
                            if (v === '') handleRecurrenceCountChange('');
                            else {
                              const n = parseInt(v, 10);
                              if (!isNaN(n)) handleRecurrenceCountChange(n);
                            }
                          }}
                          className="w-20 px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-sm"
                        />
                      </label>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        {activeTab === 'description' && (
          <div className="flex min-h-0 flex-1 flex-col">
            <MarkdownDescriptionEditor
              key={event?.id ?? 'new'}
              ref={descriptionEditorRef}
              initialValue={event?.description ?? ''}
              fill
              dark={resolvedTheme === 'dark'}
            />
          </div>
        )}
      </div>

      <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-gray-200 pt-4 dark:border-gray-600">
        <Button type="submit" variant="primary" disabled={saving}>
          {saving ? 'Saving...' : event ? 'Update' : 'Create'}
        </Button>
      </div>
    </form>
  );
}
