import { useId, useState } from 'react';
import ChoiceInput, { type ChoiceOption } from '../ChoiceInput';
import {
  DIETARY_RESTRICTION_KEYS,
  DIETARY_RESTRICTION_LABELS,
  parseTeamPlayersJson,
  playerHasDietaryRestrictions,
  type DietaryRestrictionKey,
  type TeamPlayerRow,
} from '../../utils/eventRegistrationFieldPresets';

const DIETARY_CHOICE_OPTIONS: ChoiceOption<DietaryRestrictionKey>[] = DIETARY_RESTRICTION_KEYS.map((key) => ({
  value: key,
  label: DIETARY_RESTRICTION_LABELS[key],
}));

export function defaultTeamPlayersJson(rowCount: number): string {
  return JSON.stringify(
    Array.from({ length: rowCount }, () => ({ name: '', email: '', homeClub: '' })),
  );
}

export type TeamPlayersFieldProps = {
  label: string;
  required: boolean;
  value: string;
  onChange: (value: string) => void;
  positions: readonly string[];
  inputClassName: string;
  /** When false, parent supplies the visible label; an sr-only legend remains for accessibility. */
  showLegend?: boolean;
  /** Public event forms are light-only; omit dark-mode styles so system dark theme does not apply. */
  lightOnly?: boolean;
  collectDietaryRestrictions?: boolean;
};

function playerSectionClasses(i: number, total: number, lightOnly: boolean): string {
  const parts = ['space-y-2.5'];
  if (i > 0) {
    parts.push(lightOnly ? 'border-t border-gray-200 pt-4' : 'border-t border-gray-200 pt-4 dark:border-gray-600');
  }
  if (i < total - 1) {
    parts.push('pb-4');
  }
  return parts.join(' ');
}

export function TeamPlayersField({
  label,
  required,
  value,
  onChange,
  positions,
  inputClassName,
  showLegend = true,
  lightOnly = false,
  collectDietaryRestrictions = false,
}: TeamPlayersFieldProps) {
  const fieldsetId = useId();
  const [expandedDietary, setExpandedDietary] = useState<Set<number>>(() => new Set());

  const rows = parseTeamPlayersJson(value, positions.length);

  const updateRow = (i: number, key: keyof TeamPlayerRow, v: string | boolean) => {
    const next = [...rows];
    next[i] = { ...next[i], [key]: v };
    onChange(JSON.stringify(next));
  };

  const updateDietarySelection = (i: number, nextValue: DietaryRestrictionKey | DietaryRestrictionKey[] | null) => {
    const selected = Array.isArray(nextValue) ? nextValue : nextValue ? [nextValue] : [];
    const next = [...rows];
    const row: TeamPlayerRow = { ...next[i] };
    for (const key of DIETARY_RESTRICTION_KEYS) {
      if (selected.includes(key)) row[key] = true;
      else delete row[key];
    }
    next[i] = row;
    onChange(JSON.stringify(next));
  };

  const toggleDietaryExpanded = (i: number) => {
    setExpandedDietary((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  const legendClass = showLegend
    ? lightOnly
      ? 'mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium text-gray-800'
      : 'mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium text-gray-800 dark:text-gray-100'
    : 'sr-only';
  const requiredMarkerClass = lightOnly
    ? 'text-xs font-medium text-gray-500'
    : 'text-xs font-medium text-gray-500 dark:text-gray-400';
  const positionLabelClass = lightOnly
    ? 'text-sm font-semibold uppercase tracking-wide text-gray-900'
    : 'text-sm font-semibold uppercase tracking-wide text-gray-900 dark:text-gray-100';
  const inlineLabelClass = lightOnly
    ? 'pt-2 text-sm font-medium text-gray-700'
    : 'pt-2 text-sm font-medium text-gray-700 dark:text-gray-300';
  const fieldRowClass = 'grid grid-cols-[6.75rem_minmax(0,1fr)_7.5rem] items-start gap-x-3';
  const copyPreviousButtonClass = lightOnly
    ? 'shrink-0 pt-2 text-sm text-primary-teal-link hover:underline disabled:cursor-not-allowed disabled:opacity-50 disabled:no-underline'
    : 'shrink-0 pt-2 text-sm text-primary-teal hover:underline disabled:cursor-not-allowed disabled:opacity-50 disabled:no-underline dark:text-primary-teal';
  const dietaryButtonClass = lightOnly
    ? 'text-sm text-primary-teal-link hover:underline'
    : 'text-sm text-primary-teal hover:underline dark:text-primary-teal';

  return (
    <fieldset>
      <legend className={legendClass}>
        <span>{label}</span>
        {required ? <span className={requiredMarkerClass}>Required</span> : null}
      </legend>
      {positions.map((pos, i) => {
        const nameId = `${fieldsetId}-${i}-name`;
        const emailId = `${fieldsetId}-${i}-email`;
        const homeClubId = `${fieldsetId}-${i}-home-club`;
        const dietaryExpanded =
          expandedDietary.has(i) ||
          playerHasDietaryRestrictions(rows[i] ?? { name: '', email: '', homeClub: '' });

        return (
          <div key={pos} className={playerSectionClasses(i, positions.length, lightOnly)}>
            <h3 className={positionLabelClass}>{pos}</h3>
            <div className={fieldRowClass}>
              <label htmlFor={nameId} className={inlineLabelClass}>
                Name
              </label>
              <input
                id={nameId}
                type="text"
                required={required}
                value={rows[i]?.name ?? ''}
                onChange={(e) => updateRow(i, 'name', e.target.value)}
                className={inputClassName}
              />
              <span aria-hidden="true" />
            </div>
            <div className={fieldRowClass}>
              <label htmlFor={emailId} className={inlineLabelClass}>
                Email
              </label>
              <input
                id={emailId}
                type="email"
                value={rows[i]?.email ?? ''}
                onChange={(e) => updateRow(i, 'email', e.target.value)}
                className={inputClassName}
              />
              <span aria-hidden="true" />
            </div>
            <div className={fieldRowClass}>
              <label htmlFor={homeClubId} className={inlineLabelClass}>
                Home club
              </label>
              <input
                id={homeClubId}
                type="text"
                value={rows[i]?.homeClub ?? ''}
                onChange={(e) => updateRow(i, 'homeClub', e.target.value)}
                className={inputClassName}
              />
              {i === 0 ? (
                <span aria-hidden="true" />
              ) : (
                <button
                  type="button"
                  onClick={() => updateRow(i, 'homeClub', rows[i - 1]?.homeClub ?? '')}
                  disabled={!(rows[i - 1]?.homeClub ?? '').trim()}
                  className={copyPreviousButtonClass}
                  aria-label={`Copy home club from ${positions[i - 1]}`}
                >
                  Copy previous
                </button>
              )}
            </div>
            {collectDietaryRestrictions ? (
              <div className="pt-1">
                {!dietaryExpanded ? (
                  <button
                    type="button"
                    onClick={() => toggleDietaryExpanded(i)}
                    className={dietaryButtonClass}
                  >
                    Add dietary restrictions
                  </button>
                ) : (
                  <ChoiceInput<DietaryRestrictionKey>
                    options={DIETARY_CHOICE_OPTIONS}
                    value={DIETARY_RESTRICTION_KEYS.filter((key) => rows[i]?.[key] === true)}
                    onChange={(nextValue) => updateDietarySelection(i, nextValue)}
                    layout="inline"
                    maxSelectedItems={null}
                    multiSelectionIndicatorStyle="checkboxes"
                    ariaLabel={`${pos} dietary restrictions`}
                    name={`${fieldsetId}-${i}-dietary`}
                  />
                )}
              </div>
            ) : null}
          </div>
        );
      })}
    </fieldset>
  );
}
