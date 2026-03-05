import { useEffect } from 'react';

type JsonLdRecord = Record<string, unknown>;

interface SeoMetaProps {
  title: string;
  description?: string;
  canonicalPath?: string;
  ogType?: 'website' | 'article';
  jsonLd?: JsonLdRecord | null;
}

const DEFAULT_DESCRIPTION =
  'Triangle Curling Club in the Raleigh, Durham, and Chapel Hill area offers learn-to-curl, league play, bonspiels, and group events.';

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
  useEffect(() => {
    const previousTitle = document.title;
    document.title = title;

    upsertMetaTag('name', 'description', description);
    upsertMetaTag('property', 'og:title', title);
    upsertMetaTag('property', 'og:description', description);
    upsertMetaTag('property', 'og:type', ogType);
    upsertMetaTag('property', 'og:site_name', 'Triangle Curling Club');
    upsertMetaTag('name', 'twitter:card', 'summary_large_image');
    upsertMetaTag('name', 'twitter:title', title);
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
  }, [canonicalPath, description, jsonLd, ogType, title]);

  return null;
}
