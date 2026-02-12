import { useEffect, useMemo, useState } from 'react';
import { HiCalendarDays, HiCheckCircle, HiXCircle } from 'react-icons/hi2';
import { get, put } from '../../api/client';
import { formatApiError } from '../../utils/api';
import { useAlert } from '../../contexts/AlertContext';
import Button from '../../components/Button';
import Modal from '../../components/Modal';

interface DrawSheet {
  id: number;
  name: string;
  isAvailable: boolean;
}

interface DrawSlot {
  date: string;
  time: string;
  isExtra: boolean;
  extraDrawId: number | null;
  sheets: DrawSheet[];
}

interface LeagueSheetsProps {
  leagueId: number;
}

const formatDateDisplay = (dateString: string) => {
  if (!dateString) return '';
  const date = new Date(dateString);
  const userTimezoneOffset = date.getTimezoneOffset() * 60000;
  const adjustedDate = new Date(date.getTime() + userTimezoneOffset);
  return adjustedDate.toLocaleDateString();
};

const formatTime = (time: string) => {
  if (!time) return '';
  const [hourStr, minuteStr] = time.split(':');
  const hour = parseInt(hourStr, 10);
  const minutes = (minuteStr ?? '00').padStart(2, '0');
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return `${displayHour}:${minutes} ${ampm}`;
};

/** Normalize time to "HH:MM" for matching with draw slot time. */
const normalizeTime = (time: string | null) => {
  if (!time) return '';
  const parts = time.split(':');
  return `${parts[0] ?? ''}:${(parts[1] ?? '00').padStart(2, '0')}`.slice(0, 5);
};

interface LeagueGame {
  gameDate: string | null;
  gameTime: string | null;
  sheetId: number | null;
  status: string;
}

export default function LeagueSheets({ leagueId }: LeagueSheetsProps) {
  const { showAlert } = useAlert();
  const [drawSlots, setDrawSlots] = useState<DrawSlot[]>([]);
  const [games, setGames] = useState<LeagueGame[]>([]);
  const [loadingDraws, setLoadingDraws] = useState(true);
  const [loadingGames, setLoadingGames] = useState(true);
  const [availabilityModalOpen, setAvailabilityModalOpen] = useState(false);
  const [selectedDraw, setSelectedDraw] = useState<DrawSlot | null>(null);
  const [availabilitySelections, setAvailabilitySelections] = useState<Record<number, boolean>>({});
  const [availabilitySaving, setAvailabilitySaving] = useState(false);

  const loadDrawSlots = async () => {
    setLoadingDraws(true);
    try {
      const response = await get('/leagues/{id}/draw-slots', undefined, { id: String(leagueId) });
      setDrawSlots(response);
    } catch (error: unknown) {
      console.error('Failed to load draw slots:', error);
      showAlert(formatApiError(error, 'Failed to load draw slots'), 'error');
    } finally {
      setLoadingDraws(false);
    }
  };

  const loadGames = async () => {
    setLoadingGames(true);
    try {
      const response = await get('/leagues/{id}/games', { includeUnscheduled: true }, { id: String(leagueId) });
      setGames((response as LeagueGame[]) ?? []);
    } catch (error: unknown) {
      console.error('Failed to load games:', error);
      showAlert(formatApiError(error, 'Failed to load games'), 'error');
    } finally {
      setLoadingGames(false);
    }
  };

  useEffect(() => {
    loadDrawSlots();
    loadGames();
  }, [leagueId]);

  const openAvailabilityModal = (draw: DrawSlot) => {
    const selections: Record<number, boolean> = {};
    draw.sheets.forEach((sheet) => {
      selections[sheet.id] = sheet.isAvailable;
    });
    setSelectedDraw(draw);
    setAvailabilitySelections(selections);
    setAvailabilityModalOpen(true);
  };

  const closeAvailabilityModal = () => {
    setAvailabilityModalOpen(false);
    setSelectedDraw(null);
    setAvailabilitySelections({});
  };

  const handleSaveAvailability = async () => {
    if (!selectedDraw) return;
    setAvailabilitySaving(true);
    try {
      const payload = {
        date: selectedDraw.date,
        time: selectedDraw.time,
        sheets: Object.entries(availabilitySelections).map(([sheetId, isAvailable]) => ({
          sheetId: Number(sheetId),
          isAvailable,
        })),
      };
      await put('/leagues/{id}/draws/availability', payload, { id: String(leagueId) });
      await loadDrawSlots();
      closeAvailabilityModal();
    } catch (error: unknown) {
      console.error('Failed to update availability:', error);
      showAlert(formatApiError(error, 'Failed to update availability'), 'error');
    } finally {
      setAvailabilitySaving(false);
    }
  };

  const scheduledByDrawSheet = useMemo(() => {
    const set = new Set<string>();
    for (const g of games) {
      if (g.status === 'scheduled' && g.gameDate && g.gameTime != null && g.sheetId != null) {
        set.add(`${g.gameDate}|${normalizeTime(g.gameTime)}|${g.sheetId}`);
      }
    }
    return set;
  }, [games]);

  const drawsWithCounts = useMemo(() => {
    return drawSlots.map((draw) => {
      const drawTimeKey = normalizeTime(draw.time);
      let scheduled = 0;
      let available = 0;
      let unavailable = 0;
      const scheduledSheetIds = new Set<number>();
      for (const sheet of draw.sheets) {
        const hasGame = scheduledByDrawSheet.has(`${draw.date}|${drawTimeKey}|${sheet.id}`);
        if (hasGame) {
          scheduled += 1;
          scheduledSheetIds.add(sheet.id);
        } else if (sheet.isAvailable) {
          available += 1;
        } else {
          unavailable += 1;
        }
      }
      const total = draw.sheets.length;
      let message: string;
      if (scheduled === total && total > 0) {
        message = 'All sheets scheduled';
      } else if (unavailable === 0 && scheduled === 0) {
        message = 'All sheets available';
      } else {
        const parts: string[] = [];
        if (scheduled > 0) parts.push(`${scheduled} sheet${scheduled === 1 ? '' : 's'} scheduled`);
        if (available > 0) parts.push(`${available} sheet${available === 1 ? '' : 's'} available`);
        if (unavailable > 0) parts.push(`${unavailable} sheet${unavailable === 1 ? '' : 's'} unavailable`);
        message = parts.join(' · ');
      }
      return { draw, scheduled, available, unavailable, message, scheduledSheetIds };
    });
  }, [drawSlots, scheduledByDrawSheet]);

  const loading = loadingDraws || loadingGames;

  return (
    <div className="space-y-4">
      {loading ? (
        <div className="text-sm text-gray-500 dark:text-gray-400">Loading...</div>
      ) : drawSlots.length === 0 ? (
        <div className="text-sm text-gray-500 dark:text-gray-400">No draws configured yet.</div>
      ) : (
        <div className="space-y-3">
          {drawsWithCounts.map(({ draw, message, scheduledSheetIds }) => (
            <div
              key={`${draw.date}-${draw.time}`}
              className="flex flex-col gap-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-medium text-gray-800 dark:text-gray-200">
                    {formatDateDisplay(draw.date)} · {formatTime(draw.time)}
                    {draw.isExtra && (
                      <span className="ml-2 rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-700">
                        Extra
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-gray-600 dark:text-gray-400">
                    {message}
                  </div>
                </div>
                <Button onClick={() => openAvailabilityModal(draw)} variant="secondary">
                  Edit sheets
                </Button>
              </div>
              <div className="flex flex-wrap gap-3 text-sm text-gray-600 dark:text-gray-400">
                {draw.sheets.map((sheet) => {
                  const hasGame = scheduledSheetIds.has(sheet.id);
                  const status = hasGame
                    ? 'Game scheduled'
                    : sheet.isAvailable
                      ? 'Available'
                      : 'Unavailable';
                  const Icon = hasGame
                    ? HiCalendarDays
                    : sheet.isAvailable
                      ? HiCheckCircle
                      : HiXCircle;
                  return (
                    <span
                      key={sheet.id}
                      title={`${sheet.name} · ${status}`}
                      aria-label={`${sheet.name}, ${status}`}
                      className={`inline-flex items-center gap-2 rounded-lg border px-4 py-2.5 ${
                        hasGame
                          ? 'border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-600 dark:bg-amber-900/30 dark:text-amber-200'
                          : sheet.isAvailable
                            ? 'border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-200'
                            : 'border-rose-300 bg-rose-100 text-rose-800 dark:border-rose-600 dark:bg-rose-900/30 dark:text-rose-200'
                      }`}
                    >
                      <Icon className="h-6 w-6 flex-shrink-0" aria-hidden />
                      {sheet.name}
                    </span>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        isOpen={availabilityModalOpen}
        onClose={closeAvailabilityModal}
        title="Draw sheet availability"
      >
        <div className="space-y-4">
          <div className="text-sm text-gray-600 dark:text-gray-400">
            {selectedDraw
              ? `${formatDateDisplay(selectedDraw.date)} · ${formatTime(selectedDraw.time)}`
              : ''}
          </div>
          <div className="space-y-2">
            {selectedDraw?.sheets.map((sheet) => (
              <label key={sheet.id} className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                <input
                  type="checkbox"
                  checked={availabilitySelections[sheet.id] ?? true}
                  onChange={(event) =>
                    setAvailabilitySelections((prev) => ({
                      ...prev,
                      [sheet.id]: event.target.checked,
                    }))
                  }
                  className="rounded border-gray-300 text-primary-teal focus:ring-primary-teal"
                />
                {sheet.name}
              </label>
            ))}
          </div>
          <div className="flex gap-3">
            <Button onClick={handleSaveAvailability} disabled={availabilitySaving} className="flex-1">
              {availabilitySaving ? 'Saving...' : 'Save'}
            </Button>
            <Button variant="secondary" onClick={closeAvailabilityModal} className="flex-1">
              Cancel
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
