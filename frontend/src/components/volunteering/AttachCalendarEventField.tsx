import { useEffect, useId, useMemo, useState } from 'react';
import Button from '../Button';
import ChoiceInput, { type ChoiceOption } from '../ChoiceInput';
import FormField from '../FormField';
import InlineStateMessage from '../InlineStateMessage';
import Modal from '../Modal';
import api, { formatApiError } from '../../utils/api';
import { formatDateInTimeZone } from '../../utils/clubTime';
import {
  formatAttachedCalendarEventWhen,
  type VolunteerAttachedCalendarEvent,
} from '../../utils/volunteering';

type DirectCalendarEventChoice = VolunteerAttachedCalendarEvent;

type Props = {
  value: VolunteerAttachedCalendarEvent | null;
  onChange: (next: VolunteerAttachedCalendarEvent | null) => void;
};

export default function AttachCalendarEventField({ value, onChange }: Props) {
  const baseId = useId();
  const dateFieldId = `${baseId}-date`;
  const eventsLabelId = `${baseId}-events`;
  const [dialogOpen, setDialogOpen] = useState(false);
  const [date, setDate] = useState('');
  const [events, setEvents] = useState<DirectCalendarEventChoice[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!dialogOpen || !date) {
      setEvents([]);
      setLoading(false);
      setError(null);
      return;
    }
    let canceled = false;
    setLoading(true);
    setError(null);
    api
      .get<{ events: DirectCalendarEventChoice[] }>(
        `/volunteering/admin/direct-calendar-events?date=${encodeURIComponent(date)}`
      )
      .then((res) => {
        if (canceled) return;
        const next = res.data?.events ?? [];
        setEvents(next);
        setSelectedId((prev) => (prev && next.some((event) => event.id === prev) ? prev : null));
      })
      .catch((err) => {
        if (canceled) return;
        setEvents([]);
        setError(formatApiError(err, 'Could not load calendar events for that date.'));
      })
      .finally(() => {
        if (!canceled) setLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, [date, dialogOpen]);

  const eventOptions = useMemo(
    (): ChoiceOption<number>[] =>
      events.map((event) => ({
        value: event.id,
        label: event.title,
        description: formatAttachedCalendarEventWhen(event),
      })),
    [events]
  );

  const openDialog = () => {
    const initialDate = value ? formatDateInTimeZone(new Date(value.start)) ?? '' : '';
    setDate(initialDate);
    setSelectedId(value?.id ?? null);
    setEvents([]);
    setError(null);
    setDialogOpen(true);
  };

  const closeDialog = () => {
    setDialogOpen(false);
  };

  const attachSelected = () => {
    const selected = events.find((event) => event.id === selectedId);
    if (!selected) return;
    onChange(selected);
    setDialogOpen(false);
  };

  return (
    <>
      {value ? (
        <div className="space-y-3">
          <div>
            <p className="font-medium text-gray-900 dark:text-gray-100">{value.title}</p>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {formatAttachedCalendarEventWhen(value)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={openDialog}>
              Change
            </Button>
            <Button type="button" variant="secondary" onClick={() => onChange(null)}>
              Remove
            </Button>
          </div>
        </div>
      ) : (
        <Button type="button" variant="secondary" onClick={openDialog}>
          Attach calendar event
        </Button>
      )}

      <Modal
        isOpen={dialogOpen}
        onClose={closeDialog}
        title="Attach calendar event"
        size="md"
        verticalAlign="start"
      >
        <div className="space-y-4">
          <FormField
            label="Date"
            htmlFor={dateFieldId}
            required
            helperText="Shows free-form calendar events on this club date. Recurring events are attached for the whole series."
          >
            <input
              id={dateFieldId}
              type="date"
              className="app-input w-full"
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                setSelectedId(null);
              }}
              required
            />
          </FormField>

          {date && loading ? (
            <InlineStateMessage title="Loading events…" />
          ) : null}
          {date && error ? <InlineStateMessage title={error} tone="error" /> : null}
          {date && !loading && !error && events.length === 0 ? (
            <InlineStateMessage title="No free-form events on this date." />
          ) : null}
          {date && !loading && !error && events.length > 0 ? (
            <FormField label="Event" labelId={eventsLabelId} required>
              <ChoiceInput<number>
                layout="block"
                name={`${baseId}-event`}
                ariaLabelledBy={eventsLabelId}
                options={eventOptions}
                value={selectedId}
                onChange={(next) => setSelectedId(typeof next === 'number' ? next : null)}
              />
            </FormField>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={closeDialog}>
              Cancel
            </Button>
            <Button type="button" disabled={selectedId == null || loading} onClick={attachSelected}>
              Attach
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
