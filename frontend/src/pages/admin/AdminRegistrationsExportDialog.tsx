import { useEffect, useId, useMemo, useState } from 'react';
import axios from 'axios';
import Button from '../../components/Button';
import FormCheckbox from '../../components/FormCheckbox';
import InlineStateMessage from '../../components/InlineStateMessage';
import Modal from '../../components/Modal';
import SortableList from '../../components/dragDrop/SortableList';
import SortableRow from '../../components/dragDrop/SortableRow';
import { useAlert } from '../../contexts/AlertContext';
import api, { getApiErrorMessage } from '../../utils/api';

export type RegistrationExportColumn = {
  key: string;
  label: string;
  group: string;
  kind: 'value' | 'leaguePriorities';
};

type ColumnChoice = RegistrationExportColumn & { selected: boolean };

type AdminRegistrationsExportDialogProps = {
  isOpen: boolean;
  sessionId: number | null;
  search: string;
  status: string;
  q: string;
  onClose: () => void;
};

const STORAGE_KEY = 'admin.registrations.exportColumns.v1';

function readStoredColumnState(): { order: string[]; selected: string[] } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { order?: unknown; selected?: unknown };
    if (!Array.isArray(parsed.order) || !Array.isArray(parsed.selected)) return null;
    return {
      order: parsed.order.filter((value): value is string => typeof value === 'string'),
      selected: parsed.selected.filter((value): value is string => typeof value === 'string'),
    };
  } catch {
    return null;
  }
}

function persistColumnState(choices: ColumnChoice[]) {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      order: choices.map((choice) => choice.key),
      selected: choices.filter((choice) => choice.selected).map((choice) => choice.key),
    }),
  );
}

function mergeColumnChoices(catalog: RegistrationExportColumn[]): ColumnChoice[] {
  const stored = readStoredColumnState();
  const byKey = new Map(catalog.map((column) => [column.key, column]));
  const order = [
    ...(stored?.order ?? []).filter((key) => byKey.has(key)),
    ...catalog.map((column) => column.key).filter((key) => !(stored?.order ?? []).includes(key)),
  ];
  const selected = stored
    ? new Set([...stored.selected.filter((key) => byKey.has(key)), ...catalog.map((column) => column.key).filter((key) => !(stored.order ?? []).includes(key))])
    : new Set(catalog.map((column) => column.key));
  return order.map((key) => ({ ...byKey.get(key)!, selected: selected.has(key) }));
}

function filenameFromDisposition(header: string | undefined, fallback: string): string {
  if (!header) return fallback;
  const utfMatch = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (utfMatch?.[1]) return decodeURIComponent(utfMatch[1]);
  const match = /filename="?([^"]+)"?/i.exec(header);
  return match?.[1] ?? fallback;
}

async function messageFromExportError(error: unknown): Promise<string> {
  if (axios.isAxiosError(error) && error.response?.data instanceof Blob) {
    try {
      const parsed = JSON.parse(await error.response.data.text()) as { error?: string };
      if (typeof parsed.error === 'string' && parsed.error.trim()) return parsed.error.trim();
    } catch {
      // Fall through to the shared API error helper.
    }
  }
  return getApiErrorMessage(error, 'Unable to export registrations.');
}

export default function AdminRegistrationsExportDialog({
  isOpen,
  sessionId,
  search,
  status,
  q,
  onClose,
}: AdminRegistrationsExportDialogProps) {
  const { showAlert } = useAlert();
  const columnsHeadingId = useId();
  const [choices, setChoices] = useState<ColumnChoice[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    void api
      .get<{ columns: RegistrationExportColumn[] }>('/registration/staff/export-columns')
      .then((response) => {
        if (cancelled) return;
        setChoices(mergeColumnChoices(response.data.columns));
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoadError(getApiErrorMessage(error, 'Unable to load export columns.'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const selectedCount = useMemo(() => choices.filter((choice) => choice.selected).length, [choices]);

  function updateChoices(next: ColumnChoice[]) {
    setChoices(next);
    persistColumnState(next);
  }

  async function handleExport() {
    if (!sessionId || selectedCount === 0 || exporting) return;
    setExporting(true);
    try {
      const response = await api.post(
        '/registration/staff/registrations/export',
        {
          sessionId,
          search: search || undefined,
          status: status || undefined,
          q: q || undefined,
          columns: choices.filter((choice) => choice.selected).map((choice) => choice.key),
        },
        { responseType: 'blob' },
      );
      const blob = new Blob([response.data], { type: 'text/csv;charset=utf-8' });
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = filenameFromDisposition(
        response.headers['content-disposition'],
        'registrations.csv',
      );
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
      showAlert('Registration export downloaded.', 'success');
      onClose();
    } catch (error) {
      showAlert(await messageFromExportError(error), 'error');
    } finally {
      setExporting(false);
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Export registrations" size="md" verticalAlign="start">
      <div className="flex min-h-0 flex-col gap-4">
        <p className="text-sm text-gray-600 dark:text-gray-300">
          Download the current filtered list as a CSV spreadsheet. Choose the columns to include and drag to
          set their order. League priorities export as one column per priority, using only as many as this
          list needs.
        </p>
        {loading ? <InlineStateMessage title="Loading columns" description="Gathering available registration fields." /> : null}
        {loadError ? (
          <InlineStateMessage
            tone="error"
            title="Unable to load columns"
            description={loadError}
          />
        ) : null}
        {!loading && !loadError ? (
          <div role="group" aria-labelledby={columnsHeadingId} className="flex min-h-0 flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 id={columnsHeadingId} className="text-sm font-medium text-gray-800 dark:text-gray-200">
                Columns
              </h4>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => updateChoices(choices.map((choice) => ({ ...choice, selected: true })))}
                >
                  Select all
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => updateChoices(choices.map((choice) => ({ ...choice, selected: false })))}
                >
                  Clear
                </Button>
              </div>
            </div>
            {selectedCount === 0 ? (
              <InlineStateMessage title="Select at least one column" description="Turn on a column before downloading." />
            ) : null}
            <div className="max-h-[min(24rem,50vh)] overflow-auto pr-1">
              <SortableList
                items={choices}
                getId={(choice) => choice.key}
                getItemLabel={(choice) => choice.label}
                itemNoun="column"
                onReorder={(next) => updateChoices(next)}
                renderItem={({ item, isDragging, isOverlay, dragHandle }) => (
                  <SortableRow isDragging={isDragging} isOverlay={isOverlay} className="p-2">
                    <div className="flex items-center gap-2">
                      {dragHandle}
                      <FormCheckbox
                        className="flex-1"
                        label={item.label}
                        checked={item.selected}
                        onChange={(checked) =>
                          updateChoices(
                            choices.map((choice) =>
                              choice.key === item.key ? { ...choice, selected: checked } : choice,
                            ),
                          )
                        }
                      />
                    </div>
                  </SortableRow>
                )}
              />
            </div>
          </div>
        ) : null}
        <div className="flex flex-wrap justify-end gap-3">
          <Button type="button" variant="secondary" onClick={onClose} disabled={exporting}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => void handleExport()}
            disabled={exporting || loading || !sessionId || selectedCount === 0}
          >
            {exporting ? 'Downloading…' : 'Download CSV'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
