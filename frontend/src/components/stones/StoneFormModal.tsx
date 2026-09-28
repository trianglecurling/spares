import { useId, useMemo, useState, type FormEvent } from 'react';
import { patch, post } from '../../api/client';
import { useAlert } from '../../contexts/AlertContext';
import { formatApiError } from '../../utils/api';
import {
  stonePositionKey,
  stonePositionLabel,
  stonesByPosition,
  todayInClub,
  UNASSIGNED_POSITION,
  type StoneDetailResponse,
  type StonePosition,
  type StoneSide,
  type StoneSummary,
} from '../../utils/curlingStones';
import Button from '../Button';
import FormField from '../FormField';
import Modal from '../Modal';
import StonePositionFields, { StoneSideField } from './StonePositionFields';

type StoneFormModalProps = {
  onClose: () => void;
  onSaved: (detail: StoneDetailResponse) => void;
  stones: StoneSummary[];
  /** Edit an existing stone's identifiers and notes. Omit to add a new stone. */
  stone?: StoneSummary;
  initialPosition?: StonePosition;
};

type FieldErrors = Partial<Record<'wcf' | 'al' | 'position' | 'effectiveDate', string>>;

export default function StoneFormModal({ onClose, onSaved, stones, stone, initialPosition }: StoneFormModalProps) {
  const formId = useId();
  const { showAlert } = useAlert();
  const isEdit = Boolean(stone);
  const [wcf, setWcf] = useState(stone?.wcfRegistrationNumber ?? '');
  const [al, setAl] = useState(stone?.alSerialNumber ?? '');
  const [notes, setNotes] = useState(stone?.notes ?? '');
  const [position, setPosition] = useState<StonePosition>(initialPosition ?? UNASSIGNED_POSITION);
  const [side, setSide] = useState<StoneSide>('A');
  const [effectiveDate, setEffectiveDate] = useState(todayInClub());
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const occupants = useMemo(() => stonesByPosition(stones), [stones]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const nextErrors: FieldErrors = {};
    if (!wcf.trim()) nextErrors.wcf = 'Enter the WCF registration number.';
    if (!al.trim()) nextErrors.al = 'Enter the AL serial number.';
    if (!isEdit) {
      const key = stonePositionKey(position);
      const occupant = key ? occupants.get(key) : undefined;
      if (occupant) {
        nextErrors.position = `${stonePositionLabel(position)} already has stone ${occupant.wcfRegistrationNumber}. Choose an empty position, or add this stone as unassigned and then move it.`;
      }
      if (!effectiveDate) nextErrors.effectiveDate = 'Choose the date this stone entered service.';
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setSubmitting(true);
    try {
      const detail = stone
        ? await patch(
            '/stones/{id}',
            { wcfRegistrationNumber: wcf.trim(), alSerialNumber: al.trim(), notes: notes.trim() || null },
            { id: String(stone.id) },
          )
        : await post('/stones', {
            wcfRegistrationNumber: wcf.trim(),
            alSerialNumber: al.trim(),
            notes: notes.trim() || null,
            ...position,
            side,
            effectiveDate,
          });
      showAlert(isEdit ? 'Stone updated' : 'Stone added', 'success');
      onSaved(detail);
    } catch (error) {
      showAlert(formatApiError(error, isEdit ? 'Failed to update stone' : 'Failed to add stone'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={isEdit ? 'Edit stone' : 'Add stone'} size="lg">
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="WCF registration number" htmlFor={`${formId}-wcf`} required error={errors.wcf}>
            {({ describedBy, invalid }) => (
              <input
                id={`${formId}-wcf`}
                type="text"
                className="app-input"
                value={wcf}
                onChange={(e) => setWcf(e.target.value)}
                aria-describedby={describedBy}
                aria-invalid={invalid}
                autoComplete="off"
                maxLength={100}
              />
            )}
          </FormField>
          <FormField label="AL serial number" htmlFor={`${formId}-al`} required error={errors.al}>
            {({ describedBy, invalid }) => (
              <input
                id={`${formId}-al`}
                type="text"
                className="app-input"
                value={al}
                onChange={(e) => setAl(e.target.value)}
                aria-describedby={describedBy}
                aria-invalid={invalid}
                autoComplete="off"
                maxLength={100}
              />
            )}
          </FormField>
        </div>

        {!isEdit ? (
          <>
            <StonePositionFields
              idPrefix={`${formId}-position`}
              value={position}
              onChange={(next) => {
                setPosition(next);
                if (errors.position) setErrors((prev) => ({ ...prev, position: undefined }));
              }}
              occupants={occupants}
            />
            {errors.position ? (
              <p className="text-sm text-red-700 dark:text-red-300" role="alert">
                {errors.position}
              </p>
            ) : null}
            <div className="grid gap-4 sm:grid-cols-2">
              <StoneSideField idPrefix={formId} label="Side in play" value={side} onChange={setSide} />
              <FormField
                label="In service since"
                htmlFor={`${formId}-date`}
                required
                error={errors.effectiveDate}
              >
                {({ describedBy, invalid }) => (
                  <input
                    id={`${formId}-date`}
                    type="date"
                    className="app-input"
                    value={effectiveDate}
                    onChange={(e) => setEffectiveDate(e.target.value)}
                    aria-describedby={describedBy}
                    aria-invalid={invalid}
                  />
                )}
              </FormField>
            </div>
          </>
        ) : null}

        <FormField label="Notes" htmlFor={`${formId}-notes`} optional>
          <textarea
            id={`${formId}-notes`}
            className="app-input min-h-[5rem]"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={2000}
          />
        </FormField>

        <div className="flex gap-3">
          <Button type="submit" disabled={submitting} className="flex-1">
            {submitting ? 'Saving...' : isEdit ? 'Save' : 'Add stone'}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose} disabled={submitting} className="flex-1">
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  );
}
