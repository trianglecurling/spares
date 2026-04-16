import { config } from '../config.js';

const FIND_SQL_PATH = '/api/openapiv2/waivers/findSQL';

type CleverFindResponse = {
  action?: string;
  result?: boolean;
  success?: unknown;
  failed?: string;
};

export function normalizeFindRows(success: unknown): unknown[] {
  if (!success) return [];
  if (Array.isArray(success)) return success;
  if (typeof success === 'object' && success !== null && 'waiverDictList' in success) {
    const list = (success as { waiverDictList?: unknown }).waiverDictList;
    return Array.isArray(list) ? list : [];
  }
  return [];
}

export function waiverIdFromRow(row: unknown): string | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  const id = r.waiver_id ?? r.waiverId;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

export function signedDateFromRow(row: unknown): string | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  const d = r.signedDate ?? r.signed_date;
  if (typeof d === 'string') return d;
  if (typeof d === 'number') return new Date(d).toISOString();
  return null;
}

export async function cleverWaiverFindSQL(
  params: Record<string, unknown>
): Promise<{ ok: boolean; rows: unknown[]; message?: string }> {
  const token = config.cleverWaiver.accessToken?.trim();
  if (!token) {
    return { ok: false, rows: [], message: 'CleverWaiver is not configured (missing access token).' };
  }

  const url = `${config.cleverWaiver.baseUrl}${FIND_SQL_PATH}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: token,
  };
  const appName = config.cleverWaiver.appName?.trim();
  const clientId = config.cleverWaiver.clientId?.trim();
  if (appName) headers['X-App-Name'] = appName;
  if (clientId) headers['X-Client-Id'] = clientId;

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(params),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Network error';
    return { ok: false, rows: [], message: `CleverWaiver request failed: ${msg}` };
  }

  const text = await response.text();
  let json: unknown;
  try {
    json = JSON.parse(text) as CleverFindResponse;
  } catch {
    return {
      ok: false,
      rows: [],
      message: `CleverWaiver returned a non-JSON response (HTTP ${response.status}).`,
    };
  }

  if (!response.ok) {
    const failed = typeof json === 'object' && json !== null && 'failed' in json ? String((json as CleverFindResponse).failed ?? '') : '';
    return {
      ok: false,
      rows: [],
      message: failed || `CleverWaiver returned HTTP ${response.status}.`,
    };
  }

  if (typeof json !== 'object' || json === null) {
    return { ok: false, rows: [], message: 'CleverWaiver returned an unexpected payload.' };
  }

  const body = json as CleverFindResponse;
  if (body.result === false) {
    return {
      ok: false,
      rows: [],
      message: body.failed || 'CleverWaiver reported an error for this search.',
    };
  }

  return { ok: true, rows: normalizeFindRows(body.success) };
}

export async function cleverWaiverGetWaiver(waiverId: string): Promise<{ ok: boolean; data?: unknown; message?: string }> {
  const token = config.cleverWaiver.accessToken?.trim();
  if (!token) {
    return { ok: false, message: 'CleverWaiver is not configured (missing access token).' };
  }

  const url = `${config.cleverWaiver.baseUrl}/api/openapiv2/waivers/${encodeURIComponent(waiverId)}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: token,
  };
  const appName = config.cleverWaiver.appName?.trim();
  const clientId = config.cleverWaiver.clientId?.trim();
  if (appName) headers['X-App-Name'] = appName;
  if (clientId) headers['X-Client-Id'] = clientId;

  let response: Response;
  try {
    response = await fetch(url, { headers });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Network error';
    return { ok: false, message: msg };
  }

  const text = await response.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, message: `Non-JSON response (HTTP ${response.status})` };
  }

  if (!response.ok) {
    const failed =
      typeof json === 'object' && json !== null && 'failed' in json
        ? String((json as { failed?: unknown }).failed ?? '')
        : '';
    return { ok: false, message: failed || `HTTP ${response.status}` };
  }

  if (typeof json === 'object' && json !== null && 'success' in json && 'result' in json) {
    const body = json as { result?: boolean; success?: unknown; failed?: string };
    if (body.result === false) {
      return { ok: false, message: body.failed || 'CleverWaiver reported an error loading this waiver.' };
    }
    return { ok: true, data: body.success };
  }

  return { ok: true, data: json };
}

export function collectWaiverDetailStrings(obj: unknown, out: Map<string, string>, prefix = ''): void {
  if (obj === null || obj === undefined) return;
  if (typeof obj === 'string') {
    if (prefix) out.set(prefix, obj);
    return;
  }
  if (typeof obj !== 'object') return;
  if (Array.isArray(obj)) {
    obj.forEach((item, i) => collectWaiverDetailStrings(item, out, `${prefix}[${i}]`));
    return;
  }
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out.set(p, v);
    else if (v && typeof v === 'object') collectWaiverDetailStrings(v, out, p);
  }
}

function normalizeCompare(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '');
}

function splitFullNameForMatch(full: string): { firstName: string; lastName: string } {
  const t = full.trim();
  if (!t) return { firstName: '', lastName: '' };
  const parts = t.split(/\s+/);
  if (parts.length === 1) return { firstName: '', lastName: parts[0] };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

/**
 * CleverWaiver minor waivers use `allNames` like "Parent First Last,Minor First Last".
 * The last comma-separated segment is the participant (minor); the first is the parent/guardian.
 */
export function parseAllNamesFromDetail(detail: unknown): { participant: string; guardian: string | null } {
  if (!detail || typeof detail !== 'object') return { participant: '', guardian: null };
  const raw = (detail as Record<string, unknown>).allNames;
  if (typeof raw !== 'string' || !raw.trim()) return { participant: '', guardian: null };
  const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return { participant: '', guardian: null };
  return {
    participant: parts[parts.length - 1]!,
    guardian: parts.length > 1 ? parts[0]! : null,
  };
}

export function minorAgeFromCleverDetail(detail: unknown): number | null {
  if (!detail || typeof detail !== 'object') return null;
  const add = (detail as Record<string, unknown>).Additionals;
  if (!Array.isArray(add)) return null;
  for (const item of add) {
    if (!item || typeof item !== 'object') continue;
    const a = item as { type?: string; value?: unknown };
    if (a.type !== 'number') continue;
    const n = typeof a.value === 'number' ? a.value : Number(a.value);
    if (Number.isInteger(n) && n >= 1 && n <= 17) return n;
  }
  return null;
}

function buildParticipantDisplayLabel(
  participant: string,
  guardian: string | null,
  age: number | null
): string | null {
  const p = participant.trim();
  if (!p) return null;
  const bits: string[] = [];
  if (age !== null) bits.push(`age: ${age}`);
  if (guardian) bits.push(`parent/guardian: ${guardian}`);
  if (bits.length === 0) return p;
  return `${p} (${bits.join(', ')})`;
}

export function scoreFirstNameMatch(expected: string | undefined, detail: unknown): number {
  if (!expected?.trim()) return 0;
  const target = normalizeCompare(expected);
  if (!target) return 0;

  let { participant } = parseAllNamesFromDetail(detail);
  if (!participant.trim() && detail && typeof detail === 'object') {
    const name = (detail as Record<string, unknown>).name;
    if (typeof name === 'string' && name.trim()) participant = name.trim();
  }

  if (participant.trim()) {
    const { firstName } = splitFullNameForMatch(participant);
    const cand = normalizeCompare(firstName);
    if (!cand) {
      // single token treated as last name only — compare to last name match path elsewhere
      return 0;
    }
    if (cand === target) return 100;
    if (cand.includes(target) || target.includes(cand)) return 75;
    if (cand[0] === target[0]) return 35;
    return 0;
  }

  const map = new Map<string, string>();
  collectWaiverDetailStrings(detail, map);
  let best = 0;
  for (const [path, val] of map) {
    if (!/(^|\.)first(Name|_name)?$/i.test(path) && !/first_name$/i.test(path)) continue;
    const cand = normalizeCompare(val);
    if (!cand) continue;
    if (cand === target) best = Math.max(best, 100);
    else if (cand.includes(target) || target.includes(cand)) best = Math.max(best, 75);
    else if (cand[0] === target[0]) best = Math.max(best, 35);
  }
  return best;
}

export type WaiverDisplayFields = {
  fullName: string | null;
  email: string | null;
  signedDate: string | null;
  isMinor: boolean | null;
  minorAge: number | null;
  extraLines: string[];
};

export function summarizeWaiverDetail(detail: unknown, findRow?: unknown): WaiverDisplayFields {
  const map = new Map<string, string>();
  collectWaiverDetailStrings(detail, map);

  let email: string | null = null;
  let signedDate: string | null = signedDateFromRow(findRow);
  let isMinor: boolean | null = null;
  const extraLines: string[] = [];

  const minorAge = minorAgeFromCleverDetail(detail);
  const { participant: participantFromAllNames, guardian } = parseAllNamesFromDetail(detail);

  let showMinorTemplate: boolean | null = null;
  if (detail && typeof detail === 'object' && 'showMinorTemplate' in detail) {
    const v = (detail as Record<string, unknown>).showMinorTemplate;
    if (typeof v === 'boolean') showMinorTemplate = v;
  }

  const jsonLower = JSON.stringify(detail).toLowerCase();

  for (const [path, val] of map) {
    const pl = path.toLowerCase();
    if (!email && pl.includes('email') && val.includes('@')) {
      email = val;
    }
    if (!signedDate && /signed|submit|completed|date/i.test(pl) && /\d{4}/.test(val)) {
      signedDate = val;
    }
    if (isMinor === null && /minor|guardian|parent/i.test(pl)) {
      const v = val.toLowerCase();
      if (v === 'true' || v === 'yes' || v === '1') isMinor = true;
    }
  }

  if (detail && typeof detail === 'object') {
    const topEmail = (detail as Record<string, unknown>).email;
    if (!email && typeof topEmail === 'string' && topEmail.includes('@')) email = topEmail;
    if (!signedDate && typeof (detail as Record<string, unknown>).signedDate === 'string') {
      signedDate = (detail as Record<string, unknown>).signedDate as string;
    }
  }

  let participant = participantFromAllNames.trim();
  if (!participant && detail && typeof detail === 'object') {
    const name = (detail as Record<string, unknown>).name;
    if (typeof name === 'string' && name.trim()) participant = name.trim();
  }

  let fullName: string | null = buildParticipantDisplayLabel(participant, guardian, minorAge);

  if (!fullName) {
    let fallback: string | null = null;
    for (const [path, val] of map) {
      const pl = path.toLowerCase();
      if (!fallback && /(fullname|^name$|participantname|customer\.name)/i.test(pl)) {
        fallback = val;
      }
    }
    const first = [...map.entries()].find(([p]) => /first(name|_name)?$/i.test(p))?.[1];
    const last = [...map.entries()].find(([p]) => /last(name|_name)?$/i.test(p))?.[1];
    if (!fallback && first && last) fallback = `${first} ${last}`.trim();
    if (!fallback && first) fallback = first;
    fullName = fallback ? buildParticipantDisplayLabel(fallback, null, minorAge) : null;
  }

  if (guardian !== null || minorAge !== null) {
    isMinor = true;
  } else if (showMinorTemplate === true) {
    isMinor = true;
  } else if (showMinorTemplate === false) {
    isMinor = false;
  } else if (isMinor === null) {
    if (/\bminor\b/i.test(jsonLower) && /(guardian|parent|under\s*18)/i.test(jsonLower)) {
      isMinor = true;
    } else if (/\bminor\b/i.test(jsonLower)) {
      isMinor = true;
    }
  }

  for (const [path, val] of map) {
    if (val.length > 80) continue;
    if (/phone|serial|external|template|ref|id/i.test(path) && !/email/i.test(path)) continue;
    if (path === 'header') continue;
    extraLines.push(`${path}: ${val}`);
  }
  extraLines.sort();
  if (extraLines.length > 12) extraLines.length = 12;

  return { fullName, email, signedDate, isMinor, minorAge, extraLines };
}
