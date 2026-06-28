import type { ChoiceRenderableOption } from '../components/ChoiceInput';
import { buildContactPageLink } from '../constants/contactRecipients';
import {
  normalizePublicSystemPagePath,
  type PublicSystemPagePath,
} from '../constants/publicSystemPages';

export type MarkdownEditorLinkType =
  | 'published-article'
  | 'email-contact'
  | 'system-page'
  | 'custom-url';

export const MARKDOWN_EDITOR_LINK_TYPE_CHOICES: ChoiceRenderableOption<MarkdownEditorLinkType>[] = [
  { value: 'published-article', label: 'Published article' },
  { value: 'email-contact', label: 'Email contact' },
  { value: 'system-page', label: 'System page' },
  { value: 'custom-url', label: 'Custom URL' },
];

export type InferredMarkdownEditorLinkTarget = {
  linkType: MarkdownEditorLinkType;
  articleSlug: string | null;
  contactRecipient: string | null;
  systemPagePath: PublicSystemPagePath | null;
  customUrl: string;
};

function parseEditorLinkUrl(raw: string): { pathname: string; searchParams: URLSearchParams; hash: string } {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { pathname: '', searchParams: new URLSearchParams(), hash: '' };
  }

  try {
    const url = new URL(trimmed, 'https://example.invalid');
    return {
      pathname: url.pathname,
      searchParams: url.searchParams,
      hash: url.hash,
    };
  } catch {
    const [pathAndQuery, hash = ''] = trimmed.split('#');
    const [pathname, query = ''] = pathAndQuery.split('?');
    return {
      pathname: pathname.startsWith('/') ? pathname : `/${pathname}`,
      searchParams: new URLSearchParams(query),
      hash: hash ? `#${hash}` : '',
    };
  }
}

function parseArticleSlug(pathname: string): string | null {
  const match = pathname.match(/^\/articles?\/([^/]+)$/);
  return match?.[1] ?? null;
}

export function buildMarkdownEditorLinkUrl(input: {
  linkType: MarkdownEditorLinkType;
  articleSlug?: string | null;
  contactRecipient?: string | null;
  systemPagePath?: PublicSystemPagePath | null;
  customUrl?: string;
}): string {
  switch (input.linkType) {
    case 'published-article':
      return input.articleSlug ? `/articles/${input.articleSlug}` : '';
    case 'email-contact':
      return input.contactRecipient ? buildContactPageLink(input.contactRecipient) : '';
    case 'system-page':
      return input.systemPagePath ?? '';
    case 'custom-url':
      return input.customUrl?.trim() ?? '';
    default:
      return '';
  }
}

export function inferMarkdownEditorLinkTarget(rawUrl: string): InferredMarkdownEditorLinkTarget {
  const url = rawUrl.trim();
  if (!url) {
    return {
      linkType: 'published-article',
      articleSlug: null,
      contactRecipient: null,
      systemPagePath: null,
      customUrl: '',
    };
  }

  const { pathname, searchParams } = parseEditorLinkUrl(url);
  const articleSlug = parseArticleSlug(pathname);
  if (articleSlug) {
    return {
      linkType: 'published-article',
      articleSlug,
      contactRecipient: null,
      systemPagePath: null,
      customUrl: url,
    };
  }

  if (pathname === '/contact') {
    const recipient = searchParams.get('recipient')?.trim();
    if (recipient && /^[a-z0-9-]+$/.test(recipient)) {
      return {
        linkType: 'email-contact',
        articleSlug: null,
        contactRecipient: recipient,
        systemPagePath: null,
        customUrl: url,
      };
    }
  }

  const systemPagePath = normalizePublicSystemPagePath(pathname);
  if (systemPagePath) {
    return {
      linkType: 'system-page',
      articleSlug: null,
      contactRecipient: null,
      systemPagePath,
      customUrl: url,
    };
  }

  return {
    linkType: 'custom-url',
    articleSlug: null,
    contactRecipient: null,
    systemPagePath: null,
    customUrl: url,
  };
}

export function isMarkdownEditorLinkDraftReady(input: {
  linkType: MarkdownEditorLinkType;
  text: string;
  url: string;
  articleSlug: string | null;
  contactRecipient: string | null;
  systemPagePath: PublicSystemPagePath | null;
}): boolean {
  if (!input.text.trim()) return false;

  switch (input.linkType) {
    case 'published-article':
      return Boolean(input.articleSlug);
    case 'email-contact':
      return input.contactRecipient != null;
    case 'system-page':
      return input.systemPagePath != null;
    case 'custom-url':
      return Boolean(input.url.trim());
    default:
      return false;
  }
}
