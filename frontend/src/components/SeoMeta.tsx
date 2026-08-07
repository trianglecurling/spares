import { useEffect } from 'react';
import { useSiteBranding } from '../hooks/useSiteBranding';

type JsonLdRecord = Record<string, unknown>;

interface SeoMetaProps {
  /** Full document title, or a page title that will be normalized against the site name. */
  title: string;
  description?: string;
  canonicalPath?: string;
  ogType?: 'website' | 'article';
  jsonLd?: JsonLdRecord | null;
}

export const DEFAULT_SITE_NAME = 'Triangle Curling';

export const DEFAULT_DESCRIPTION =
  'Triangle Curling Club in the Raleigh, Durham, and Chapel Hill area offers learn-to-curl, league play, bonspiels, and group events.';

const LEGACY_SITE_NAME = 'Triangle Curling Club';

export function resolveSiteName(clubName: string | null | undefined): string {
  const trimmed = clubName?.trim();
  return trimmed || DEFAULT_SITE_NAME;
}

export function formatDocumentTitle(pageTitle: string, siteName: string): string {
  const page = pageTitle.trim();
  const site = siteName.trim() || DEFAULT_SITE_NAME;
  if (!page) return site;
  if (page === site) return page;
  // Already a composed title (e.g. home marketing title or legacy-normalized suffix).
  if (page.includes(' | ')) return page;
  return `${page} | ${site}`;
}

export function formatHomeDocumentTitle(siteName: string): string {
  const site = siteName.trim() || DEFAULT_SITE_NAME;
  return `${site} | Curling in the Triangle`;
}

/** Normalize titles that still hardcode the legacy club suffix/prefix. */
export function normalizeDocumentTitle(title: string, siteName: string): string {
  const site = siteName.trim() || DEFAULT_SITE_NAME;
  let next = title.trim();
  const legacySuffix = ` | ${LEGACY_SITE_NAME}`;
  if (next.endsWith(legacySuffix)) {
    next = `${next.slice(0, -legacySuffix.length)} | ${site}`;
  } else if (next.startsWith(`${LEGACY_SITE_NAME} |`)) {
    next = `${site}${next.slice(LEGACY_SITE_NAME.length)}`;
  } else if (next === LEGACY_SITE_NAME) {
    next = site;
  }
  return next;
}

function upsertMetaTag(attrName: 'name' | 'property', attrValue: string, content: string): void {
  let tag = document.head.querySelector<HTMLMetaElement>(`meta[${attrName}="${attrValue}"]`);
  if (!tag) {
    tag = document.createElement('meta');
    tag.setAttribute(attrName, attrValue);
    document.head.appendChild(tag);
  }
  tag.setAttribute('content', content);
}

function upsertLinkTag(rel: string, href: string): void {
  let tag = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!tag) {
    tag = document.createElement('link');
    tag.setAttribute('rel', rel);
    document.head.appendChild(tag);
  }
  tag.setAttribute('href', href);
}

export default function SeoMeta({
  title,
  description = DEFAULT_DESCRIPTION,
  canonicalPath,
  ogType = 'website',
  jsonLd,
}: SeoMetaProps) {
  const { branding } = useSiteBranding();
  const siteName = resolveSiteName(branding?.clubName);
  const documentTitle = formatDocumentTitle(normalizeDocumentTitle(title, siteName), siteName);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = documentTitle;

    upsertMetaTag('name', 'description', description);
    upsertMetaTag('property', 'og:title', documentTitle);
    upsertMetaTag('property', 'og:description', description);
    upsertMetaTag('property', 'og:type', ogType);
    upsertMetaTag('property', 'og:site_name', siteName);
    upsertMetaTag('name', 'twitter:card', 'summary_large_image');
    upsertMetaTag('name', 'twitter:title', documentTitle);
    upsertMetaTag('name', 'twitter:description', description);

    if (canonicalPath && typeof window !== 'undefined') {
      const canonicalUrl = new URL(canonicalPath, window.location.origin).toString();
      upsertLinkTag('canonical', canonicalUrl);
      upsertMetaTag('property', 'og:url', canonicalUrl);
    }

    let jsonLdScript: HTMLScriptElement | null = null;
    if (jsonLd) {
      jsonLdScript = document.createElement('script');
      jsonLdScript.type = 'application/ld+json';
      jsonLdScript.setAttribute('data-seo-jsonld', 'true');
      jsonLdScript.text = JSON.stringify(jsonLd);
      document.head.appendChild(jsonLdScript);
    }

    return () => {
      document.title = previousTitle;
      if (jsonLdScript) {
        jsonLdScript.remove();
      }
    };
  }, [canonicalPath, description, documentTitle, jsonLd, ogType, siteName]);

  return null;
}
