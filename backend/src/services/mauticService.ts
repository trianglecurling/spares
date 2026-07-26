import { config } from '../config.js';

let oauthTokenCache: { accessToken: string; expiresAtMs: number } | null = null;

function mauticOrigin(): string {
  return config.mautic.baseUrl.replace(/\/$/, '');
}

function hasOAuthCredentials(): boolean {
  return Boolean(config.mautic.oauthClientId && config.mautic.oauthClientSecret);
}

/** True when Mautic can subscribe contacts to a segment (base URL, auth, and segment id are set). */
export function isMauticSubscribeAvailableForSegment(segmentId: number): boolean {
  if (!mauticOrigin()) return false;
  if (!hasOAuthCredentials()) return false;
  return segmentId > 0;
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

export async function findContactIdByEmail(email: string): Promise<number | null> {
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

/** True when Mautic base URL and OAuth2 client credentials are configured. */
export function isMauticConfigured(): boolean {
  return Boolean(mauticOrigin() && hasOAuthCredentials());
}

function extractSegmentId(payload: unknown): number | null {
  if (payload == null || typeof payload !== 'object') return null;
  const o = payload as Record<string, unknown>;
  const list = o.list;
  if (list != null && typeof list === 'object') {
    const lo = list as Record<string, unknown>;
    if (typeof lo.id === 'number') return lo.id;
  }
  if (typeof o.id === 'number') return o.id;
  return null;
}

function extractSegmentAlias(payload: unknown): string | null {
  if (payload == null || typeof payload !== 'object') return null;
  const o = payload as Record<string, unknown>;
  const list = o.list;
  if (list != null && typeof list === 'object') {
    const lo = list as Record<string, unknown>;
    if (typeof lo.alias === 'string' && lo.alias.trim()) return lo.alias.trim();
  }
  if (typeof o.alias === 'string' && o.alias.trim()) return o.alias.trim();
  return null;
}

function extractContactEmail(contact: Record<string, unknown>): string | null {
  const fields = contact.fields;
  if (fields != null && typeof fields === 'object') {
    const f = fields as Record<string, unknown>;
    const core = f.core;
    if (core != null && typeof core === 'object') {
      const emailField = (core as Record<string, unknown>).email;
      if (emailField != null && typeof emailField === 'object') {
        const value = (emailField as { value?: unknown }).value;
        if (typeof value === 'string' && value.trim()) return value.trim().toLowerCase();
      }
    }
    const all = f.all;
    if (all != null && typeof all === 'object') {
      const email = (all as Record<string, unknown>).email;
      if (typeof email === 'string' && email.trim()) return email.trim().toLowerCase();
    }
  }
  if (typeof contact.email === 'string' && contact.email.trim()) {
    return contact.email.trim().toLowerCase();
  }
  return null;
}

export async function createMauticSegment(name: string): Promise<number> {
  const json = await mauticRequestJson('/segments/new', {
    method: 'POST',
    body: JSON.stringify({ name, isPublished: true }),
  });
  const id = extractSegmentId(json);
  if (id == null) {
    throw new MauticRequestError('Mautic did not return a segment id', 500, String(json));
  }
  return id;
}

export async function renameMauticSegment(segmentId: number, name: string): Promise<void> {
  await mauticRequestJson(`/segments/${segmentId}/edit`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  });
}

export async function getMauticSegmentAlias(segmentId: number): Promise<string | null> {
  try {
    const json = await mauticRequestJson(`/segments/${segmentId}`, { method: 'GET' });
    return extractSegmentAlias(json);
  } catch (e) {
    if (e instanceof MauticRequestError && e.statusCode === 404) return null;
    throw e;
  }
}

export async function removeContactFromSegment(segmentId: number, contactId: number): Promise<void> {
  await mauticRequestJson(`/segments/${segmentId}/contact/${contactId}/remove`, {
    method: 'POST',
  });
}

export async function findOrCreateContactByEmail(
  email: string,
  firstname: string,
  lastname: string
): Promise<number> {
  const emailNorm = email.trim().toLowerCase();
  const existing = await findContactIdByEmail(emailNorm);
  if (existing != null) return existing;
  return createContact(firstname, lastname, emailNorm);
}

export async function updateMauticContact(
  contactId: number,
  fields: { email?: string; firstname?: string; lastname?: string }
): Promise<void> {
  const payload: Record<string, string> = {};
  if (fields.email != null) payload.email = fields.email.trim().toLowerCase();
  if (fields.firstname != null) payload.firstname = fields.firstname;
  if (fields.lastname != null) payload.lastname = fields.lastname;
  if (Object.keys(payload).length === 0) return;
  await mauticRequestJson(`/contacts/${contactId}/edit`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function addContactToMauticSegment(segmentId: number, contactId: number): Promise<void> {
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

export type MauticSegmentContact = { id: number; email: string };

export async function listSegmentContacts(segmentId: number): Promise<MauticSegmentContact[]> {
  const alias = await getMauticSegmentAlias(segmentId);
  if (!alias) {
    throw new MauticRequestError(`Mautic segment ${segmentId} not found or has no alias`, 404, '');
  }

  const results: MauticSegmentContact[] = [];
  const limit = 100;
  let start = 0;

  for (;;) {
    const path = `/contacts?search=${encodeURIComponent(`segment:${alias}`)}&start=${start}&limit=${limit}`;
    const json = await mauticRequestJson(path, { method: 'GET' });
    if (json == null || typeof json !== 'object') break;
    const o = json as Record<string, unknown>;
    const contacts = o.contacts;
    if (contacts == null || typeof contacts !== 'object') break;

    const batch = Object.values(contacts as Record<string, unknown>);
    if (batch.length === 0) break;

    for (const value of batch) {
      if (value == null || typeof value !== 'object') continue;
      const c = value as Record<string, unknown>;
      if (typeof c.id !== 'number') continue;
      const email = extractContactEmail(c);
      if (!email) continue;
      results.push({ id: c.id, email });
    }

    if (batch.length < limit) break;
    start += limit;
  }

  return results;
}

export async function sendMauticEmailToContact(emailId: number, contactId: number): Promise<void> {
  if (emailId <= 0) {
    throw new Error('Mautic email id is not configured');
  }
  await mauticRequestJson(`/emails/${emailId}/contact/${contactId}/send`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export type MailingListSubscribeResult = {
  contactId: number;
  newlyAddedToSegment: boolean;
};

export async function subscribeToMailingListSegment(input: {
  segmentId: number;
  fullName: string;
  email: string;
}): Promise<MailingListSubscribeResult> {
  const { firstname, lastname } = splitFirstLast(input.fullName);
  if (!firstname.trim() || !input.email.trim()) {
    throw new Error('Name and email are required');
  }

  const segmentId = input.segmentId;
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
    return { contactId, newlyAddedToSegment: true };
  } catch (e) {
    if (e instanceof MauticRequestError && e.statusCode === 400) {
      const message = (e.message || '').toLowerCase();
      if (message.includes('already') || message.includes('member')) {
        return { contactId, newlyAddedToSegment: false };
      }
    }
    throw e;
  }
}
