import ChoiceInput from '../ChoiceInput';
import FormField from '../FormField';
import {
  ROCK_NUMBERS,
  STONE_COLOR_HEX,
  STONE_COLOR_LABELS,
  STONE_COLORS,
  STONE_SHEETS,
  STONE_SIDES,
  stonePositionKey,
  type StoneColor,
  type StonePosition,
  type StoneSheet,
  type StoneSide,
  type StoneSummary,
} from '../../utils/curlingStones';

export function StoneSideField<Value extends string = StoneSide>({
  idPrefix,
  label,
  value,
  onChange,
  options,
  helperText,
}: {
  idPrefix: string;
  label: string;
  value: Value;
  onChange: (next: Value) => void;
  options?: Array<{ value: Value; label: string }>;
  helperText?: string;
}) {
  const labelId = `${idPrefix}-side-label`;
  const resolvedOptions =
    options ?? STONE_SIDES.map((side) => ({ value: side as unknown as Value, label: `Side ${side}` }));
  return (
    <FormField label={label} labelId={labelId} required helperText={helperText}>
      <ChoiceInput<Value>
        layout="inline"
        name={`${idPrefix}-side`}
        ariaLabelledBy={labelId}
        value={value}
        onChange={(next) => {
          if (next == null || Array.isArray(next)) return;
          onChange(next);
        }}
        options={resolvedOptions.map((option) => ({ ...option, textValue: option.label }))}
      />
    </FormField>
  );
}

type LocationChoice = StoneSheet | 'spare' | 'unassigned';

const LOCATION_OPTIONS: Array<{ value: LocationChoice; label: string }> = [
  ...STONE_SHEETS.map((sheet) => ({ value: sheet, label: `Sheet ${sheet}` })),
  { value: 'spare', label: 'Spare' },
  { value: 'unassigned', label: 'Unassigned' },
];

function locationOf(position: StonePosition): LocationChoice {
  if (position.color == null) return 'unassigned';
  return position.sheet ?? 'spare';
}

function ColorSwatch({ color }: { color: StoneColor }) {
  return (
    <span
      aria-hidden
      className="inline-block h-3.5 w-3.5 shrink-0 rounded-full border border-black/15"
      style={{ backgroundColor: STONE_COLOR_HEX[color] }}
    />
  );
}

export default function StonePositionFields({
  idPrefix,
  value,
  onChange,
  occupants,
  currentStoneId,
}: {
  idPrefix: string;
  value: StonePosition;
  onChange: (next: StonePosition) => void;
  /** Used to show which stone currently sits at each rock number. */
  occupants?: Map<string, StoneSummary>;
  currentStoneId?: number;
}) {
  const location = locationOf(value);
  const locationId = `${idPrefix}-location`;
  const colorLabelId = `${idPrefix}-color-label`;
  const rockId = `${idPrefix}-rock`;

  const occupantText = (position: StonePosition): string | undefined => {
    const key = stonePositionKey(position);
    const occupant = key ? occupants?.get(key) : undefined;
    if (!occupant) return occupants ? 'Empty' : undefined;
    return occupant.id === currentStoneId ? 'This stone' : `Stone ${occupant.wcfRegistrationNumber}`;
  };

  const handleLocationChange = (next: LocationChoice) => {
    if (next === 'unassigned') {
      onChange({ sheet: null, color: null, rockNumber: null });
      return;
    }
    const color = value.color ?? 'red';
    if (next === 'spare') {
      onChange({ sheet: null, color, rockNumber: null });
      return;
    }
    onChange({ sheet: next, color, rockNumber: value.rockNumber ?? 1 });
  };

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <FormField label="Location" htmlFor={locationId} required>
        <ChoiceInput<LocationChoice>
          inputId={locationId}
          layout="popover"
          value={location}
          onChange={(next) => {
            if (next == null || Array.isArray(next)) return;
            handleLocationChange(next);
          }}
          options={LOCATION_OPTIONS.map((option) => ({
            ...option,
            textValue: option.label,
            description:
              option.value === 'spare' && occupants
                ? STONE_COLORS.map(
                    (color) =>
                      `${STONE_COLOR_LABELS[color]}: ${occupantText({ sheet: null, color, rockNumber: null })}`,
                  ).join(' · ')
                : undefined,
          }))}
          listboxLabel="Location"
        />
      </FormField>

      {location !== 'unassigned' ? (
        <FormField label="Color" labelId={colorLabelId} required>
          <ChoiceInput<StoneColor>
            layout="inline"
            name={`${idPrefix}-color`}
            ariaLabelledBy={colorLabelId}
            value={value.color}
            onChange={(next) => {
              if (next == null || Array.isArray(next)) return;
              onChange({ ...value, color: next });
            }}
            options={STONE_COLORS.map((color) => ({
              value: color,
              label: STONE_COLOR_LABELS[color],
              textValue: STONE_COLOR_LABELS[color],
              icon: <ColorSwatch color={color} />,
            }))}
          />
        </FormField>
      ) : null}

      {value.sheet != null ? (
        <FormField label="Rock number" htmlFor={rockId} required>
          <ChoiceInput<number>
            inputId={rockId}
            layout="popover"
            value={value.rockNumber}
            onChange={(next) => {
              if (next == null || Array.isArray(next)) return;
              onChange({ ...value, rockNumber: next });
            }}
            options={ROCK_NUMBERS.map((rockNumber) => ({
              value: rockNumber,
              label: String(rockNumber),
              textValue: String(rockNumber),
              description: occupantText({ sheet: value.sheet, color: value.color, rockNumber }),
            }))}
            listboxLabel="Rock number"
          />
        </FormField>
      ) : null}
    </div>
  );
}
