import type { EventRegistrationField } from '../components/eventRegistration/PublicRegistrationFieldInput';

/**
 * Key prefix for unsaved event registration previews (browser only; never hits the server).
 * Uses localStorage so the editor tab can write and the preview tab opened via window.open can read.
 */
export const EVENT_REGISTRATION_PREVIEW_STORAGE_PREFIX = 'tccEventRegistrationPreview:';

export type EventRegistrationPreviewPayloadV1 = {
  v: 1;
  title: string;
  feeMinor: number;
  memberFeeMinor: number | null;
  currency: string;
  allowGroupRegistration: boolean;
  maxGroupSize: number | null;
  registrationFields: EventRegistrationField[];
};

export type EditorRegistrationFieldInput = {
  id?: number;
  clientKey: string;
  label: string;
  fieldType: string;
  scope: string;
  required: boolean;
  options: string;
  sortOrder: number;
};

function previewFieldId(field: EditorRegistrationFieldInput, index: number): number {
  if (field.id != null) return field.id;
  if (field.clientKey.startsWith('field-')) {
    const parsed = Number.parseInt(field.clientKey.slice('field-'.length), 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return -(index + 1);
}

export function editorRegistrationFieldsToPreviewFields(
  fields: EditorRegistrationFieldInput[],
): EventRegistrationField[] {
  return fields.map((field, index) => ({
    id: previewFieldId(field, index),
    label: field.label,
    field_type: field.fieldType,
    scope: field.scope,
    required: field.required ? 1 : 0,
    options: field.options || null,
    sort_order: index,
  }));
}

/** Store draft snapshot for a new tab; returns the storage token for the preview URL, or null if storage failed. */
export function storeEventRegistrationPreview(
  payload: Omit<EventRegistrationPreviewPayloadV1, 'v'>,
): string | null {
  const k = crypto.randomUUID();
  const full: EventRegistrationPreviewPayloadV1 = { v: 1, ...payload };
  try {
    localStorage.setItem(`${EVENT_REGISTRATION_PREVIEW_STORAGE_PREFIX}${k}`, JSON.stringify(full));
    return k;
  } catch {
    return null;
  }
}

/** In-memory cache so React Strict Mode remounts still see the payload after localStorage is cleared. */
const previewHydrated = new Map<string, EventRegistrationPreviewPayloadV1>();

/**
 * Read preview payload once from localStorage, then from memory on remount (e.g. Strict Mode).
 * Removes the localStorage entry after first successful read so the URL is single-use.
 */
export function readEventRegistrationPreviewOnce(key: string): EventRegistrationPreviewPayloadV1 | null {
  const cached = previewHydrated.get(key);
  if (cached) return cached;

  const storageKey = `${EVENT_REGISTRATION_PREVIEW_STORAGE_PREFIX}${key}`;
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(storageKey);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as EventRegistrationPreviewPayloadV1;
    if (parsed?.v !== 1) return null;
    if (typeof parsed.title !== 'string') return null;
    if (!Array.isArray(parsed.registrationFields)) return null;
    try {
      localStorage.removeItem(storageKey);
    } catch {
      /* ignore */
    }
    previewHydrated.set(key, parsed);
    return parsed;
  } catch {
    return null;
  }
}
