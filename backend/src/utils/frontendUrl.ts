import type { FastifyRequest } from 'fastify';
import { config } from '../config.js';

export function normalizeFrontendBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

function headerValue(value: string | string[] | undefined): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (Array.isArray(value) && typeof value[0] === 'string') {
    const trimmed = value[0].trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  return null;
}

function originFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return null;
  }
}

export function frontendOriginFromRequestHeaders(
  headers: Record<string, string | string[] | undefined>
): string | null {
  const origin = headerValue(headers.origin);
  if (origin) {
    return originFromUrl(origin);
  }

  const referer = headerValue(headers.referer) ?? headerValue(headers.referrer);
  if (referer) {
    return originFromUrl(referer);
  }

  const forwardedHost = headerValue(headers['x-forwarded-host']);
  if (forwardedHost) {
    const host = forwardedHost.split(',')[0]?.trim();
    if (!host) return null;
    const forwardedProto = headerValue(headers['x-forwarded-proto']);
    const proto = forwardedProto?.split(',')[0]?.trim() || 'https';
    return originFromUrl(`${proto}://${host}`);
  }

  return null;
}

function configuredFrontendBaseUrls(): string[] {
  const urls = [config.frontendUrl, ...config.frontendUrlAliases];
  if (config.payment.webhookBaseUrl) {
    urls.push(config.payment.webhookBaseUrl);
  }
  return urls.map(normalizeFrontendBaseUrl).filter(Boolean);
}

function hostnameFromBaseUrl(baseUrl: string): string | null {
  try {
    return new URL(baseUrl).hostname;
  } catch {
    return null;
  }
}

export function isLoopbackFrontendUrl(url: string): boolean {
  const host = hostnameFromBaseUrl(url)?.toLowerCase();
  if (!host) return true;
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.localhost');
}

function isHttpsPublicUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && !isLoopbackFrontendUrl(url);
  } catch {
    return false;
  }
}

function isAllowedAgainst(candidate: string, allowedBases: string[]): boolean {
  const normalized = normalizeFrontendBaseUrl(candidate);
  if (allowedBases.includes(normalized)) return true;

  const candidateHost = hostnameFromBaseUrl(normalized);
  if (!candidateHost) return false;

  for (const base of allowedBases) {
    const baseHost = hostnameFromBaseUrl(base);
    if (!baseHost) continue;
    if (candidateHost === baseHost) return true;
    if (candidateHost.endsWith(`.${baseHost}`)) return true;
  }

  return false;
}

export function isAllowedFrontendBaseUrl(candidate: string): boolean {
  return isAllowedAgainst(candidate, configuredFrontendBaseUrls());
}

function originFromHostHeader(
  headers: Record<string, string | string[] | undefined>
): string | null {
  const hostHeader = headerValue(headers.host);
  if (!hostHeader) return null;
  const host = hostHeader.split(',')[0]?.trim();
  if (!host) return null;
  const forwardedProto = headerValue(headers['x-forwarded-proto']);
  const proto = forwardedProto?.split(',')[0]?.trim() || (isLoopbackFrontendUrl(`http://${host}`) ? 'http' : 'https');
  return originFromUrl(`${proto}://${host}`);
}

export function pickPublicFrontendBaseUrl(input: {
  configured: string;
  aliases?: string[];
  webhookBaseUrl?: string;
  remembered?: string | null;
  requestHeaders?: Record<string, string | string[] | undefined> | null;
}): string {
  const configured = normalizeFrontendBaseUrl(input.configured);
  const aliases = (input.aliases ?? []).map(normalizeFrontendBaseUrl).filter(Boolean);
  const webhook = normalizeFrontendBaseUrl(input.webhookBaseUrl ?? '');
  const remembered = input.remembered ? normalizeFrontendBaseUrl(input.remembered) : '';
  const allowedBases = [configured, ...aliases, webhook].filter(Boolean);

  const requestOrigin = input.requestHeaders
    ? frontendOriginFromRequestHeaders(input.requestHeaders) ?? originFromHostHeader(input.requestHeaders)
    : null;

  const candidates: string[] = [];

  if (requestOrigin) {
    const normalizedRequest = normalizeFrontendBaseUrl(requestOrigin);
    const allowed =
      isAllowedAgainst(normalizedRequest, allowedBases) ||
      (isLoopbackFrontendUrl(configured) && isHttpsPublicUrl(normalizedRequest));
    if (allowed) candidates.push(normalizedRequest);
  }

  if (remembered && !isLoopbackFrontendUrl(remembered)) candidates.push(remembered);
  if (!isLoopbackFrontendUrl(configured)) candidates.push(configured);
  for (const alias of aliases) {
    if (!isLoopbackFrontendUrl(alias)) candidates.push(alias);
  }
  if (webhook && !isLoopbackFrontendUrl(webhook)) candidates.push(webhook);
  candidates.push(configured);

  return candidates[0] ?? configured;
}

let rememberedPublicFrontendBaseUrl: string | null = null;

export function rememberPublicFrontendBaseUrlFromRequest(
  request: Pick<FastifyRequest, 'headers'>
): void {
  const picked = pickPublicFrontendBaseUrl({
    configured: config.frontendUrl,
    aliases: config.frontendUrlAliases,
    webhookBaseUrl: config.payment.webhookBaseUrl,
    requestHeaders: request.headers,
  });
  if (!isLoopbackFrontendUrl(picked)) {
    rememberedPublicFrontendBaseUrl = picked;
  }
}

export function resolveFrontendBaseUrl(request?: Pick<FastifyRequest, 'headers'> | null): string {
  const fallback = normalizeFrontendBaseUrl(config.frontendUrl);
  if (!request?.headers) return fallback;

  const candidate = frontendOriginFromRequestHeaders(request.headers);
  if (candidate && isAllowedFrontendBaseUrl(candidate)) {
    return normalizeFrontendBaseUrl(candidate);
  }

  return fallback;
}

/** Public site origin for links in outbound email/SMS. Never prefers localhost when a real origin is known. */
export function publicFrontendBaseUrl(request?: Pick<FastifyRequest, 'headers'> | null): string {
  return pickPublicFrontendBaseUrl({
    configured: config.frontendUrl,
    aliases: config.frontendUrlAliases,
    webhookBaseUrl: config.payment.webhookBaseUrl,
    remembered: rememberedPublicFrontendBaseUrl,
    requestHeaders: request?.headers ?? null,
  });
}

export function absoluteFrontendUrl(
  pathAndSearch: string,
  request?: Pick<FastifyRequest, 'headers'> | null
): string {
  const base = publicFrontendBaseUrl(request);
  const path = pathAndSearch.startsWith('/') ? pathAndSearch : `/${pathAndSearch}`;
  return `${base}${path}`;
}
