import axios from 'axios';
import { useId, useMemo, useState, type FormEvent } from 'react';
import { post } from '../../api/client';
import { useAlert } from '../../contexts/AlertContext';
import { formatApiError } from '../../utils/api';
import {
  parseStoneImportText,
  stonePositionLabel,
  todayInClub,
  type StoneSide,
} from '../../utils/curlingStones';
import Button from '../Button';
import FormField from '../FormField';
import InlineStateMessage from '../InlineStateMessage';
import Modal from '../Modal';
import { StoneSideField } from './StonePositionFields';

type StoneImportModalProps = {
  onClose: () => void;
  onImported: () => void;
};

type ServerRowError = { row: number; message: string };

function serverRowErrors(error: unknown): ServerRowError[] {
  if (!axios.isAxiosError(error)) return [];
  const rows = (error.response?.data as { details?: { rows?: unknown } } | undefined)?.details?.rows;
  return Array.isArray(rows)
    ? rows.filter((row): row is ServerRowError => typeof row?.row === 'number' && typeof row?.message === 'string')
    : [];
}

export default function StoneImportModal({ onClose, onImported }: StoneImportModalProps) {
  const formId = useId();
  const { showAlert } = useAlert();
  const [text, setText] = useState('');
  const [side, setSide] = useState<StoneSide>('A');
  const [effectiveDate, setEffectiveDate] = useState(todayInClub());
  const [serverErrors, setServerErrors] = useState<ServerRowError[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const rows = useMemo(() => parseStoneImportText(text), [text]);
  const serverErrorByIndex = useMemo(
    () => new Map(serverErrors.map((entry) => [entry.row - 1, entry.message])),
    [serverErrors],
  );
  const invalidCount = rows.filter((row, index) => row.error || serverErrorByIndex.has(index)).length;
  const canImport = rows.length > 0 && invalidCount === 0 && Boolean(effectiveDate);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canImport) return;
    setSubmitting(true);
    try {
      const result = await post('/stones/import', {
        effectiveDate,
        side,
        rows: rows.map((row) => ({
          wcfRegistrationNumber: row.wcfRegistrationNumber,
          alSerialNumber: row.alSerialNumber,
          sheet: row.sheet,
          color: row.color,
          rockNumber: row.rockNumber,
        })),
      });
      showAlert(`Imported ${result.created} ${result.created === 1 ? 'stone' : 'stones'}`, 'success');
      onImported();
    } catch (error) {
      const rowErrors = serverRowErrors(error);
      setServerErrors(rowErrors);
      if (rowErrors.length === 0) {
        showAlert(formatApiError(error, 'Failed to import stones'), 'error');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title="Import stones" size="xl" verticalAlign="start">
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <FormField
          label="Stone rows"
          htmlFor={`${formId}-rows`}
          required
          helperPlacement="after-label"
          helperText={
            <>
              Paste from a spreadsheet, one stone per row, with five columns: sheet, color, rock number, WCF
              registration number, AL serial number. Use <span className="font-medium">Spare</span> as the sheet for
              spares (leave the rock number blank), or leave sheet and color blank for unassigned stones. A header row
              is skipped automatically.
            </>
          }
        >
          {({ describedBy }) => (
            <textarea
              id={`${formId}-rows`}
              className="app-input min-h-[10rem] font-mono text-sm"
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setServerErrors([]);
              }}
              aria-describedby={describedBy}
              placeholder={'A\tred\t1\t12345\tAL-0001\nSpare\tyellow\t\t12399\tAL-0066'}
              spellCheck={false}
            />
          )}
        </FormField>

        <div className="grid gap-4 sm:grid-cols-2">
          <StoneSideField
            idPrefix={formId}
            label="Side in play"
            value={side}
            onChange={setSide}
            helperText="Applies to every imported stone."
          />
          <FormField label="In service since" htmlFor={`${formId}-date`} required>
            <input
              id={`${formId}-date`}
              type="date"
              className="app-input"
              value={effectiveDate}
              onChange={(e) => setEffectiveDate(e.target.value)}
            />
          </FormField>
        </div>

        {rows.length > 0 ? (
          <div className="space-y-2">
            <p className="text-sm text-gray-700 dark:text-gray-300" aria-live="polite">
              {rows.length} {rows.length === 1 ? 'row' : 'rows'} found
              {invalidCount > 0 ? `, ${invalidCount} with problems to fix before importing.` : ', ready to import.'}
            </p>
            <div className="app-table-shell max-h-72 overflow-auto">
              <table className="app-table">
                <thead className="app-table-head">
                  <tr>
                    <th className="app-table-th">Line</th>
                    <th className="app-table-th">Position</th>
                    <th className="app-table-th">WCF number</th>
                    <th className="app-table-th">AL serial</th>
                    <th className="app-table-th">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {rows.map((row, index) => {
                    const problem = row.error ?? serverErrorByIndex.get(index) ?? null;
                    return (
                      <tr key={`${row.line}-${index}`}>
                        <td className="app-table-td">{row.line}</td>
                        <td className="app-table-td">{row.error ? '—' : stonePositionLabel(row)}</td>
                        <td className="app-table-td">{row.wcfRegistrationNumber}</td>
                        <td className="app-table-td">{row.alSerialNumber}</td>
                        <td
                          className={
                            problem
                              ? 'app-table-td text-red-700 dark:text-red-300'
                              : 'app-table-td text-emerald-700 dark:text-emerald-300'
                          }
                        >
                          {problem ?? 'Ready'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <InlineStateMessage title="Paste rows above to preview them before importing." />
        )}

        <div className="flex gap-3">
          <Button type="submit" disabled={submitting || !canImport} className="flex-1">
            {submitting ? 'Importing...' : rows.length > 0 ? `Import ${rows.length} stones` : 'Import stones'}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose} disabled={submitting} className="flex-1">
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  );
}
