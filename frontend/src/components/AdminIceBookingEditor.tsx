/**
 * Calendar-admin editor for member ice bookings: change start/duration/sheet, or cancel.
 * Saves via PATCH /ice-bookings/:id; cancel via DELETE /ice-bookings/:id (staff path emails the booker).
 */

import { useEffect, useId, useMemo, useState } from 'react';
import axios from 'axios';
import Button from './Button';
import ChoiceInput, { type ChoiceOption } from './ChoiceInput';
import FormField from './FormField';
import Modal from './Modal';
import type { CalendarEvent } from '../pages/Calendar';
import { useAlert } from '../contexts/AlertContext';
import { useConfirm } from '../contexts/ConfirmContext';
import api, { formatApiError } from '../utils/api';

type DurationHours = 1 | 2;

type SheetOption = { id: number; name: string };

type AdminIceBookingEditorProps = {
  event: CalendarEvent;
  sheets: SheetOption[];
  onClose: () => void;
  onSaved: () => void;
  onCanceled: () => void;
};

const DURATION_OPTIONS: ChoiceOption<DurationHours>[] = [
  { value: 1, label: '1 hour' },
  { value: 2, label: '2 hours' },
];

export function parseIceBookingId(eventId: string): number | null {
  const match = /^ice-booking:(\d+)$/.exec(eventId);
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isFinite(id) ? id : null;
}

function toDatetimeLocalValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function durationHoursFromEvent(start: Date, end: Date): DurationHours {
  const hours = Math.round((end.getTime() - start.getTime()) / (60 * 60 * 1000));
  return hours === 2 ? 2 : 1;
}

function sheetIdFromEvent(event: CalendarEvent): number | null {
  const sheetLoc = event.locations?.find((loc) => loc.type === 'sheet' && loc.sheetId != null);
  return sheetLoc && sheetLoc.type === 'sheet' ? sheetLoc.sheetId : null;
}

export default function AdminIceBookingEditor({
  event,
  sheets,
  onClose,
  onSaved,
  onCanceled,
}: AdminIceBookingEditorProps) {
  const { showAlert } = useAlert();
  const { confirm } = useConfirm();
  const startFieldId = useId();
  const durationFieldId = useId();
  const sheetFieldId = useId();

  const bookingId = parseIceBookingId(event.id);
  const [startLocal, setStartLocal] = useState(() => toDatetimeLocalValue(event.start));
  const [durationHours, setDurationHours] = useState<DurationHours>(() =>
    durationHoursFromEvent(event.start, event.end)
  );
  const [sheetId, setSheetId] = useState<number | null>(() => sheetIdFromEvent(event));
  const [saving, setSaving] = useState(false);
  const [canceling, setCanceling] = useState(false);

  useEffect(() => {
    setStartLocal(toDatetimeLocalValue(event.start));
    setDurationHours(durationHoursFromEvent(event.start, event.end));
    setSheetId(sheetIdFromEvent(event));
  }, [event]);

  const sheetOptions = useMemo<ChoiceOption<number>[]>(
    () => sheets.map((s) => ({ value: s.id, label: `Sheet ${s.name}` })),
    [sheets]
  );

  if (bookingId == null) {
    return (
      <Modal isOpen onClose={onClose} title="Edit ice booking" size="md">
        <p className="text-sm text-gray-600 dark:text-gray-400">This booking could not be loaded.</p>
        <div className="mt-4 flex justify-end">
          <Button type="button" variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </Modal>
    );
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sheetId == null || !startLocal) {
      showAlert('Choose a start time and sheet.', 'warning');
      return;
    }
    setSaving(true);
    try {
      await api.patch(`/ice-bookings/${bookingId}`, {
        sheetId,
        start: new Date(startLocal).toISOString(),
        durationHours,
      });
      showAlert('Ice booking updated. The member was emailed.', 'success');
      onSaved();
    } catch (err: unknown) {
      const msg = axios.isAxiosError(err)
        ? (err.response?.data as { error?: string } | undefined)?.error
        : undefined;
      showAlert(msg || formatApiError(err, 'Could not update ice booking'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleCancelBooking = async () => {
    const go = await confirm({
      title: 'Cancel this ice booking?',
      message:
        'The sheet will be freed for that time, and the member who booked it will be emailed.',
      confirmText: 'Cancel booking',
      cancelText: 'Keep booking',
      variant: 'danger',
    });
    if (!go) return;

    setCanceling(true);
    try {
      await api.delete(`/ice-bookings/${bookingId}`);
      showAlert('Ice booking canceled. The member was emailed.', 'success');
      onCanceled();
    } catch (err: unknown) {
      showAlert(formatApiError(err, 'Could not cancel ice booking'), 'error');
    } finally {
      setCanceling(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title="Edit ice booking" size="md" verticalAlign="start">
      <form onSubmit={handleSave} className="space-y-5">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Booked by <span className="font-medium text-gray-900 dark:text-gray-100">{event.title}</span>
          . Changes are emailed to the member.
        </p>

        <FormField label="Start date and time" htmlFor={startFieldId} required>
          <input
            id={startFieldId}
            type="datetime-local"
            value={startLocal}
            onChange={(e) => setStartLocal(e.target.value)}
            className="app-input"
            required
          />
        </FormField>

        <FormField label="Duration" labelId={durationFieldId} required>
          <ChoiceInput<DurationHours>
            layout="inline"
            name="admin-ice-duration"
            ariaLabelledBy={durationFieldId}
            options={DURATION_OPTIONS}
            value={durationHours}
            onChange={(next) => {
              if (next === 1 || next === 2) setDurationHours(next);
            }}
          />
        </FormField>

        <FormField label="Sheet" labelId={sheetFieldId} required>
          {sheets.length === 0 ? (
            <p className="text-sm text-amber-700 dark:text-amber-300">No sheets are available.</p>
          ) : (
            <ChoiceInput<number>
              layout="inline"
              name="admin-ice-sheet"
              ariaLabelledBy={sheetFieldId}
              options={sheetOptions}
              value={sheetId}
              onChange={(next) => {
                if (typeof next === 'number') setSheetId(next);
              }}
            />
          )}
        </FormField>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          <Button
            type="button"
            variant="danger"
            disabled={saving || canceling}
            onClick={() => void handleCancelBooking()}
          >
            {canceling ? 'Canceling…' : 'Cancel booking'}
          </Button>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={onClose} disabled={saving || canceling}>
              Close
            </Button>
            <Button type="submit" variant="primary" disabled={saving || canceling || sheetId == null}>
              {saving ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
