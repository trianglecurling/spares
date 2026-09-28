import { useId, useState, type FormEvent } from 'react';
import { patch, post } from '../../api/client';
import { useAlert } from '../../contexts/AlertContext';
import { formatApiError } from '../../utils/api';
import {
  MAINTENANCE_ACTIVITY_LABELS,
  STONE_SHEETS,
  parseOptionalDecimal,
  parseOptionalInteger,
  stonePositionLabel,
  todayInClub,
  type MaintenanceActivityType,
  type StoneMaintenance,
  type StoneSide,
  type StoneSummary,
} from '../../utils/curlingStones';
import Button from '../Button';
import ChoiceInput from '../ChoiceInput';
import FormField from '../FormField';
import Modal from '../Modal';
import { StoneSideField } from './StonePositionFields';

type SideChoice = StoneSide | 'current';

type StoneMaintenanceModalProps = {
  stones: StoneSummary[];
  onClose: () => void;
  onSaved: () => void;
  initialStoneIds?: number[];
  /** Hide the stone picker (used on a single stone's page). */
  lockStones?: boolean;
  /** Edit an existing record instead of creating new ones. */
  record?: StoneMaintenance;
};

type FieldErrors = Partial<
  Record<'stones' | 'performedOn' | 'passes' | 'rotations' | 'sandpaperGrit' | 'bandWidths', string>
>;

const ACTIVITY_OPTIONS = (Object.keys(MAINTENANCE_ACTIVITY_LABELS) as MaintenanceActivityType[]).map((value) => ({
  value,
  label: MAINTENANCE_ACTIVITY_LABELS[value],
  textValue: MAINTENANCE_ACTIVITY_LABELS[value],
}));

function stoneOptionLabel(stone: StoneSummary): string {
  return `${stone.wcfRegistrationNumber} · ${stonePositionLabel(stone.current)}`;
}

export default function StoneMaintenanceModal({
  stones,
  onClose,
  onSaved,
  initialStoneIds = [],
  lockStones = false,
  record,
}: StoneMaintenanceModalProps) {
  const formId = useId();
  const { showAlert } = useAlert();
  const isEdit = Boolean(record);
  const [activityType, setActivityType] = useState<MaintenanceActivityType>(record?.activityType ?? 'texturing');
  const [stoneIds, setStoneIds] = useState<number[]>(record ? [record.stoneId] : initialStoneIds);
  const [side, setSide] = useState<SideChoice>(record?.side ?? 'current');
  const [performedOn, setPerformedOn] = useState(record?.performedOn ?? todayInClub());
  const [passes, setPasses] = useState(record?.passes != null ? String(record.passes) : '');
  const [rotations, setRotations] = useState(record?.rotations != null ? String(record.rotations) : '');
  const [grit, setGrit] = useState(record?.sandpaperGrit != null ? String(record.sandpaperGrit) : '');
  const [widths, setWidths] = useState<string[]>(
    record?.activityType === 'imprinting'
      ? record.bandWidthsMm.map((value) => (value == null ? '' : String(value)))
      : ['', '', '', ''],
  );
  const [comments, setComments] = useState(record?.comments ?? '');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);

  const activityLabelId = `${formId}-activity-label`;
  const widthsLegendId = `${formId}-widths-legend`;
  const singleStone = stoneIds.length === 1 ? stones.find((stone) => stone.id === stoneIds[0]) : undefined;
  const isImprinting = activityType === 'imprinting';

  const sideOptions: Array<{ value: SideChoice; label: string }> = [
    ...(!isEdit
      ? [
          {
            value: 'current' as const,
            label: singleStone?.current ? `Side in play (${singleStone.current.side})` : 'Side in play',
          },
        ]
      : []),
    { value: 'A', label: 'Side A' },
    { value: 'B', label: 'Side B' },
  ];

  const selectSheet = (sheet: string | null) => {
    setStoneIds(
      stones
        .filter((stone) => (sheet ? stone.current?.sheet === sheet : true))
        .map((stone) => stone.id),
    );
    if (errors.stones) setErrors((prev) => ({ ...prev, stones: undefined }));
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const nextErrors: FieldErrors = {};
    const parsedPasses = parseOptionalInteger(passes);
    const parsedRotations = parseOptionalInteger(rotations);
    const parsedGrit = parseOptionalInteger(grit);
    const parsedWidths = widths.map(parseOptionalDecimal);

    if (stoneIds.length === 0) nextErrors.stones = 'Choose at least one stone.';
    if (isImprinting && stoneIds.length > 1) {
      nextErrors.stones = 'Record imprinting one stone at a time, since each stone has its own band widths.';
    }
    if (!performedOn) nextErrors.performedOn = 'Choose the date of this maintenance.';
    if (activityType === 'texturing' && (parsedPasses == null || Number.isNaN(parsedPasses) || parsedPasses < 0)) {
      nextErrors.passes = 'Enter the number of passes as a whole number.';
    }
    if (
      activityType === 'band_narrowing' &&
      (parsedRotations == null || Number.isNaN(parsedRotations) || parsedRotations < 0)
    ) {
      nextErrors.rotations = 'Enter the number of rotations as a whole number.';
    }
    if (!isImprinting && (parsedGrit == null || Number.isNaN(parsedGrit) || parsedGrit < 1)) {
      nextErrors.sandpaperGrit = 'Enter the sandpaper grit, such as 120.';
    }
    if (isImprinting && parsedWidths.some((value) => value == null || Number.isNaN(value) || value < 0)) {
      nextErrors.bandWidths = 'Enter all four widths in millimeters.';
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    const fields = {
      activityType,
      performedOn,
      passes: activityType === 'texturing' ? parsedPasses : null,
      rotations: activityType === 'band_narrowing' ? parsedRotations : null,
      sandpaperGrit: isImprinting ? null : parsedGrit,
      bandWidthsMm: isImprinting ? parsedWidths : null,
      comments: comments.trim() || null,
    };

    setSubmitting(true);
    try {
      if (record) {
        await patch(
          '/stones/maintenance/{id}',
          { ...fields, side: side === 'current' ? record.side : side },
          { id: String(record.id) },
        );
        showAlert('Maintenance record updated', 'success');
      } else {
        const result = await post('/stones/maintenance', { ...fields, stoneIds, side });
        showAlert(
          result.created === 1 ? 'Maintenance recorded' : `Maintenance recorded for ${result.created} stones`,
          'success',
        );
      }
      onSaved();
    } catch (error) {
      showAlert(formatApiError(error, 'Failed to save maintenance'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const numberInput = (
    key: 'passes' | 'rotations' | 'sandpaperGrit',
    label: string,
    value: string,
    setValue: (next: string) => void,
    helperText?: string,
  ) => (
    <FormField label={label} htmlFor={`${formId}-${key}`} required error={errors[key]} helperText={helperText}>
      {({ describedBy, invalid }) => (
        <input
          id={`${formId}-${key}`}
          type="number"
          inputMode="numeric"
          min={key === 'sandpaperGrit' ? 1 : 0}
          step={1}
          className="app-input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-describedby={describedBy}
          aria-invalid={invalid}
        />
      )}
    </FormField>
  );

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={isEdit ? 'Edit maintenance record' : 'Record maintenance'}
      size="lg"
      verticalAlign="start"
    >
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <FormField label="Activity" labelId={activityLabelId} required>
          <ChoiceInput<MaintenanceActivityType>
            layout="inline"
            name={`${formId}-activity`}
            ariaLabelledBy={activityLabelId}
            value={activityType}
            onChange={(next) => {
              if (next == null || Array.isArray(next)) return;
              setActivityType(next);
              setErrors({});
            }}
            options={ACTIVITY_OPTIONS}
          />
        </FormField>

        {lockStones || isEdit ? (
          singleStone ? (
            <p className="text-sm text-gray-700 dark:text-gray-300">
              Stone <span className="font-medium">{stoneOptionLabel(singleStone)}</span>
            </p>
          ) : null
        ) : (
          <FormField
            label={isImprinting ? 'Stone' : 'Stones'}
            htmlFor={`${formId}-stones`}
            required
            error={errors.stones}
            helperText={
              isImprinting
                ? 'Imprinting is recorded one stone at a time.'
                : 'One record is created for each selected stone.'
            }
          >
            {({ describedBy, invalid }) => (
              <div className="space-y-2">
                <ChoiceInput<number>
                  inputId={`${formId}-stones`}
                  layout="popover"
                  maxSelectedItems={isImprinting ? undefined : null}
                  value={isImprinting ? (stoneIds[0] ?? null) : stoneIds}
                  onChange={(next) => {
                    setStoneIds(next == null ? [] : Array.isArray(next) ? next : [next]);
                    if (errors.stones) setErrors((prev) => ({ ...prev, stones: undefined }));
                  }}
                  options={stones.map((stone) => ({
                    value: stone.id,
                    label: stoneOptionLabel(stone),
                    textValue: `${stone.wcfRegistrationNumber} ${stone.alSerialNumber} ${stonePositionLabel(stone.current)}`,
                  }))}
                  placeholder="Choose stones"
                  listboxLabel="Stones"
                  ariaDescribedBy={describedBy}
                  ariaInvalid={invalid}
                  inputClassName="max-w-none"
                />
                {!isImprinting ? (
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="text-gray-600 dark:text-gray-400">Select:</span>
                    {STONE_SHEETS.map((sheet) => (
                      <Button
                        key={sheet}
                        type="button"
                        variant="secondary"
                        className="!px-3 !py-1"
                        onClick={() => selectSheet(sheet)}
                      >
                        Sheet {sheet}
                      </Button>
                    ))}
                    <Button type="button" variant="secondary" className="!px-3 !py-1" onClick={() => selectSheet(null)}>
                      All stones
                    </Button>
                    <Button type="button" variant="secondary" className="!px-3 !py-1" onClick={() => setStoneIds([])}>
                      Clear
                    </Button>
                  </div>
                ) : null}
              </div>
            )}
          </FormField>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <StoneSideField<SideChoice>
            idPrefix={formId}
            label="Side"
            value={side}
            onChange={setSide}
            options={sideOptions}
          />
          <FormField label="Date" htmlFor={`${formId}-date`} required error={errors.performedOn}>
            {({ describedBy, invalid }) => (
              <input
                id={`${formId}-date`}
                type="date"
                className="app-input"
                value={performedOn}
                onChange={(e) => setPerformedOn(e.target.value)}
                aria-describedby={describedBy}
                aria-invalid={invalid}
              />
            )}
          </FormField>
        </div>

        {activityType === 'texturing' ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {numberInput('passes', 'Number of passes', passes, setPasses)}
            {numberInput('sandpaperGrit', 'Sandpaper grit', grit, setGrit)}
          </div>
        ) : null}

        {activityType === 'band_narrowing' ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {numberInput('rotations', 'Number of rotations', rotations, setRotations)}
            {numberInput('sandpaperGrit', 'Sandpaper grit', grit, setGrit)}
          </div>
        ) : null}

        {isImprinting ? (
          <div role="group" aria-labelledby={widthsLegendId} className="space-y-2">
            <p id={widthsLegendId} className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Running band width (mm) <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Required</span>
            </p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {widths.map((value, index) => (
                <FormField key={index} label={`Spot ${index + 1}`} htmlFor={`${formId}-width-${index}`}>
                  <input
                    id={`${formId}-width-${index}`}
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="0.01"
                    className="app-input"
                    value={value}
                    onChange={(e) =>
                      setWidths((prev) => prev.map((current, i) => (i === index ? e.target.value : current)))
                    }
                    aria-invalid={Boolean(errors.bandWidths)}
                  />
                </FormField>
              ))}
            </div>
            {errors.bandWidths ? (
              <p className="text-sm text-red-700 dark:text-red-300" role="alert">
                {errors.bandWidths}
              </p>
            ) : null}
          </div>
        ) : null}

        <FormField label="Comments" htmlFor={`${formId}-comments`} optional>
          <textarea
            id={`${formId}-comments`}
            className="app-input min-h-[4rem]"
            value={comments}
            onChange={(e) => setComments(e.target.value)}
            maxLength={2000}
          />
        </FormField>

        <div className="flex gap-3">
          <Button type="submit" disabled={submitting} className="flex-1">
            {submitting ? 'Saving...' : isEdit ? 'Save' : 'Record maintenance'}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose} disabled={submitting} className="flex-1">
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  );
}
