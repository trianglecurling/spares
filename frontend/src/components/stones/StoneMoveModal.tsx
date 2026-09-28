import { useId, useMemo, useState, type FormEvent } from 'react';
import { post } from '../../api/client';
import { useAlert } from '../../contexts/AlertContext';
import { formatApiError } from '../../utils/api';
import {
  formatStoneDate,
  samePosition,
  stonePositionKey,
  stonePositionLabel,
  stonesByPosition,
  todayInClub,
  UNASSIGNED_POSITION,
  type StoneDetailResponse,
  type StonePosition,
  type StoneSummary,
} from '../../utils/curlingStones';
import Button from '../Button';
import FormField from '../FormField';
import InlineStateMessage from '../InlineStateMessage';
import Modal from '../Modal';
import StonePositionFields from './StonePositionFields';

type StoneMoveModalProps = {
  stone: StoneSummary;
  stones: StoneSummary[];
  onClose: () => void;
  onSaved: (detail: StoneDetailResponse) => void;
  initialTarget?: StonePosition;
};

export default function StoneMoveModal({ stone, stones, onClose, onSaved, initialTarget }: StoneMoveModalProps) {
  const formId = useId();
  const { showAlert } = useAlert();
  const origin: StonePosition = stone.current ?? UNASSIGNED_POSITION;
  const [target, setTarget] = useState<StonePosition>(initialTarget ?? origin);
  const [effectiveDate, setEffectiveDate] = useState(todayInClub());
  const [notes, setNotes] = useState('');
  const [dateError, setDateError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const occupants = useMemo(() => stonesByPosition(stones), [stones]);

  const unchanged = samePosition(origin, target);
  const targetKey = stonePositionKey(target);
  const occupant = targetKey ? occupants.get(targetKey) : undefined;
  const swapPartner = occupant && occupant.id !== stone.id ? occupant : undefined;
  const minDate = [stone.current?.effectiveDate, swapPartner?.current?.effectiveDate]
    .filter((value): value is string => Boolean(value))
    .sort()
    .pop();

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (unchanged) return;
    if (!effectiveDate) {
      setDateError('Choose the date of this move.');
      return;
    }
    if (minDate && effectiveDate < minDate) {
      setDateError(`Choose ${formatStoneDate(minDate)} or later, when these stones last changed position.`);
      return;
    }
    setDateError(null);
    setSubmitting(true);
    try {
      const detail = await post(
        '/stones/{id}/move',
        { ...target, effectiveDate, notes: notes.trim() || null },
        { id: String(stone.id) },
      );
      showAlert(swapPartner ? 'Stones swapped' : 'Stone moved', 'success');
      onSaved(detail);
    } catch (error) {
      showAlert(formatApiError(error, 'Failed to move stone'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={`Move stone ${stone.wcfRegistrationNumber}`} size="lg">
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Currently at <span className="font-medium">{stonePositionLabel(origin)}</span>. Choose where it goes next.
        </p>

        <StonePositionFields
          idPrefix={`${formId}-target`}
          value={target}
          onChange={setTarget}
          occupants={occupants}
          currentStoneId={stone.id}
        />

        {unchanged ? (
          <InlineStateMessage title="Choose a different position to move this stone." />
        ) : swapPartner ? (
          <InlineStateMessage
            tone="warning"
            title={`Stone ${swapPartner.wcfRegistrationNumber} is at ${stonePositionLabel(target)}.`}
            description={
              origin.color == null
                ? `The stones will trade places, so stone ${swapPartner.wcfRegistrationNumber} will become unassigned.`
                : `The stones will trade places, so stone ${swapPartner.wcfRegistrationNumber} will move to ${stonePositionLabel(origin)}.`
            }
          />
        ) : null}

        <FormField label="Date" htmlFor={`${formId}-date`} required error={dateError}>
          {({ describedBy, invalid }) => (
            <input
              id={`${formId}-date`}
              type="date"
              className="app-input max-w-xs"
              value={effectiveDate}
              min={minDate}
              onChange={(e) => setEffectiveDate(e.target.value)}
              aria-describedby={describedBy}
              aria-invalid={invalid}
            />
          )}
        </FormField>

        <FormField label="Notes" htmlFor={`${formId}-notes`} optional>
          <textarea
            id={`${formId}-notes`}
            className="app-input min-h-[4rem]"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={2000}
          />
        </FormField>

        <div className="flex gap-3">
          <Button type="submit" disabled={submitting || unchanged} className="flex-1">
            {submitting ? 'Saving...' : swapPartner ? 'Swap stones' : 'Move stone'}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose} disabled={submitting} className="flex-1">
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  );
}
