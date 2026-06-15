import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import Button from '../components/Button';
import { AppPage, AppPageHeader } from '../components/AppPage';
import { useAuth } from '../contexts/AuthContext';
import { useAlert } from '../contexts/AlertContext';
import api from '../utils/api';
import { formatApiError } from '../utils/api';
import ChoiceInput, { type ChoiceOption } from '../components/ChoiceInput';

type PurposeOption = { value: Purpose; label: string };

type Sheet = { id: number; name: string; isActive?: boolean };

type Purpose = 'practice' | 'makeup_game' | 'guests_new' | 'guests_experienced' | 'other';

function toDatetimeLocalValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const PURPOSE_OPTIONS: PurposeOption[] = [
  { value: 'practice', label: 'Practice' },
  { value: 'makeup_game', label: 'Make-up game' },
  { value: 'guests_new', label: 'Bringing guests: new curlers' },
  { value: 'guests_experienced', label: 'Bringing guests: experienced' },
  { value: 'other', label: 'Other' },
];

function isGuestPurpose(p: Purpose): p is 'guests_new' | 'guests_experienced' {
  return p === 'guests_new' || p === 'guests_experienced';
}

export default function BookIceTime() {
  const { member } = useAuth();
  const { showAlert } = useAlert();
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [sheetsLoading, setSheetsLoading] = useState(true);
  const [sheetId, setSheetId] = useState('');
  const [startLocal, setStartLocal] = useState(() => {
    const d = new Date();
    d.setMinutes(0, 0, 0);
    d.setHours(d.getHours() + 1);
    return toDatetimeLocalValue(d);
  });
  const [durationHours, setDurationHours] = useState<1 | 2>(1);
  const [purpose, setPurpose] = useState<Purpose>('practice');
  const [purposeOther, setPurposeOther] = useState('');
  const [guestNames, setGuestNames] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [step, setStep] = useState<'form' | 'done'>('form');
  const [confirmedSummary, setConfirmedSummary] = useState<{
    sheetName: string;
    start: string;
    end: string;
    purpose: Purpose;
    purposeOther?: string;
    guestNames?: string;
  } | null>(null);

  const minLocal = useMemo(() => toDatetimeLocalValue(new Date()), []);
  const sheetOptions = useMemo<ChoiceOption<number>[]>(
    () => sheets.map((s) => ({ value: s.id, label: s.name })),
    [sheets]
  );
  const maxLocal = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return toDatetimeLocalValue(d);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setSheetsLoading(true);
    api
      .get<Sheet[]>('/sheets')
      .then((res) => {
        if (!cancelled) {
          const active = (res.data ?? []).filter((s) => s.isActive !== false);
          setSheets(active);
          if (active.length > 0 && !sheetId) {
            setSheetId(String(active[0].id));
          }
        }
      })
      .catch(() => {
        if (!cancelled) setSheets([]);
      })
      .finally(() => {
        if (!cancelled) setSheetsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const resetForm = () => {
    setStep('form');
    setConfirmedSummary(null);
    setGuestNames('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (member?.socialMember) return;

    if (!sheetId || !startLocal) {
      showAlert('Choose a sheet and start time.', 'warning');
      return;
    }
    if (purpose === 'other' && !purposeOther.trim()) {
      showAlert('Please describe your purpose.', 'warning');
      return;
    }
    if (isGuestPurpose(purpose) && !guestNames.trim()) {
      showAlert('Guest names are required when bringing guests.', 'warning');
      return;
    }

    const startIso = new Date(startLocal).toISOString();
    setSubmitting(true);
    try {
      const { data } = await api.post<{
        id: number;
        sheetName: string;
        start: string;
        end: string;
        purpose: Purpose;
        purposeOther?: string;
        guestNames?: string;
      }>('/ice-bookings', {
        sheetId: Number(sheetId),
        start: startIso,
        durationHours,
        purpose,
        purposeOther: purpose === 'other' ? purposeOther.trim() : undefined,
        guestNames: isGuestPurpose(purpose) ? guestNames.trim() : undefined,
      });
      setConfirmedSummary({
        sheetName: data.sheetName,
        start: data.start,
        end: data.end,
        purpose: data.purpose,
        purposeOther: data.purposeOther,
        guestNames: data.guestNames,
      });
      setStep('done');
    } catch (err: unknown) {
      const msg = axios.isAxiosError(err)
        ? (err.response?.data as { error?: string } | undefined)?.error
        : undefined;
      showAlert(msg || formatApiError(err, 'Could not complete booking'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  if (member?.socialMember) {
    return (
      <>
        <AppPage narrow>
          <AppPageHeader title="Book ice time" />
          <div className="app-card">
            <p className="app-page-subtitle">
              Social memberships do not include ice booking. Upgrade to a full membership to reserve practice ice.
            </p>
            <Link to="/calendar" className="mt-5 inline-flex text-sm font-medium text-primary-teal hover:underline">
              View full calendar
            </Link>
          </div>
        </AppPage>
      </>
    );
  }

  if (step === 'done' && confirmedSummary) {
    const purposeLabel =
      PURPOSE_OPTIONS.find((p) => p.value === confirmedSummary.purpose)?.label ?? confirmedSummary.purpose;
    return (
      <>
        <AppPage narrow>
          <div className="app-card">
            <AppPageHeader
              title="You're booked"
              description={`We sent a confirmation email${member?.email ? ` to ${member.email}` : ''}. Please remember:`}
            />
            <ul className="list-disc pl-5 space-y-2 text-gray-800 dark:text-gray-200 mb-6">
              <li>At least one other person must be on premises with you. You may not use the ice alone.</li>
              <li>Do not enter the ice maintenance room without proper training.</li>
              <li>Any guests must sign a waiver before entering the ice shed.</li>
              <li>
                Clean up properly after you are done (sweep and cover hacks, mop sheet, return stones).
              </li>
            </ul>
            <div className="rounded-lg bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 p-4 text-sm text-gray-700 dark:text-gray-300 space-y-1">
              <p>
                <span className="font-medium text-gray-900 dark:text-gray-100">When: </span>
                {new Date(confirmedSummary.start).toLocaleString(undefined, {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric',
                  hour: 'numeric',
                  minute: '2-digit',
                })}{' '}
                –{' '}
                {new Date(confirmedSummary.end).toLocaleTimeString(undefined, {
                  hour: 'numeric',
                  minute: '2-digit',
                })}
              </p>
              <p>
                <span className="font-medium text-gray-900 dark:text-gray-100">Sheet: </span>
                {confirmedSummary.sheetName}
              </p>
              <p>
                <span className="font-medium text-gray-900 dark:text-gray-100">Purpose: </span>
                {purposeLabel}
                {confirmedSummary.purpose === 'other' && confirmedSummary.purposeOther
                  ? ` — ${confirmedSummary.purposeOther}`
                  : ''}
              </p>
              {isGuestPurpose(confirmedSummary.purpose) && confirmedSummary.guestNames && (
                <p>
                  <span className="font-medium text-gray-900 dark:text-gray-100">Guests: </span>
                  {confirmedSummary.guestNames}
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-3 mt-8">
              <Link
                to="/dashboard"
                className="px-4 py-2 rounded-md font-medium transition-colors inline-flex items-center justify-center bg-primary-teal text-white hover:bg-opacity-90"
              >
                Back to dashboard
              </Link>
              <Button type="button" variant="secondary" onClick={resetForm}>
                Book another slot
              </Button>
            </div>
          </div>
        </AppPage>
      </>
    );
  }

  return (
    <>
      <AppPage narrow>
        <AppPageHeader
          title="Book ice time"
          description={
            <>
              Reserve 1 or 2 hours on one sheet, up to 7 days ahead. Your sheet must be available according to the{' '}
              <Link to="/calendar" className="text-primary-teal hover:underline">
                club calendar
              </Link>
              .
            </>
          }
        />

        <form onSubmit={handleSubmit} className="app-card space-y-5">
          <div>
            <label htmlFor="ice-sheet" className="app-label">
              Sheet
            </label>
            {sheetsLoading ? (
              <p className="text-sm text-gray-500">Loading sheets…</p>
            ) : sheets.length === 0 ? (
              <p className="text-sm text-amber-700 dark:text-amber-300">No active sheets are configured.</p>
            ) : (
              <ChoiceInput<number>
                inputId="ice-sheet"
                options={sheetOptions}
                value={sheetId === '' ? null : Number(sheetId)}
                onChange={(next) => {
                  if (next != null && !Array.isArray(next)) setSheetId(String(next));
                }}
                placeholder="Select a sheet"
                listboxLabel="Sheet"
                required
              />
            )}
          </div>

          <div>
            <label htmlFor="ice-start" className="app-label">
              Start date and time
            </label>
            <input
              id="ice-start"
              type="datetime-local"
              value={startLocal}
              min={minLocal}
              max={maxLocal}
              onChange={(e) => setStartLocal(e.target.value)}
              className="app-input"
              required
            />
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Bookings must start within the next 7 days.
            </p>
          </div>

          <fieldset>
            <legend className="app-label">Duration</legend>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-gray-800 dark:text-gray-200">
                <input
                  type="radio"
                  name="duration"
                  checked={durationHours === 1}
                  onChange={() => setDurationHours(1)}
                />
                1 hour
              </label>
              <label className="flex items-center gap-2 text-gray-800 dark:text-gray-200">
                <input
                  type="radio"
                  name="duration"
                  checked={durationHours === 2}
                  onChange={() => setDurationHours(2)}
                />
                2 hours
              </label>
            </div>
          </fieldset>

          <fieldset>
            <legend className="app-label">Purpose</legend>
            <div className="space-y-2">
              {PURPOSE_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  className="flex items-center gap-2 text-gray-800 dark:text-gray-200 cursor-pointer"
                >
                  <input
                    type="radio"
                    name="purpose"
                    value={opt.value}
                    checked={purpose === opt.value}
                    onChange={() => setPurpose(opt.value)}
                  />
                  {opt.label}
                </label>
              ))}
            </div>
            {purpose === 'guests_new' && (
              <div className="mt-3 text-sm text-gray-700 dark:text-gray-300 rounded-md bg-sky-50 dark:bg-sky-950/40 border border-sky-200 dark:border-sky-800 px-3 py-3 space-y-2">
                <p>
                  Please read the{' '}
                  <a
                    href="https://links.tccnc.club/guests"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary-teal font-medium hover:underline"
                  >
                    guest policy
                  </a>{' '}
                  before bringing guests. Each member may provide private learn-to-curl instruction for up to four
                  guests per curling season. Ensure that all guests{' '}
                  <a
                    href="https://links.tccnc.club/waiver"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary-teal font-medium hover:underline"
                  >
                    sign a waiver
                  </a>{' '}
                  before entering the ice shed.
                </p>
              </div>
            )}
            {purpose === 'guests_experienced' && (
              <div className="mt-3 text-sm text-gray-700 dark:text-gray-300 rounded-md bg-sky-50 dark:bg-sky-950/40 border border-sky-200 dark:border-sky-800 px-3 py-3 space-y-2">
                <p>
                  Please read the{' '}
                  <a
                    href="https://links.tccnc.club/guests"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary-teal font-medium hover:underline"
                  >
                    guest policy
                  </a>{' '}
                  before bringing guests. Members may host up to two simultaneous guests who are experienced curlers.
                  Ensure that all guests{' '}
                  <a
                    href="https://links.tccnc.club/waiver"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary-teal font-medium hover:underline"
                  >
                    sign a waiver
                  </a>{' '}
                  before entering the ice shed.
                </p>
              </div>
            )}
            {isGuestPurpose(purpose) && (
              <div className="mt-3">
                <label
                  htmlFor="guest-names"
                  className="app-label"
                >
                  Guest names <span className="text-red-600 dark:text-red-400">*</span>
                </label>
                <textarea
                  id="guest-names"
                  value={guestNames}
                  onChange={(e) => setGuestNames(e.target.value)}
                  rows={2}
                  placeholder="List everyone who will be on the ice as your guests"
                  className="app-input"
                  required
                  aria-required="true"
                />
              </div>
            )}
            {purpose === 'other' && (
              <div className="mt-3">
                <label htmlFor="purpose-other" className="sr-only">
                  Describe purpose
                </label>
                <textarea
                  id="purpose-other"
                  value={purposeOther}
                  onChange={(e) => setPurposeOther(e.target.value)}
                  rows={3}
                  placeholder={"Briefly describe what you're using the ice for"}
                  className="app-input"
                  required
                />
              </div>
            )}
          </fieldset>

          <div className="flex flex-wrap gap-3 pt-2">
            <Button type="submit" variant="primary" disabled={submitting || sheets.length === 0}>
              {submitting ? 'Booking…' : 'Book now'}
            </Button>
            <Link
              to="/calendar"
              className="px-4 py-2 rounded-md font-medium transition-colors inline-flex items-center justify-center bg-gray-200 text-gray-800 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-100 dark:hover:bg-gray-600"
            >
              Cancel
            </Link>
          </div>
        </form>
      </AppPage>
    </>
  );
}
