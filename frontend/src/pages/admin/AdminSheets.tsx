import { useEffect, useId, useState } from 'react';
import { AppPage, AppPageHeader } from '../../components/AppPage';
import { del, get, patch, post } from '../../api/client';
import { formatApiError } from '../../utils/api';
import { useAlert } from '../../contexts/AlertContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import AppStateCard from '../../components/AppStateCard';
import Button from '../../components/Button';
import ChoiceInput from '../../components/ChoiceInput';
import FormCheckbox from '../../components/FormCheckbox';
import FormField from '../../components/FormField';
import Modal from '../../components/Modal';
import {
  commitSheetStoneColorSelection,
  parseSheetStoneColorSelection,
  resolveSheetStoneColorHex,
  SHEET_STONE_COLOR_CUSTOM,
  SHEET_STONE_COLOR_HEX,
  SHEET_STONE_COLOR_LABELS,
  SHEET_STONE_COLOR_PRESETS,
  sheetStoneColorLabel,
  type SheetStoneColorChoice,
} from '../../utils/sheetStoneColors';

interface Sheet {
  id: number;
  name: string;
  sortOrder: number;
  isActive: boolean;
  stoneColor1: string;
  stoneColor2: string;
  createdAt: string | null;
  updatedAt: string | null;
}

type SheetFormData = {
  name: string;
  sortOrder: number;
  isActive: boolean;
  stoneColor1: string;
  stoneColor2: string;
};

const DEFAULT_FORM: SheetFormData = {
  name: '',
  sortOrder: 0,
  isActive: true,
  stoneColor1: 'red',
  stoneColor2: 'yellow',
};

function StoneColorSwatch({ color, className = '' }: { color: string; className?: string }) {
  return (
    <span
      className={`inline-block h-4 w-4 shrink-0 rounded-full border border-black/15 dark:border-white/20 ${className}`}
      style={{ backgroundColor: resolveSheetStoneColorHex(color) }}
      aria-hidden
    />
  );
}

function SheetStoneColorField({
  label,
  inputId,
  value,
  onChange,
}: {
  label: string;
  inputId: string;
  value: string;
  onChange: (next: string) => void;
}) {
  const customHexId = `${inputId}-custom-hex`;
  const selection = parseSheetStoneColorSelection(value);
  const [customHexDraft, setCustomHexDraft] = useState(selection.customHex);

  useEffect(() => {
    const next = parseSheetStoneColorSelection(value);
    if (next.choice === SHEET_STONE_COLOR_CUSTOM) {
      setCustomHexDraft(next.customHex);
    }
  }, [value]);

  const colorPickerValue =
    selection.choice === SHEET_STONE_COLOR_CUSTOM && /^#[0-9a-fA-F]{6}$/.test(customHexDraft.trim())
      ? customHexDraft.trim()
      : '#808080';

  return (
    <FormField label={label} htmlFor={inputId} required>
      <ChoiceInput<SheetStoneColorChoice>
        inputId={inputId}
        layout="popover"
        value={selection.choice}
        onChange={(next) => {
          if (next == null || Array.isArray(next)) return;
          if (next === SHEET_STONE_COLOR_CUSTOM) {
            onChange(commitSheetStoneColorSelection(SHEET_STONE_COLOR_CUSTOM, customHexDraft));
            return;
          }
          onChange(next);
        }}
        options={[
          ...SHEET_STONE_COLOR_PRESETS.map((preset) => ({
            value: preset as SheetStoneColorChoice,
            label: SHEET_STONE_COLOR_LABELS[preset],
            textValue: SHEET_STONE_COLOR_LABELS[preset],
            icon: <StoneColorSwatch color={SHEET_STONE_COLOR_HEX[preset]} />,
          })),
          {
            value: SHEET_STONE_COLOR_CUSTOM,
            label: 'Custom',
            textValue: 'Custom',
          },
        ]}
        listboxLabel={label}
        placeholder="Select a color"
      />
      {selection.choice === SHEET_STONE_COLOR_CUSTOM ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            id={customHexId}
            type="color"
            className="h-9 w-12 cursor-pointer rounded border border-gray-200 bg-white p-0.5 dark:border-gray-600"
            value={colorPickerValue}
            onChange={(e) => {
              const hex = e.target.value;
              setCustomHexDraft(hex);
              onChange(hex);
            }}
            aria-label={`${label} color picker`}
          />
          <input
            type="text"
            className="app-input min-w-[7rem] flex-1"
            value={customHexDraft}
            placeholder="#808080"
            onChange={(e) => {
              const raw = e.target.value.trim();
              setCustomHexDraft(raw);
              if (/^#[0-9a-fA-F]{6}$/.test(raw)) {
                onChange(raw);
              }
            }}
            aria-label={`${label} hex value`}
          />
        </div>
      ) : null}
    </FormField>
  );
}

export default function AdminSheets() {
  const { showAlert } = useAlert();
  const { confirm } = useConfirm();
  const formId = useId();
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSheet, setEditingSheet] = useState<Sheet | null>(null);
  const [formData, setFormData] = useState<SheetFormData>(DEFAULT_FORM);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    loadSheets();
  }, []);

  const loadSheets = async () => {
    try {
      const response = await get('/sheets');
      setSheets(response);
    } catch (error) {
      console.error('Failed to load sheets:', error);
      showAlert('Failed to load sheets', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleOpenModal = (sheet?: Sheet) => {
    if (sheet) {
      setEditingSheet(sheet);
      setFormData({
        name: sheet.name,
        sortOrder: sheet.sortOrder,
        isActive: sheet.isActive,
        stoneColor1: sheet.stoneColor1,
        stoneColor2: sheet.stoneColor2,
      });
    } else {
      setEditingSheet(null);
      setFormData({
        ...DEFAULT_FORM,
        sortOrder: sheets.length,
      });
    }
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingSheet(null);
    setFormData(DEFAULT_FORM);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);

    try {
      const payload = {
        name: formData.name,
        sortOrder: formData.sortOrder,
        isActive: formData.isActive,
        stoneColor1: formData.stoneColor1,
        stoneColor2: formData.stoneColor2,
      };

      if (editingSheet) {
        await patch('/sheets/{id}', payload, { id: String(editingSheet.id) });
      } else {
        await post('/sheets', payload);
      }

      await loadSheets();
      handleCloseModal();
    } catch (error: unknown) {
      console.error('Failed to save sheet:', error);
      showAlert(formatApiError(error, 'Failed to save sheet'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (sheet: Sheet) => {
    const confirmed = await confirm({
      title: 'Delete sheet',
      message: `Are you sure you want to delete ${sheet.name}? This action cannot be undone.`,
      variant: 'danger',
      confirmText: 'Delete',
    });

    if (!confirmed) return;

    try {
      await del('/sheets/{id}', undefined, { id: String(sheet.id) });
      setSheets((prev) => prev.filter((s) => s.id !== sheet.id));
    } catch (error: unknown) {
      console.error('Failed to delete sheet:', error);
      showAlert(formatApiError(error, 'Failed to delete sheet'), 'error');
    }
  };

  return (
    <>
      <AppPage>
        <AppPageHeader
          title="Manage sheets"
          actions={<Button onClick={() => handleOpenModal()}>Add sheet</Button>}
        />

        {loading ? (
          <AppStateCard title="Loading sheets..." />
        ) : sheets.length === 0 ? (
          <AppStateCard
            title="No sheets configured yet."
            action={<Button onClick={() => handleOpenModal()}>Create your first sheet</Button>}
          />
        ) : (
          <div className="grid gap-4">
            {sheets.map((sheet) => (
              <div key={sheet.id} className="app-card p-6">
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <h3 className="app-section-title mb-2">{sheet.name}</h3>
                    <div className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
                      <p>
                        <span className="font-medium dark:text-gray-300">Sort order:</span>{' '}
                        {sheet.sortOrder}
                      </p>
                      <p>
                        <span className="font-medium dark:text-gray-300">Status:</span>{' '}
                        {sheet.isActive ? 'Active' : 'Inactive'}
                      </p>
                      <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="font-medium dark:text-gray-300">Stone colors:</span>
                        <span className="inline-flex items-center gap-1.5">
                          <StoneColorSwatch color={sheet.stoneColor1} />
                          {sheetStoneColorLabel(sheet.stoneColor1)}
                        </span>
                        <span className="text-gray-400" aria-hidden>
                          /
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                          <StoneColorSwatch color={sheet.stoneColor2} />
                          {sheetStoneColorLabel(sheet.stoneColor2)}
                        </span>
                      </p>
                    </div>
                  </div>

                  <div className="flex space-x-2">
                    <Button onClick={() => handleOpenModal(sheet)} variant="secondary">
                      Edit
                    </Button>
                    <Button onClick={() => handleDelete(sheet)} variant="danger">
                      Delete
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </AppPage>

      <Modal
        isOpen={isModalOpen}
        onClose={handleCloseModal}
        title={editingSheet ? 'Edit sheet' : 'Add sheet'}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <FormField label="Sheet name" htmlFor={`${formId}-name`} required>
            <input
              type="text"
              id={`${formId}-name`}
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="app-input"
              required
            />
          </FormField>

          <FormField label="Sort order" htmlFor={`${formId}-sort-order`}>
            <input
              type="number"
              id={`${formId}-sort-order`}
              value={formData.sortOrder}
              onChange={(e) =>
                setFormData({ ...formData, sortOrder: parseInt(e.target.value, 10) || 0 })
              }
              className="app-input"
            />
          </FormField>

          <SheetStoneColorField
            label="Stone color 1"
            inputId={`${formId}-stone-color-1`}
            value={formData.stoneColor1}
            onChange={(stoneColor1) => setFormData({ ...formData, stoneColor1 })}
          />

          <SheetStoneColorField
            label="Stone color 2"
            inputId={`${formId}-stone-color-2`}
            value={formData.stoneColor2}
            onChange={(stoneColor2) => setFormData({ ...formData, stoneColor2 })}
          />

          <FormCheckbox
            label="Active"
            checked={formData.isActive}
            onChange={(isActive) => setFormData({ ...formData, isActive })}
          />

          <div className="flex space-x-3">
            <Button type="submit" disabled={submitting} className="flex-1">
              {submitting ? 'Saving...' : 'Save'}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={handleCloseModal}
              disabled={submitting}
              className="flex-1"
            >
              Cancel
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
