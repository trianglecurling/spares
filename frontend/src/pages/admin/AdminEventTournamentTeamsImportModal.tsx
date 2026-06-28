import { useEffect, useMemo, useState } from 'react';
import Button from '../../components/Button';
import FormCheckbox from '../../components/FormCheckbox';
import InlineStateMessage from '../../components/InlineStateMessage';
import Modal from '../../components/Modal';
import api, { formatApiError } from '../../utils/api';
import { useAlert } from '../../contexts/AlertContext';
import type { TournamentFormat } from '../../utils/tournamentDisplay';
import {
  buildImportTeamPayloads,
  defaultColumnMappings,
  gridColumnCount,
  guessColumnMappingsFromHeaderRow,
  importMappingOptionsForFormat,
  parseTsvGrid,
  validateImportMappings,
  type TournamentTeamsImportColumnMapping,
} from '../../utils/tournamentTeamsImport';

type AdminEventTournamentTeamsImportModalProps = {
  isOpen: boolean;
  onClose: () => void;
  eventId: number;
  format: TournamentFormat;
  onImported: () => void;
};

function padRow(row: string[], len: number): string[] {
  const next = [...row];
  while (next.length < len) next.push('');
  return next;
}

function exampleSnippet(value: string, maxLen = 48): string {
  const t = value.replace(/\s+/g, ' ').trim();
  if (t.length <= maxLen) return t;
  return `${t.slice(0, maxLen - 1)}…`;
}

export default function AdminEventTournamentTeamsImportModal({
  isOpen,
  onClose,
  eventId,
  format,
  onImported,
}: AdminEventTournamentTeamsImportModalProps) {
  const { showAlert } = useAlert();
  const [step, setStep] = useState<1 | 2>(1);
  const [pasteText, setPasteText] = useState('');
  const [grid, setGrid] = useState<string[][]>([]);
  const [hasHeaderRow, setHasHeaderRow] = useState(true);
  const [dataRows, setDataRows] = useState<string[][]>([]);
  const [mappings, setMappings] = useState<TournamentTeamsImportColumnMapping[]>([]);
  const [importing, setImporting] = useState(false);

  const groupedSelect = useMemo(() => {
    const opts = importMappingOptionsForFormat(format);
    const order: string[] = [];
    const byGroup = new Map<string, typeof opts>();
    for (const o of opts) {
      if (!byGroup.has(o.group)) {
        order.push(o.group);
        byGroup.set(o.group, []);
      }
      byGroup.get(o.group)!.push(o);
    }
    return { order, byGroup };
  }, [format]);

  useEffect(() => {
    if (!isOpen) {
      setStep(1);
      setPasteText('');
      setGrid([]);
      setHasHeaderRow(true);
      setDataRows([]);
      setMappings([]);
      setImporting(false);
    }
  }, [isOpen]);

  const columnCount = grid.length ? gridColumnCount(grid) : 0;

  const applyHeaderMode = (checked: boolean, g: string[][]) => {
    const n = gridColumnCount(g);
    setHasHeaderRow(checked);
    if (checked && g.length > 0) {
      const headerRow = padRow(g[0] ?? [], n);
      setMappings(guessColumnMappingsFromHeaderRow(format, headerRow, n));
      setDataRows(g.slice(1));
    } else {
      setMappings(defaultColumnMappings(n));
      setDataRows(g);
    }
  };

  const handleContinueFromPaste = () => {
    const g = parseTsvGrid(pasteText);
    if (!g.length) {
      showAlert('Paste TSV data from your spreadsheet first.', 'warning');
      return;
    }
    setGrid(g);
    setStep(2);
    setHasHeaderRow(true);
    const n = gridColumnCount(g);
    const headerRow = padRow(g[0] ?? [], n);
    setMappings(guessColumnMappingsFromHeaderRow(format, headerRow, n));
    setDataRows(g.length > 1 ? g.slice(1) : []);
  };

  const handleHeaderRowChange = (checked: boolean) => {
    applyHeaderMode(checked, grid);
  };

  const setMappingAt = (colIndex: number, value: TournamentTeamsImportColumnMapping) => {
    setMappings((prev) => {
      const next = [...prev];
      next[colIndex] = value;
      return next;
    });
  };

  const mappingErrors = useMemo(() => validateImportMappings(mappings), [mappings]);

  const preview = useMemo(() => {
    if (step !== 2 || mappingErrors.length > 0) return null;
    return buildImportTeamPayloads(format, dataRows, mappings);
  }, [step, format, dataRows, mappings, mappingErrors.length]);

  const handleImport = async () => {
    if (mappingErrors.length > 0) {
      showAlert(mappingErrors[0] ?? 'Fix column mappings before importing.', 'error');
      return;
    }
    const built = buildImportTeamPayloads(format, dataRows, mappings);
    if (built.payloads.length === 0) {
      showAlert('No teams found — check that rows include a team name.', 'warning');
      return;
    }
    setImporting(true);
    try {
      for (const p of built.payloads) {
        await api.post(`/events/${eventId}/tournament-teams`, {
          teamName: p.teamName,
          roster: p.roster,
        });
      }
      const w = built.warnings.length;
      showAlert(
        w > 0
          ? `Imported ${built.payloads.length} team(s). ${w} warning(s) — review roster in the table.`
          : `Imported ${built.payloads.length} team(s).`,
        w > 0 ? 'warning' : 'success',
      );
      onImported();
      onClose();
    } catch (err) {
      showAlert(formatApiError(err, 'Import failed'), 'error');
    } finally {
      setImporting(false);
    }
  };

  const firstExampleRow = dataRows[0] ?? [];
  const paddedExample = padRow(firstExampleRow, columnCount);
  const paddedHeaderRow =
    hasHeaderRow && grid.length > 0 ? padRow(grid[0] ?? [], columnCount) : [];

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Import tournament teams (TSV)"
      size="xl"
      verticalAlign="start"
    >
      <div className="flex flex-col gap-4 min-h-0">
        {step === 1 ? (
          <>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Paste tab-separated data copied from a spreadsheet (one row per line, columns separated by tabs).
            </p>
            <textarea
              className="app-input w-full min-h-[12rem] font-mono text-xs"
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder="Paste here…"
              spellCheck={false}
            />
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="secondary" onClick={onClose}>
                Cancel
              </Button>
              <Button type="button" variant="primary" onClick={handleContinueFromPaste}>
                Continue
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Map each column to a field, or choose Ignore. Use <strong>long rows</strong> when each line is one player,
              with a column for position; use <strong>fixed columns</strong> when each position has its own player (and
              optional email/notes) columns. If you do not map <strong>Team name</strong>, each team is named{' '}
              <strong>Team</strong> plus the last name of the player in <strong>fourth</strong> (fours) or{' '}
              <strong>player 2</strong> (doubles). If that is still missing, we use numbered teams (Team 1, Team 2, …).
            </p>

            <FormCheckbox
              label="First row is a header row (column titles only)"
              checked={hasHeaderRow}
              onChange={handleHeaderRowChange}
            />

            {hasHeaderRow && grid.length < 2 ? (
              <InlineStateMessage
                tone="warning"
                title="No data rows"
                description="Turn off “header row” if the first line is data, or paste a sheet that includes rows under the header."
              />
            ) : null}

            {mappingErrors.length > 0 ? (
              <InlineStateMessage
                tone="warning"
                title="Fix column mapping"
                description={
                  <ul className="list-disc pl-5 space-y-1 mt-1">
                    {mappingErrors.map((e) => (
                      <li key={e}>{e}</li>
                    ))}
                  </ul>
                }
              />
            ) : null}

            {preview && preview.warnings.length > 0 ? (
              <InlineStateMessage
                tone="neutral"
                title="Import notes"
                description={
                  <ul className="list-disc pl-5 space-y-1 mt-1 text-sm">
                    {preview.warnings.slice(0, 8).map((w, i) => (
                      <li key={`${i}-${w}`}>{w}</li>
                    ))}
                    {preview.warnings.length > 8 ? (
                      <li>…and {preview.warnings.length - 8} more (still importing).</li>
                    ) : null}
                  </ul>
                }
              />
            ) : null}

            {preview && mappingErrors.length === 0 ? (
              <p className="text-sm text-gray-700 dark:text-gray-300">
                <span className="font-medium">{preview.payloads.length}</span> team
                {preview.payloads.length !== 1 ? 's' : ''} will be added to the end of the roster.
              </p>
            ) : null}

            <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 dark:bg-gray-900/50 text-left">
                  <tr>
                    <th className="px-3 py-2 font-medium text-gray-700 dark:text-gray-300">Column</th>
                    {hasHeaderRow ? (
                      <th className="px-3 py-2 font-medium text-gray-700 dark:text-gray-300">
                        Header (pasted)
                      </th>
                    ) : null}
                    <th className="px-3 py-2 font-medium text-gray-700 dark:text-gray-300">
                      {hasHeaderRow ? 'Example data' : 'Example'}
                    </th>
                    <th className="px-3 py-2 font-medium text-gray-700 dark:text-gray-300 min-w-[14rem]">
                      Maps to
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {Array.from({ length: columnCount }, (_, colIndex) => (
                    <tr key={colIndex}>
                      <td className="px-3 py-2 text-gray-600 dark:text-gray-400 whitespace-nowrap">
                        {colIndex + 1}
                      </td>
                      {hasHeaderRow ? (
                        <td className="px-3 py-2 text-gray-800 dark:text-gray-200 font-mono text-xs max-w-[14rem] truncate">
                          {exampleSnippet(paddedHeaderRow[colIndex] ?? '') || '—'}
                        </td>
                      ) : null}
                      <td className="px-3 py-2 text-gray-800 dark:text-gray-200 font-mono text-xs max-w-[12rem] truncate">
                        {exampleSnippet(paddedExample[colIndex] ?? '') || '—'}
                      </td>
                      <td className="px-3 py-2">
                        <select
                          className="app-input w-full max-w-xl text-sm"
                          value={mappings[colIndex] ?? 'ignore'}
                          onChange={(e) =>
                            setMappingAt(colIndex, e.target.value as TournamentTeamsImportColumnMapping)
                          }
                          aria-label={`Mapping for column ${colIndex + 1}`}
                        >
                          {groupedSelect.order.map((gName) => (
                            <optgroup key={gName} label={gName}>
                              {(groupedSelect.byGroup.get(gName) ?? []).map((o) => (
                                <option key={o.value} value={o.value}>
                                  {o.label}
                                </option>
                              ))}
                            </optgroup>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap justify-between gap-2 pt-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setStep(1);
                }}
              >
                Back
              </Button>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="secondary" onClick={onClose}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  disabled={
                    importing ||
                    mappingErrors.length > 0 ||
                    !preview ||
                    preview.payloads.length === 0 ||
                    (hasHeaderRow && grid.length < 2)
                  }
                  onClick={() => void handleImport()}
                >
                  {importing ? 'Importing…' : 'Import teams'}
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
