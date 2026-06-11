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

export function isAllowedFrontendBaseUrl(candidate: string): boolean {
  const normalized = normalizeFrontendBaseUrl(candidate);
  const allowed = configuredFrontendBaseUrls();
  if (allowed.includes(normalized)) return true;

  const candidateHost = hostnameFromBaseUrl(normalized);
  if (!candidateHost) return false;

  for (const base of allowed) {
    const baseHost = hostnameFromBaseUrl(base);
    if (!baseHost) continue;
    if (candidateHost === baseHost) return true;
    if (candidateHost.endsWith(`.${baseHost}`)) return true;
  }

  return false;
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
