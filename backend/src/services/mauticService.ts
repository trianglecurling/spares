import { config } from '../config.js';

export type MailingListKey = 'bonspiels' | 'membership' | 'learn-to-curl';

let oauthTokenCache: { accessToken: string; expiresAtMs: number } | null = null;

function mauticOrigin(): string {
  return config.mautic.baseUrl.replace(/\/$/, '');
}

function hasOAuthCredentials(): boolean {
  return Boolean(config.mautic.oauthClientId && config.mautic.oauthClientSecret);
}

/** True when the given list can be subscribed to (base URL, auth, and that segment’s numeric id are set). */
export function isMauticSubscribeAvailableForList(list: MailingListKey): boolean {
  if (!mauticOrigin()) return false;
  if (!hasOAuthCredentials()) return false;
  return segmentIdForList(list) > 0;
}

function segmentIdForList(list: MailingListKey): number {
  if (list === 'bonspiels') return config.mautic.segmentIds.bonspiels;
  if (list === 'membership') return config.mautic.segmentIds.membership;
  return config.mautic.segmentIds.learnToCurl;
}

function splitFirstLast(fullName: string): { firstname: string; lastname: string } {
  const t = fullName.replace(/\s+/g, ' ').trim();
  if (!t) {
    return { firstname: '', lastname: '' };
  }
  const parts = t.split(' ');
  if (parts.length === 1) {
    return { firstname: parts[0], lastname: '' };
  }
  return { firstname: parts[0], lastname: parts.slice(1).join(' ') };
}

async function getMauticAuthHeader(): Promise<string> {
  if (!hasOAuthCredentials()) {
    throw new Error('Mautic is not configured with OAuth2 client credentials');
  }

  const now = Date.now();
  if (oauthTokenCache && oauthTokenCache.expiresAtMs > now + 15_000) {
    return `Bearer ${oauthTokenCache.accessToken}`;
  }

  const tokenUrl = `${mauticOrigin()}/oauth/v2/token`;
  const body = new URLSearchParams();
  body.set('grant_type', 'client_credentials');
  body.set('client_id', config.mautic.oauthClientId);
  body.set('client_secret', config.mautic.oauthClientSecret);

  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  const text = await res.text();

  if (!res.ok) {
    const hint404 =
      res.status === 404
        ? ` That usually means MAUTIC_BASE_URL is wrong: use the full base URL of your Mautic web app, including any path prefix (for example https://example.com/mautic if Mautic is not at the domain root). Requested URL: ${tokenUrl}.`
        : '';
    throw new MauticRequestError(
      `Mautic OAuth2 token request failed (HTTP ${res.status}).${hint404}`,
      res.status,
      text
    );
  }

  let json: { access_token?: string; expires_in?: number; error?: string; message?: string };
  try {
    json = JSON.parse(text) as typeof json;
  } catch {
    throw new MauticRequestError(
      `Mautic OAuth2 token response was not valid JSON (requested ${tokenUrl}). Check MAUTIC_BASE_URL and that you are reaching Mautic, not another app.`,
      res.status,
      text
    );
  }

  if (!json.access_token) {
    throw new MauticRequestError(
      `Mautic OAuth2 error: ${json.error || json.message || 'response missing access_token'}`,
      res.status,
      text
    );
  }

  const expiresIn = typeof json.expires_in === 'number' && json.expires_in > 0 ? json.expires_in : 3600;
  oauthTokenCache = { accessToken: json.access_token, expiresAtMs: now + expiresIn * 1000 };
  return `Bearer ${json.access_token}`;
}

export class MauticRequestError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly responseBody: string
  ) {
    super(message);
    this.name = 'MauticRequestError';
  }
}

function extractContactId(payload: unknown): number | null {
  if (payload == null || typeof payload !== 'object') return null;
  const o = payload as Record<string, unknown>;
  const c = o.contact;
  if (c != null && typeof c === 'object') {
    const co = c as Record<string, unknown>;
    if (typeof co.id === 'number') return co.id;
    const inner = co.contact;
    if (inner != null && typeof inner === 'object' && typeof (inner as { id?: unknown }).id === 'number') {
      return (inner as { id: number }).id;
    }
  }
  return null;
}

function extractFirstContactIdFromList(payload: unknown): number | null {
  if (payload == null || typeof payload !== 'object') return null;
  const o = payload as Record<string, unknown>;
  const total = o.total;
  if (total === '0' || total === 0) return null;
  const contacts = o.contacts;
  if (contacts == null || typeof contacts !== 'object') return null;
  for (const value of Object.values(contacts as Record<string, unknown>)) {
    if (value != null && typeof value === 'object' && 'id' in (value as object)) {
      const id = (value as { id: unknown }).id;
      if (typeof id === 'number') return id;
    }
  }
  return null;
}

type MauticFetchInit = {
  method?: string;
  headers?: Record<string, string>;
  body?: string | null;
  parseJson?: boolean;
};

async function mauticRequestJson(
  path: string,
  init: MauticFetchInit = {}
): Promise<unknown> {
  const { parseJson = true, method, body, headers: initHeaders } = init;
  const url = `${mauticOrigin()}/api${path.startsWith('/') ? path : `/${path}`}`;
  const headers = new Headers(initHeaders);
  if (!headers.has('Authorization')) {
    headers.set('Authorization', await getMauticAuthHeader());
  }
  if (body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(url, { method, body: body ?? undefined, headers });
  const text = await res.text();
  if (!parseJson) {
    if (!res.ok) {
      throw new MauticRequestError(`Mautic API error: ${res.statusText}`, res.status, text);
    }
    return text;
  }
  if (!text) {
    if (!res.ok) {
      throw new MauticRequestError(`Mautic API error: ${res.statusText}`, res.status, text);
    }
    return {};
  }
  let json: unknown;
  try {
    json = JSON.parse(text) as unknown;
  } catch {
    throw new MauticRequestError('Invalid JSON from Mautic', res.status, text);
  }
  if (!res.ok) {
    const errMsg =
      json != null && typeof json === 'object' && 'errors' in json
        ? JSON.stringify((json as { errors: unknown }).errors)
        : res.statusText;
    throw new MauticRequestError(`Mautic API: ${errMsg}`, res.status, text);
  }
  return json;
}

async function createContact(firstname: string, lastname: string, email: string): Promise<number> {
  const payload = {
    firstname,
    lastname,
    email,
  };
  const json = await mauticRequestJson('/contacts/new', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  const id = extractContactId(json);
  if (id == null) {
    throw new MauticRequestError('Mautic did not return a contact id', 500, String(json));
  }
  return id;
}

async function findContactIdByEmail(email: string): Promise<number | null> {
  const q = `email:${email}`;
  const path = `/contacts?search=${encodeURIComponent(q)}&limit=1`;
  const json = await mauticRequestJson(path, { method: 'GET' });
  return extractFirstContactIdFromList(json);
}

async function addContactToSegment(segmentId: number, contactId: number): Promise<void> {
  await mauticRequestJson(`/segments/${segmentId}/contact/${contactId}/add`, {
    method: 'POST',
  });
}

export async function subscribeToMailingList(input: {
  list: MailingListKey;
  fullName: string;
  email: string;
}): Promise<void> {
  const { firstname, lastname } = splitFirstLast(input.fullName);
  if (!firstname.trim() || !input.email.trim()) {
    throw new Error('Name and email are required');
  }

  const segmentId = segmentIdForList(input.list);
  if (segmentId <= 0) {
    throw new Error('This mailing list is not configured');
  }

  const emailNorm = input.email.trim().toLowerCase();
  let contactId: number;
  try {
    contactId = await createContact(firstname, lastname, emailNorm);
  } catch (e) {
    const found = await findContactIdByEmail(emailNorm);
    if (found != null) {
      contactId = found;
    } else {
      throw e;
    }
  }

  try {
    await addContactToSegment(segmentId, contactId);
  } catch (e) {
    if (e instanceof MauticRequestError && e.statusCode === 400) {
      const message = (e.message || '').toLowerCase();
      if (message.includes('already') || message.includes('member')) {
        return;
      }
    }
    throw e;
  }
}
