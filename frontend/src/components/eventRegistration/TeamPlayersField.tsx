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
      ? 'text-sm font-medium text-gray-800 mb-2'
      : 'text-sm font-medium text-gray-800 dark:text-gray-100 mb-2'
    : 'sr-only';
  const cardClass = lightOnly
    ? 'rounded-md border border-gray-200 bg-white p-3 space-y-2'
    : 'rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/50 p-3 space-y-2';
  const positionLabelClass = lightOnly
    ? 'text-xs font-semibold uppercase tracking-wide text-gray-500'
    : 'text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400';

  return (
    <fieldset className="space-y-4">
      <legend className={legendClass}>
        {label}
        {required && ' *'}
      </legend>
      {positions.map((pos, i) => (
        <div key={pos} className={cardClass}>
          <p className={positionLabelClass}>{pos}</p>
          <input
            type="text"
            required={required}
            value={rows[i]?.name ?? ''}
            onChange={(e) => updateRow(i, 'name', e.target.value)}
            className={inputClassName}
            placeholder="Name"
          />
          <input
            type="email"
            value={rows[i]?.email ?? ''}
            onChange={(e) => updateRow(i, 'email', e.target.value)}
            className={inputClassName}
            placeholder="Email"
          />
          <input
            type="text"
            value={rows[i]?.homeClub ?? ''}
            onChange={(e) => updateRow(i, 'homeClub', e.target.value)}
            className={inputClassName}
            placeholder="Home club"
          />
        </div>
      ))}
    </fieldset>
  );
}
