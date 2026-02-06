import { useEffect, useMemo, useState } from 'react';
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
  const minutes = minuteStr.padStart(2, '0');
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return `${displayHour}:${minutes} ${ampm}`;
};

export default function LeagueSheets({ leagueId }: LeagueSheetsProps) {
  const { showAlert } = useAlert();
  const [drawSlots, setDrawSlots] = useState<DrawSlot[]>([]);
  const [loadingDraws, setLoadingDraws] = useState(true);
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

  useEffect(() => {
    loadDrawSlots();
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

  const drawsWithCounts = useMemo(() => {
    return drawSlots.map((draw) => {
      const counts = draw.sheets.reduce(
        (acc, sheet) => {
          if (sheet.isAvailable) {
            acc.available += 1;
          } else {
            acc.unavailable += 1;
          }
          return acc;
        },
        { available: 0, unavailable: 0 }
      );
      return { draw, counts };
    });
  }, [drawSlots]);

  return (
    <div className="space-y-4">
      {loadingDraws ? (
        <div className="text-sm text-gray-500 dark:text-gray-400">Loading draw slots...</div>
      ) : drawSlots.length === 0 ? (
        <div className="text-sm text-gray-500 dark:text-gray-400">No draws configured yet.</div>
      ) : (
        <div className="space-y-3">
          {drawsWithCounts.map(({ draw, counts }) => (
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
                    {counts.available} available · {counts.unavailable} unavailable
                  </div>
                </div>
                <Button onClick={() => openAvailabilityModal(draw)} variant="secondary">
                  Edit sheets
                </Button>
              </div>
              <div className="flex flex-wrap gap-2 text-xs text-gray-600 dark:text-gray-400">
                {draw.sheets.map((sheet) => (
                  <span
                    key={sheet.id}
                    className={`rounded border px-2 py-1 ${
                      sheet.isAvailable
                        ? 'border-emerald-300 bg-emerald-100 text-emerald-800'
                        : 'border-rose-300 bg-rose-100 text-rose-800'
                    }`}
                  >
                    {sheet.name}
                  </span>
                ))}
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
