import { OPEN_IN_NEW_WINDOW_TITLE } from '../constants/markdownLink';

const TCC_BLOCK_STYLE_CLASS_PATTERN = 'tcc-style-(?:info-box|critical-box|aside|callout)';

type PmMark = {
  type?: { name?: string };
  attrs?: {
    linkUrl?: string;
    title?: string | null;
    htmlAttrs?: Record<string, string>;
  };
};

type PmInlineChild = {
  isText?: boolean;
  type?: { name?: string };
  text?: string;
  marks?: PmMark[];
};

type PmInlineBlockNode = {
  content?: {
    forEach: (fn: (child: PmInlineChild) => void) => void;
  };
};

type MdConvertorWriteState = {
  write: (text: string) => void;
};

type HtmlParseSchema = {
  marks: Record<string, unknown>;
  text?: (value: string, marks?: readonly unknown[] | unknown[] | null) => unknown;
};

export function escapeHtmlText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function escapeHtmlAttr(text: string): string {
  return escapeHtmlText(text).replace(/"/g, '&quot;');
}

function markToHtmlPair(mark: PmMark): { open: string; close: string } | null {
  const name = mark.type?.name;
  if (!name) return null;

  switch (name) {
    case 'strong':
      return { open: '<strong>', close: '</strong>' };
    case 'emph':
      return { open: '<em>', close: '</em>' };
    case 'strike':
      return { open: '<s>', close: '</s>' };
    case 'code':
      return { open: '<code>', close: '</code>' };
    case 'link': {
      const url = escapeHtmlAttr(String(mark.attrs?.linkUrl ?? ''));
      const title = mark.attrs?.title ? ` title="${escapeHtmlAttr(String(mark.attrs.title))}"` : '';
      return { open: `<a href="${url}"${title}>`, close: '</a>' };
    }
    case 'span':
    case 'small': {
      const className = mark.attrs?.htmlAttrs?.class;
      const classAttr = className ? ` class="${escapeHtmlAttr(className)}"` : '';
      return { open: `<${name}${classAttr}>`, close: `</${name}>` };
    }
    default:
      return null;
  }
}

function textNodeToHtml(text: string, marks: PmMark[]): string {
  let open = '';
  let close = '';
  for (const mark of marks) {
    const pair = markToHtmlPair(mark);
    if (!pair) continue;
    open += pair.open;
    close = pair.close + close;
  }
  return `${open}${escapeHtmlText(text)}${close}`;
}

/** Serialize WYSIWYG inline content as HTML for raw HTML blocks (styled boxes, indented blocks). */
export function wysiwygInlineNodeToHtml(node: unknown): string {
  const block = node as PmInlineBlockNode;
  let html = '';
  block.content?.forEach((child) => {
    if (child.isText) {
      html += textNodeToHtml(child.text ?? '', child.marks ?? []);
      return;
    }
    if (child.type?.name === 'hard_break') {
      html += '<br>';
    }
  });
  return html;
}

export function writeWysiwygInlineAsHtml(state: MdConvertorWriteState, node: unknown): void {
  state.write(wysiwygInlineNodeToHtml(node));
}

const MARKDOWN_LINK_IN_HTML_RE = /\[([^\]\n]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g;

function repairMarkdownLinksInHtmlFragment(html: string): string {
  let normalized = html;
  for (let pass = 0; pass < 12; pass += 1) {
    const repaired = normalized.replace(MARKDOWN_LINK_IN_HTML_RE, (_match, text, url, title) => {
      const titleAttr = title ? ` title="${escapeHtmlAttr(title)}"` : '';
      return `<a href="${escapeHtmlAttr(url)}"${titleAttr}>${escapeHtmlText(text)}</a>`;
    });
    if (repaired !== normalized) return repaired;

    const unescaped = normalized.replace(/\\([[\].()\\_*])/g, '$1');
    if (unescaped === normalized) break;
    normalized = unescaped;
  }

  return normalized.replace(MARKDOWN_LINK_IN_HTML_RE, (_match, text, url, title) => {
    const titleAttr = title ? ` title="${escapeHtmlAttr(title)}"` : '';
    return `<a href="${escapeHtmlAttr(url)}"${titleAttr}>${escapeHtmlText(text)}</a>`;
  });
}

/** Repair legacy or escaped `[text](url)` syntax inside an HTML fragment. */
export function repairMarkdownLinksInHtmlContent(html: string): string {
  return repairMarkdownLinksInHtmlFragment(html);
}

/** Repair legacy `[text](url)` syntax saved inside raw HTML styled blocks. */
export function repairMarkdownLinksInRawHtmlBlocks(markdown: string): string {
  const styledBlockRe = new RegExp(
    `(<div class="${TCC_BLOCK_STYLE_CLASS_PATTERN}"[^>]*>)([\\s\\S]*?)(</div>)`,
    'gi'
  );
  let next = markdown.replace(styledBlockRe, (_full, open, inner, close) => {
    return `${open}${repairMarkdownLinksInHtmlFragment(inner)}${close}`;
  });

  const indentedBlockRe = /<p\b([^>]*\bdata-tcc-indent="[1-8]"[^>]*)>([\s\S]*?)<\/p>/gi;
  next = next.replace(indentedBlockRe, (_full, attrs, inner) => {
    return `<p${attrs}>${repairMarkdownLinksInHtmlFragment(inner)}</p>`;
  });

  return next;
}

function createMark(schema: HtmlParseSchema, name: string, attrs: Record<string, unknown>): unknown | null {
  const markType = schema.marks[name] as { create?: (attrs: Record<string, unknown>) => unknown } | undefined;
  return markType?.create?.(attrs) ?? null;
}

function appendTextNode(
  schema: HtmlParseSchema,
  result: unknown[],
  text: string,
  marks: unknown[]
): void {
  if (!text) return;
  const node = schema.text?.(text, marks);
  if (node) result.push(node);
}

function isBlockWrapperTag(tag: string): boolean {
  return tag === 'p' || tag === 'div' || /^h[1-6]$/.test(tag);
}

/**
 * Build ProseMirror inline nodes from an HTML fragment (used when normalizing raw HTML blocks).
 * Handles links and common inline formatting that Toast UI would otherwise drop.
 */
export function buildInlineNodesFromHTML(schema: unknown, html: string): unknown[] {
  const parsedSchema = schema as HtmlParseSchema;
  const container = document.createElement('div');
  container.innerHTML = html;
  const result: unknown[] = [];

  const walk = (parent: Node, marks: unknown[]) => {
    parent.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        appendTextNode(parsedSchema, result, child.textContent ?? '', marks);
        return;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) return;

      const el = child as HTMLElement;
      const tag = el.tagName.toLowerCase();

      if (tag === 'br') {
        return;
      }

      if (isBlockWrapperTag(tag)) {
        walk(el, marks);
        return;
      }

      if (tag === 'a') {
        const href = el.getAttribute('href') ?? '';
        const title = el.getAttribute('title');
        const linkMark = createMark(parsedSchema, 'link', {
          linkUrl: href,
          title: title === OPEN_IN_NEW_WINDOW_TITLE ? OPEN_IN_NEW_WINDOW_TITLE : title,
        });
        walk(el, linkMark ? [...marks, linkMark] : marks);
        return;
      }

      if (tag === 'strong' || tag === 'b') {
        const mark = createMark(parsedSchema, 'strong', {});
        walk(el, mark ? [...marks, mark] : marks);
        return;
      }

      if (tag === 'em' || tag === 'i') {
        const mark = createMark(parsedSchema, 'emph', {});
        walk(el, mark ? [...marks, mark] : marks);
        return;
      }

      if (tag === 's' || tag === 'del' || tag === 'strike') {
        const mark = createMark(parsedSchema, 'strike', {});
        walk(el, mark ? [...marks, mark] : marks);
        return;
      }

      if (tag === 'code') {
        const mark = createMark(parsedSchema, 'code', {});
        walk(el, mark ? [...marks, mark] : marks);
        return;
      }

      if ((tag === 'span' || tag === 'small') && parsedSchema.marks[tag]) {
        const attrs: Record<string, string> = {};
        for (const { name, value } of Array.from(el.attributes)) attrs[name] = value;
        const mark = createMark(parsedSchema, tag, { htmlAttrs: attrs });
        walk(el, mark ? [...marks, mark] : marks);
        return;
      }

      walk(el, marks);
    });
  };

  walk(container, []);
  return result;
}
