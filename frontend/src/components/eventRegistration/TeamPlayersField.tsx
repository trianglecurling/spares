import { useId } from 'react';

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
}: TeamPlayersFieldProps) {
  const fieldsetId = useId();

  let rows: Array<{ name: string; email: string; homeClub: string }>;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed) || parsed.length !== positions.length) {
      rows = positions.map(() => ({ name: '', email: '', homeClub: '' }));
    } else {
      rows = parsed.map((r: unknown) => {
        const o = r && typeof r === 'object' ? (r as Record<string, unknown>) : {};
        return {
          name: typeof o.name === 'string' ? o.name : '',
          email: typeof o.email === 'string' ? o.email : '',
          homeClub: typeof o.homeClub === 'string' ? o.homeClub : '',
        };
      });
    }
  } catch {
    rows = positions.map(() => ({ name: '', email: '', homeClub: '' }));
  }

  const updateRow = (i: number, key: 'name' | 'email' | 'homeClub', v: string) => {
    const next = [...rows];
    next[i] = { ...next[i], [key]: v };
    onChange(JSON.stringify(next));
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
          </div>
        );
      })}
    </fieldset>
  );
}
