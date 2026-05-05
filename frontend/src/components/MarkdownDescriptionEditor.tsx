/**
 * Markdown description editor using ToastUI Editor.
 * WYSIWYG-only (no Markdown tab). Content is stored as Markdown on the backend.
 * Respects light/dark theme.
 */

import { forwardRef, useCallback, useEffect, useId, useImperativeHandle, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { TextSelection, type Command, type Plugin } from 'prosemirror-state';
import { splitBlockAs } from 'prosemirror-commands';
import type { ResolvedPos } from 'prosemirror-model';
import {
  HiOutlineLink,
  HiOutlineLinkSlash,
  HiOutlinePaintBrush,
  HiOutlinePlayCircle,
  HiPencilSquare,
} from 'react-icons/hi2';
import '@toast-ui/editor/dist/toastui-editor.css';
import '@toast-ui/editor/dist/theme/toastui-editor-dark.css';
import { Editor } from '@toast-ui/react-editor';
import ArticleAutocomplete, { type ArticleOption } from './ArticleAutocomplete';
import ContentFileEditModal, { type ManagedFile } from './ContentFileEditModal';
import FormCheckbox from './FormCheckbox';
import FormField from './FormField';
import { useAlert } from '../contexts/AlertContext';
import api from '../utils/api';
import { OPEN_IN_NEW_WINDOW_TITLE } from '../constants/markdownLink';
import {
  bustManagedFileUrlsCacheInMarkdown,
  parseManagedFileIdFromImageSrc,
  replaceManagedFileUrlsInMarkdown,
} from '../utils/managedFileUrls';
import {
  extractYoutubeVideoIdFromUserInput,
  markdownStorageFromWysiwygYoutubeThumbnails,
  markdownYoutubeEmbedsForWysiwyg,
  youtubeEmbedEditorThumbnailUrl,
} from '../utils/youtubeMarkdown';

/** Read-more marker: asterism (⁂) for snippet cutoff. */
export const READ_MORE_MARKER = '⁂';

export interface MarkdownDescriptionEditorRef {
  /** Undefined when the Toast UI instance is not ready yet (caller should fall back to form state). */
  getMarkdown: () => string | undefined;
  /** Insert text at cursor (e.g. for read-more marker) */
  insertText?: (text: string) => void;
}

interface MarkdownDescriptionEditorProps {
  initialValue?: string;
  placeholder?: string;
  minHeight?: string;
  className?: string;
  /** When true, applies dark theme to the editor */
  dark?: boolean;
  /** When true, editor fills its container (use in flex layouts) */
  fill?: boolean;
  /** When true, adds "Read more" button to toolbar (for article editing) */
  readMoreInToolbar?: boolean;
  /** Optional async image upload handler used for clipboard paste/drop images */
  onUploadImage?: (blob: Blob) => Promise<{ url: string; altText?: string } | null>;
  /**
   * When true, images pointing at managed file URLs (/api/public/files/… or /api/files/…)
   * can be edited via double-click or the hover "edit" control (content admin only).
   */
  enableManagedFileImageEdit?: boolean;
  /** Fires once after the WYSIWYG instance is initialized (initial markdown is loaded). */
  onWysiwygReady?: () => void;
}

/** Workaround for ToastUI bug: empty initialValue shows "Write\nPreview". Pass a space when empty. */
const EMPTY_INITIAL = ' ';
type CannedStyleClass =
  | 'tcc-style-informational'
  | 'tcc-style-info-box'
  | 'tcc-style-critical-box'
  | 'tcc-style-aside'
  | 'tcc-style-green'
  | 'tcc-style-red'
  | 'tcc-style-yellow'
  | 'tcc-style-callout'
  | 'tcc-style-button-link'
  | 'tcc-style-muted'
  | 'tcc-style-lead'
  | 'tcc-style-badge';
type CannedStyle = 'default' | CannedStyleClass;
type CannedStyleKind = 'inline' | 'block';

const BLOCK_STYLE_CLASSES = new Set<CannedStyleClass>([
  'tcc-style-info-box',
  'tcc-style-critical-box',
  'tcc-style-aside',
  'tcc-style-callout',
]);

type CannedStyleOptionDef = {
  value: CannedStyle;
  label: string;
  description: string;
  kind: CannedStyleKind | null;
  tag: 'small' | 'span' | null;
};

type CannedStyleMenuRow = CannedStyleOptionDef | { divider: true };

/** Display order for the styles menu (includes a divider between block and inline groups). */
const CANNED_STYLE_MENU: CannedStyleMenuRow[] = [
  { value: 'default', label: 'Default', description: 'Return selected text to normal styling', kind: null, tag: null },
  { divider: true },
  { value: 'tcc-style-info-box', label: 'Info box', description: 'Offset box with a soft background', kind: 'block', tag: null },
  { value: 'tcc-style-callout', label: 'Callout box', description: 'Neutral emphasis box', kind: 'block', tag: null },
  { value: 'tcc-style-critical-box', label: 'Critical box', description: 'High-priority warning box', kind: 'block', tag: null },
  { value: 'tcc-style-aside', label: 'Aside', description: 'Right-floated supporting note', kind: 'block', tag: null },
  { divider: true },
  { value: 'tcc-style-informational', label: 'Informational', description: 'Small supporting text', kind: 'inline', tag: 'small' },
  { value: 'tcc-style-muted', label: 'Muted', description: 'Subdued secondary text', kind: 'inline', tag: 'span' },
  { value: 'tcc-style-lead', label: 'Lead', description: 'Larger introductory text', kind: 'inline', tag: 'span' },
  { value: 'tcc-style-red', label: 'Red', description: 'Red text', kind: 'inline', tag: 'span' },
  { value: 'tcc-style-yellow', label: 'Yellow', description: 'Yellow text', kind: 'inline', tag: 'span' },
  { value: 'tcc-style-green', label: 'Green', description: 'Green text', kind: 'inline', tag: 'span' },
  { value: 'tcc-style-badge', label: 'Badge', description: 'Compact inline label', kind: 'inline', tag: 'span' },
  { value: 'tcc-style-button-link', label: 'Button link', description: 'CTA treatment for linked text', kind: 'inline', tag: 'span' },
];

const CANNED_STYLE_OPTIONS: CannedStyleOptionDef[] = CANNED_STYLE_MENU.filter(
  (row): row is CannedStyleOptionDef => !('divider' in row)
);

type LinkMark = {
  type: unknown;
  attrs?: {
    linkUrl?: string;
    title?: string | null;
  };
};

type WysiwygView = {
  state: {
    doc: {
      content: { size: number };
      nodesBetween: (
        from: number,
        to: number,
        callback: (node: WysiwygNode, pos: number) => void | boolean
      ) => void;
      textBetween: (from: number, to: number, blockSeparator?: string, leafText?: string) => string;
    };
    selection: {
      from: number;
      to: number;
      empty?: boolean;
      $from: { marks: () => LinkMark[]; sameParent?: (other: unknown) => boolean };
      $to?: unknown;
      content?: () => { content: unknown };
    };
    schema: {
      marks: {
        link?: unknown;
        small?: { create: (attrs: Record<string, unknown>) => unknown };
        span?: { create: (attrs: Record<string, unknown>) => unknown };
      };
      nodes: {
        div?: {
          createAndFill?: (attrs: Record<string, unknown>, content?: unknown) => unknown;
          create?: (attrs: Record<string, unknown>, content?: unknown) => unknown;
        };
        paragraph?: {
          createAndFill?: (_attrs: null, content?: unknown) => unknown;
          create?: (attrs: Record<string, unknown> | null, content?: unknown) => unknown;
        };
      };
      mark: (name: string, attrs: Record<string, unknown>) => unknown;
      text?: (value: string) => unknown;
    };
    tr: {
      addMark: (from: number, to: number, mark: unknown) => WysiwygView['state']['tr'];
      removeMark: (from: number, to: number, mark: unknown) => WysiwygView['state']['tr'];
      replaceRange: (from: number, to: number, slice: unknown) => WysiwygView['state']['tr'];
      replaceRangeWith: (from: number, to: number, node: unknown) => WysiwygView['state']['tr'];
      setNodeMarkup: (pos: number, type?: unknown, attrs?: Record<string, unknown>) => WysiwygView['state']['tr'];
      setSelection?: (selection: unknown) => WysiwygView['state']['tr'];
      scrollIntoView: () => WysiwygView['state']['tr'];
    };
  };
  dispatch: (tr: WysiwygView['state']['tr']) => void;
  focus: () => void;
};

type WysiwygNode = {
  isText?: boolean;
  isBlock?: boolean;
  text?: string;
  textContent?: string;
  nodeSize: number;
  marks?: LinkMark[];
  type?: { name?: string };
  child?: (index: number) => WysiwygNode;
  childCount?: number;
  attrs?: {
    htmlBlock?: boolean;
    htmlAttrs?: Record<string, string>;
    childrenHTML?: string;
    classNames?: string[] | null;
  };
};

type WysiwygParentNode = WysiwygNode & {
  type?: { name?: string };
};

type EditorInstance = {
  getMarkdown?: () => string;
  setMarkdown?: (markdown: string, cursorToEnd?: boolean) => void;
  insertText?: (text: string) => void;
  exec?: (name: string, payload?: Record<string, unknown>) => void;
  focus?: () => void;
  insertToolbarItem?: (position: { groupIndex: number; itemIndex: number }, item: { name: string; tooltip: string; el: HTMLElement }) => void;
  addHook?: (type: string, handler: (blob: Blob, callback: (url: string, text?: string) => void) => Promise<boolean>) => void;
  on?: (type: string, handler: (value?: unknown) => void) => void;
  isWysiwygMode?: () => boolean;
  getSelectedText?: () => string;
  wwEditor?: { view?: WysiwygView };
};

type LinkRange = {
  from: number;
  to: number;
  mark: LinkMark;
};

type LinkDraft = {
  text: string;
  url: string;
  openInNewWindow: boolean;
  from: number;
  to: number;
  empty: boolean;
};

type YoutubeDraft = {
  title: string;
  videoIdOrUrl: string;
};

function getLinkMark(marks: LinkMark[] | undefined, linkMark: unknown): LinkMark | null {
  return marks?.find((mark) => mark.type === linkMark) ?? null;
}

function getTouchedLinkRanges(view: WysiwygView): LinkRange[] {
  const { doc, selection, schema } = view.state;
  const linkMark = schema.marks.link;
  if (!linkMark) return [];

  const ranges: LinkRange[] = [];
  doc.nodesBetween(0, doc.content.size, (node, pos) => {
    if (!node.isText) return;
    const mark = getLinkMark(node.marks, linkMark);
    if (!mark) return;

    const from = pos;
    const to = pos + node.nodeSize;
    const touchesSelection = selection.empty
      ? selection.from >= from && selection.from <= to
      : from < selection.to && to > selection.from;

    if (!touchesSelection) return;

    const previous = ranges[ranges.length - 1];
    if (
      previous &&
      previous.to === from &&
      previous.mark.attrs?.linkUrl === mark.attrs?.linkUrl &&
      previous.mark.attrs?.title === mark.attrs?.title
    ) {
      previous.to = to;
    } else {
      ranges.push({ from, to, mark });
    }
  });

  return ranges;
}

function trimSelectionEdges(text: string, from: number, to: number) {
  const leading = text.match(/^\s*/)?.[0].length ?? 0;
  const trailing = text.match(/\s*$/)?.[0].length ?? 0;
  return {
    from: Math.min(from + leading, to),
    to: Math.max(from, to - trailing),
    text: text.slice(leading, text.length - trailing),
  };
}

function createTextNode(schema: WysiwygView['state']['schema'], text: string, mark: unknown) {
  const textNode = (schema as unknown as { text?: (value: string, marks?: unknown[]) => unknown }).text;
  return textNode?.(text, [mark]);
}

function classListContainsAny(className: string | undefined, values: Set<CannedStyleClass>) {
  if (!className) return false;
  return className.split(/\s+/).some((part) => values.has(part as CannedStyleClass));
}

type BlockStyleRange = { from: number; to: number; node: WysiwygNode };

function getBlockStyleRange(view: WysiwygView): BlockStyleRange | null {
  const { doc, selection } = view.state;
  let match: { from: number; to: number; node: WysiwygNode } | null = null;
  doc.nodesBetween(0, doc.content.size, (node, pos) => {
    if (
      node.isBlock &&
      classListContainsAny(node.attrs?.classNames?.join(' '), BLOCK_STYLE_CLASSES) &&
      selection.from >= pos &&
      selection.to <= pos + node.nodeSize
    ) {
      match = { from: pos, to: pos + node.nodeSize, node };
      return false;
    }
    return undefined;
  });
  return match;
}

function getSelectedTextBlocks(view: WysiwygView) {
  const { doc, selection } = view.state;
  const blocks: Array<{ from: number; node: WysiwygNode }> = [];
  doc.nodesBetween(selection.from, selection.to, (node, pos) => {
    if (node.isBlock && node.type?.name === 'paragraph') {
      blocks.push({ from: pos, node });
      return false;
    }
    return undefined;
  });
  return blocks;
}

function buildInlineNodesFromHTML(
  schema: WysiwygView['state']['schema'],
  html: string
): unknown[] {
  const container = document.createElement('div');
  container.innerHTML = html;
  const result: unknown[] = [];

  const walk = (parent: Node, marks: unknown[]) => {
    parent.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        const text = child.textContent ?? '';
        if (!text) return;
        const node = (schema as unknown as { text?: (value: string, marks?: unknown[]) => unknown }).text?.(text, marks);
        if (node) result.push(node);
        return;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) return;
      const el = child as HTMLElement;
      const tag = el.tagName.toLowerCase();
      let nextMarks = marks;
      if ((tag === 'span' || tag === 'small') && schema.marks[tag]) {
        const attrs: Record<string, string> = {};
        for (const { name, value } of Array.from(el.attributes)) attrs[name] = value;
        const markType = schema.marks[tag] as { create: (attrs: Record<string, unknown>) => unknown };
        nextMarks = [...marks, markType.create({ htmlAttrs: attrs })];
      }
      walk(el, nextMarks);
    });
  };

  walk(container, []);
  return result;
}

function normalizeStyledHtmlBlocks(view: WysiwygView) {
  const { doc, schema } = view.state;
  let tr = view.state.tr;
  const replacements: Array<{ from: number; to: number; node: unknown }> = [];

  doc.nodesBetween(0, doc.content.size, (node, pos) => {
    const className = node.attrs?.htmlAttrs?.class;
    if (!node.attrs?.htmlBlock || !classListContainsAny(className, BLOCK_STYLE_CLASSES)) return undefined;

    const blockClass = className?.split(/\s+/).find((part) => BLOCK_STYLE_CLASSES.has(part as CannedStyleClass));
    if (!blockClass) return false;

    const inlineNodes = buildInlineNodesFromHTML(schema, node.attrs.childrenHTML ?? '');
    const styledParagraph = schema.nodes.paragraph?.create?.(
      { classNames: [blockClass] },
      inlineNodes.length ? inlineNodes : undefined
    );
    if (styledParagraph) {
      replacements.push({ from: pos, to: pos + node.nodeSize, node: styledParagraph });
    }
    return false;
  });

  for (const replacement of replacements.reverse()) {
    tr = tr.replaceRangeWith(replacement.from, replacement.to, replacement.node);
  }

  if (replacements.length) {
    view.dispatch(tr.scrollIntoView());
  }
}

function renderHTMLTagToken(
  tagName: 'div' | 'small' | 'span',
  node: { attrs?: Record<string, string> },
  context: { entering: boolean }
) {
  return context.entering
    ? { type: 'openTag', tagName, attributes: node.attrs ?? {} }
    : { type: 'closeTag', tagName };
}

type HtmlMarkdownNode = {
  type?: { name?: string };
  attrs?: {
    htmlAttrs?: Record<string, string>;
    htmlInline?: boolean;
    htmlBlock?: boolean;
    childrenHTML?: string;
  };
};

function markdownInlineHtmlRenderer(
  nodeInfo?: { node?: HtmlMarkdownNode } | HtmlMarkdownNode,
  context?: boolean | { entering?: boolean }
) {
  const node = (nodeInfo && 'node' in nodeInfo ? nodeInfo.node : nodeInfo) as HtmlMarkdownNode | undefined;
  const tagName = node?.type?.name;
  if (!tagName) return {};
  const entering = typeof context === 'boolean' ? context : Boolean(context?.entering);

  const attrs = node.attrs?.htmlAttrs ?? {};
  const attrText = Object.entries(attrs)
    .map(([name, value]) => ` ${name}="${String(value).replace(/"/g, "'")}"`)
    .join('');

  return {
    rawHTML: entering ? `<${tagName}${attrText}>` : `</${tagName}>`,
  };
}

function markdownHtmlRenderer(
  nodeInfo?: { node?: HtmlMarkdownNode } | HtmlMarkdownNode,
  context?: boolean | { entering?: boolean }
) {
  const node = (nodeInfo && 'node' in nodeInfo ? nodeInfo.node : nodeInfo) as HtmlMarkdownNode | undefined;
  if (node?.attrs?.htmlInline) {
    return markdownInlineHtmlRenderer(nodeInfo, context);
  }
  return {};
}

function createToolbarIconButton(label: string, icon: ReactNode) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'tcc-editor-icon-button';
  button.title = label;
  button.setAttribute('aria-label', label);
  createRoot(button).render(icon);
  return button;
}

function ToolbarStylesDropdown({ onApplyStyle }: { onApplyStyle: (style: CannedStyle) => void }) {
  const [open, setOpen] = useState(false);
  const [menuRect, setMenuRect] = useState<DOMRect | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const updatePosition = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (rect) setMenuRect(rect);
    };
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Node ? event.target : null;
      if (target && wrapperRef.current?.contains(target)) return;
      if (target && menuRef.current?.contains(target)) return;
      setOpen(false);
    };

    updatePosition();
    document.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open]);

  return (
    <div className="tcc-editor-styles-dropdown" ref={wrapperRef}>
      <button
        ref={buttonRef}
        type="button"
        className="tcc-editor-style-button"
        aria-label="Styles"
        aria-haspopup="menu"
        aria-expanded={open}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setOpen((value) => !value)}
      >
        <HiOutlinePaintBrush aria-hidden="true" />
      </button>
      {open && menuRect
        ? createPortal(
            <div
              ref={menuRef}
              className="tcc-editor-style-menu"
              role="menu"
              aria-label="Text styles"
              style={{ position: 'fixed', top: menuRect.bottom + 4, left: menuRect.left }}
            >
              {CANNED_STYLE_MENU.map((row, index) =>
                'divider' in row ? (
                  <hr key={`style-menu-divider-${index}`} className="tcc-editor-style-menu-divider" role="separator" />
                ) : (
                  <button
                    key={row.value}
                    type="button"
                    role="menuitem"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      onApplyStyle(row.value);
                      setOpen(false);
                    }}
                  >
                    <span>{row.label}</span>
                    <span className="tcc-editor-style-menu-description">{row.description}</span>
                  </button>
                )
              )}
            </div>,
            document.body
          )
        : null}
    </div>
  );
}

/**
 * Avoid widgetRules: ToastUI's getWidgetContent crashes when widget is inside emph/link.
 * Use plain asterism (⁂) instead.
 */

/** Plugin: pre-fill link URL when editing existing link (cursor in link). */
function linkEditPlugin(context: {
  eventEmitter: { removeEventHandler: (t: string) => void; listen: (t: string, h: (q: string, p: { popupName: string }) => unknown) => void };
  instance: { getSelectedText: () => string; wwEditor?: { view: { state: { schema: { marks: { link?: unknown } }; selection: { $from: { marks: () => Array<{ type: unknown; attrs?: { linkUrl?: string } }> } } } } } };
}) {
  const { eventEmitter, instance } = context;
  eventEmitter.removeEventHandler('query');
  eventEmitter.listen('query', (query: string, payload: { popupName: string }) => {
    if (query === 'getPopupInitialValues') {
      const linkText = instance.getSelectedText();
      let linkUrl = '';
      if (payload.popupName === 'link') {
        try {
          const ww = instance.wwEditor;
          if (ww?.view?.state?.schema?.marks?.link) {
            const mark = ww.view.state.selection.$from.marks().find(
              (m) => m.type === ww.view.state.schema.marks.link
            );
            if (mark?.attrs?.linkUrl) linkUrl = mark.attrs.linkUrl;
          }
        } catch {
          /* ignore */
        }
      }
      return payload.popupName === 'link' ? { linkText, linkUrl } : {};
    }
    return undefined;
  });
  return {};
}

function getTccBlockClassFromParagraphClassNames(classNames: string[] | null | undefined): string | null {
  if (!classNames?.length) return null;
  const found = classNames.find((c) => BLOCK_STYLE_CLASSES.has(c as CannedStyleClass));
  return found ?? null;
}

function getTccBlockClassFromWysiwygNode(node: WysiwygNode | undefined): string | null {
  return getTccBlockClassFromParagraphClassNames(node?.attrs?.classNames);
}

function cloneParagraphAttrs(attrs: Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (!attrs) return {};
  const cn = attrs.classNames;
  return {
    ...attrs,
    classNames: Array.isArray(cn) ? [...cn] : cn,
  };
}

function findEnclosingParagraphDepth($from: ResolvedPos): number | null {
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if ($from.node(depth).type.name === 'paragraph') return depth;
  }
  return null;
}

/** Split so both sides keep the same TCC block class (middle & start of paragraph). */
const tccBlockStyleSplitBlock = splitBlockAs((node) => {
  if (node.type.name !== 'paragraph') return null;
  const cn = node.attrs?.classNames as string[] | null | undefined;
  if (!getTccBlockClassFromParagraphClassNames(cn)) return null;
  return { type: node.type, attrs: cloneParagraphAttrs(node.attrs as Record<string, unknown>) };
});

/**
 * Enter / list-like exit for canned block styles (info box, callout, etc.):
 * - Empty styled paragraph + Enter -> plain paragraph (exit the box).
 * - End of text + Enter -> new styled paragraph after this one (pair with CSS "run" merge).
 * - Otherwise -> split preserving block class on both sides.
 *
 * Implemented as a keymap (not handleKeyDown): Toast UI registers baseKeymap after custom
 * plugins, and ProseMirror consults handleKeyDown in reverse order, so base Enter would
 * always win. Keymap precedence favors plugins earlier in the array, so this binding runs first.
 */
function tccBlockStyleEnterPlugin(context: { pmKeymap: { keymap: (bindings: Record<string, Command>) => Plugin } }) {
  const tccStyledBlockEnter: Command = (state, dispatch, view) => {
    if (view?.composing) return false;
    const sel = state.selection;
    if (!(sel instanceof TextSelection) || !sel.empty) return false;

    const $from = sel.$from;
    const pDepth = findEnclosingParagraphDepth($from);
    if (pDepth == null) return false;

    const para = $from.node(pDepth);
    if (para.type.name !== 'paragraph') return false;

    const cn = para.attrs?.classNames as string[] | null | undefined;
    if (!getTccBlockClassFromParagraphClassNames(cn)) return false;

    if (para.content.size === 0) {
      if (!dispatch) return true;
      const pos = $from.before(pDepth);
      dispatch(
        state.tr
          .setNodeMarkup(pos, undefined, {
            ...cloneParagraphAttrs(para.attrs as Record<string, unknown>),
            classNames: null,
          })
          .scrollIntoView()
      );
      return true;
    }

    const atEnd = $from.parent === para && $from.parentOffset === para.content.size;

    if (atEnd) {
      if (!dispatch) return true;
      const insertPos = $from.after(pDepth);
      const newPara = state.schema.nodes.paragraph.create(
        cloneParagraphAttrs(para.attrs as Record<string, unknown>) as Record<string, unknown>,
        []
      );
      const tr = state.tr.insert(insertPos, newPara);
      const innerStart = insertPos + 1;
      dispatch(tr.setSelection(TextSelection.create(tr.doc, innerStart)).scrollIntoView());
      return true;
    }

    return tccBlockStyleSplitBlock(state, dispatch);
  };

  return {
    wysiwygPlugins: [() => context.pmKeymap.keymap({ Enter: tccStyledBlockEnter })],
  };
}

const MarkdownDescriptionEditor = forwardRef<
  MarkdownDescriptionEditorRef,
  MarkdownDescriptionEditorProps
>(
  (
    {
      initialValue = '',
      placeholder = '',
      minHeight = '150px',
      className = '',
      dark = false,
      fill = false,
      readMoreInToolbar = false,
      onUploadImage,
      enableManagedFileImageEdit = false,
      onWysiwygReady,
    },
    ref
  ) => {
    const linkTextId = useId();
    const linkUrlId = useId();
    const articlePickerId = useId();
    const youtubeTitleId = useId();
    const youtubeUrlId = useId();
    const editorRef = useRef<Editor>(null);
    const wrapperRef = useRef<HTMLDivElement>(null);
    const linkTextInputRef = useRef<HTMLInputElement>(null);
    const linkUrlInputRef = useRef<HTMLInputElement>(null);
    const youtubeVideoInputRef = useRef<HTMLInputElement>(null);
    const youtubeDialogRef = useRef<HTMLDivElement>(null);
    const youtubeDialogWasOpenRef = useRef(false);
    const unlinkButtonRef = useRef<HTMLButtonElement | null>(null);
    const toolbarCleanupRef = useRef<Array<() => void>>([]);
    const [fillHeight, setFillHeight] = useState<number>(300);
    const [linkDraft, setLinkDraft] = useState<LinkDraft | null>(null);
    const [youtubeDraft, setYoutubeDraft] = useState<YoutubeDraft | null>(null);
    const [selectedArticle, setSelectedArticle] = useState<ArticleOption | null>(null);
    const { showAlert } = useAlert();
    const [managedImageModal, setManagedImageModal] = useState<{ open: boolean; file: ManagedFile | null }>({
      open: false,
      file: null,
    });
    const [hoverManagedImageEdit, setHoverManagedImageEdit] = useState<{
      fileId: number;
      top: number;
      right: number;
    } | null>(null);
    const hoverManagedImageChipRef = useRef<HTMLDivElement | null>(null);

    useImperativeHandle(ref, () => ({
      getMarkdown: () => {
        const instance = editorRef.current?.getInstance?.() as EditorInstance | undefined;
        if (!instance?.getMarkdown) return undefined;
        const md = instance.getMarkdown() ?? '';
        return markdownStorageFromWysiwygYoutubeThumbnails(md).trim();
      },
      insertText: (text: string) => {
        const instance = editorRef.current?.getInstance?.() as EditorInstance | undefined;
        instance?.insertText?.(text);
      },
    }));

    const getEditorInstance = () => editorRef.current?.getInstance?.() as EditorInstance | undefined;

    const openManagedImageEditor = useCallback(
      async (fileId: number) => {
        try {
          const res = await api.get<ManagedFile>(`/content/files/${fileId}`);
          setManagedImageModal({ open: true, file: res.data });
          setHoverManagedImageEdit(null);
        } catch (err: unknown) {
          const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
          showAlert(msg || 'Could not open file editor', 'error');
        }
      },
      [showAlert]
    );

    const closeManagedImageModal = useCallback(() => {
      setManagedImageModal({ open: false, file: null });
    }, []);

    const handleManagedImageBytesUpdated = useCallback(
      async ({ sourceFileId, file: updatedFile }: { sourceFileId: number; file: ManagedFile }) => {
        const instance = editorRef.current?.getInstance?.() as EditorInstance | undefined;
        if (!instance?.getMarkdown || !instance.setMarkdown) return;
        const raw = instance.getMarkdown() ?? '';
        const md = markdownStorageFromWysiwygYoutubeThumbnails(raw);
        let next = replaceManagedFileUrlsInMarkdown(md, sourceFileId, updatedFile);
        if (next === md) {
          next = bustManagedFileUrlsCacheInMarkdown(md, sourceFileId);
        }
        if (next !== md) {
          instance.setMarkdown(markdownYoutubeEmbedsForWysiwyg(next), false);
        }
      },
      []
    );

    const enableManagedFileImageEditRef = useRef(enableManagedFileImageEdit);
    enableManagedFileImageEditRef.current = enableManagedFileImageEdit;
    const openManagedImageEditorRef = useRef(openManagedImageEditor);
    openManagedImageEditorRef.current = openManagedImageEditor;

    const updateUnlinkButtonState = () => {
      const button = unlinkButtonRef.current;
      if (!button) return;
      const instance = getEditorInstance();
      const view = instance?.wwEditor?.view;
      const canUnlink = Boolean(instance?.isWysiwygMode?.() && view?.state?.schema?.marks?.link && getTouchedLinkRanges(view).length);
      button.disabled = !canUnlink;
      button.setAttribute('aria-disabled', String(!canUnlink));
    };

    const openLinkDialog = () => {
      const instance = getEditorInstance();
      if (!instance?.isWysiwygMode?.()) return;
      const view = instance.wwEditor?.view;
      if (!view?.state?.schema?.marks?.link) return;

      const { doc, selection } = view.state;
      const touchedLink = getTouchedLinkRanges(view)[0];
      const from = touchedLink?.from ?? selection.from;
      const to = touchedLink?.to ?? selection.to;
      const selectedText = doc.textBetween(from, to, '\n', '\n');
      const trimmed = selection.empty || touchedLink ? { from, to, text: selectedText } : trimSelectionEdges(selectedText, from, to);
      const cursorLinkMark = getLinkMark(selection.$from.marks(), view.state.schema.marks.link);
      const activeLink = touchedLink?.mark ?? cursorLinkMark;

      setSelectedArticle(null);
      setYoutubeDraft(null);
      setLinkDraft({
        text: trimmed.text,
        url: activeLink?.attrs?.linkUrl ?? '',
        openInNewWindow: activeLink?.attrs?.title === OPEN_IN_NEW_WINDOW_TITLE,
        from: trimmed.from,
        to: trimmed.to,
        empty: Boolean(selection.empty && !touchedLink),
      });
    };

    const applyLinkDraft = () => {
      if (!linkDraft) return;
      const text = linkDraft.text.trim();
      const url = linkDraft.url.trim();
      if (!text || !url) return;

      const instance = getEditorInstance();
      const view = instance?.wwEditor?.view;
      if (!view?.state?.schema?.marks?.link) return;

      const { schema } = view.state;
      const mark = schema.mark('link', {
        linkUrl: url,
        title: linkDraft.openInNewWindow ? OPEN_IN_NEW_WINDOW_TITLE : null,
      });
      const tr = view.state.tr.removeMark(linkDraft.from, linkDraft.to, schema.marks.link);

      if (linkDraft.empty) {
        const node = createTextNode(schema, text, mark);
        if (!node) return;
        tr.replaceRangeWith(linkDraft.from, linkDraft.to, node);
      } else {
        tr.addMark(linkDraft.from, linkDraft.to, mark);
      }

      view.dispatch(tr.scrollIntoView());
      view.focus();
      setLinkDraft(null);
      setSelectedArticle(null);
      updateUnlinkButtonState();
    };

    const openYoutubeEmbedDialog = () => {
      const instance = getEditorInstance();
      if (!instance?.isWysiwygMode?.()) return;
      setLinkDraft(null);
      setYoutubeDraft({ title: '', videoIdOrUrl: '' });
    };

    const applyYoutubeDraft = () => {
      if (!youtubeDraft) return;
      const id = extractYoutubeVideoIdFromUserInput(youtubeDraft.videoIdOrUrl);
      if (!id) {
        showAlert('Enter a valid YouTube URL or 11-character video ID.', 'error');
        return;
      }
      const altText = (youtubeDraft.title.trim() || 'YouTube video').replace(/\]/g, '');
      const instance = getEditorInstance();
      instance?.exec?.('addImage', { imageUrl: youtubeEmbedEditorThumbnailUrl(id), altText });
      setYoutubeDraft(null);
      instance?.focus?.();
    };

    const removeTouchedLinks = () => {
      const instance = getEditorInstance();
      if (!instance?.isWysiwygMode?.()) return;
      const view = instance.wwEditor?.view;
      if (!view?.state?.schema?.marks?.link) return;

      const ranges = getTouchedLinkRanges(view);
      if (!ranges.length) return;

      let tr = view.state.tr;
      for (const range of ranges) {
        tr = tr.removeMark(range.from, range.to, view.state.schema.marks.link);
      }
      view.dispatch(tr.scrollIntoView());
      view.focus();
      updateUnlinkButtonState();
    };

    const applyCannedStyle = (style: CannedStyle) => {
      const instance = getEditorInstance();
      if (!instance?.isWysiwygMode?.()) return;
      const view = instance.wwEditor?.view;
      if (!view) return;

      const { schema, selection, tr } = view.state;
      if (selection.empty) return;

      let nextTr = tr;
      if (schema.marks.small) nextTr = nextTr.removeMark(selection.from, selection.to, schema.marks.small);
      if (schema.marks.span) nextTr = nextTr.removeMark(selection.from, selection.to, schema.marks.span);
      const styledBlock = getBlockStyleRange(view);
      if (style === 'default') {
        if (styledBlock) {
          const attrs = { ...(styledBlock.node.attrs ?? {}), classNames: null };
          nextTr = nextTr.setNodeMarkup(styledBlock.from, undefined, attrs);
        }
        view.dispatch(nextTr.scrollIntoView());
        view.focus();
        return;
      }

      const option = CANNED_STYLE_OPTIONS.find((item) => item.value === style);
      if (!option) return;

      if (option.kind === 'block') {
        const blocks = styledBlock ? [{ from: styledBlock.from, node: styledBlock.node }] : getSelectedTextBlocks(view);
        if (!blocks.length) return;
        for (const block of blocks) {
          nextTr = nextTr.setNodeMarkup(block.from, undefined, {
            ...(block.node.attrs ?? {}),
            classNames: [style],
          });
        }
        view.dispatch(nextTr.scrollIntoView());
        view.focus();
        return;
      }

      const markType = option.tag ? schema.marks[option.tag] : null;
      if (!markType) return;

      const mark = markType.create({
        htmlAttrs: {
          class: style,
        },
      });

      view.dispatch(nextTr.addMark(selection.from, selection.to, mark).scrollIntoView());
      view.focus();
    };

    const handleEditorLoad = () => {
      setTimeout(() => {
        const instance = getEditorInstance();
        const pmRoot = (instance?.wwEditor?.view as unknown as { dom?: HTMLElement } | undefined)?.dom;

        if (pmRoot && enableManagedFileImageEditRef.current) {
          const resolveManagedImg = (eventTarget: EventTarget | null): HTMLImageElement | null => {
            if (eventTarget instanceof HTMLImageElement) return eventTarget;
            if (eventTarget instanceof Element) {
              const found = eventTarget.closest('img');
              return found instanceof HTMLImageElement ? found : null;
            }
            return null;
          };

          const onDblClick = (event: MouseEvent) => {
            if (!enableManagedFileImageEditRef.current) return;
            const img = resolveManagedImg(event.target);
            if (!img) return;
            const id = parseManagedFileIdFromImageSrc(img.src);
            if (id == null) return;
            event.preventDefault();
            // Toast UI / ProseMirror register native DOM listeners on the editing surface that run after
            // this capture-phase handler and do not consult defaultPrevented; stopPropagation avoids double-handling.
            event.stopPropagation();
            void openManagedImageEditorRef.current(id);
          };

          const onMouseMove = (event: MouseEvent) => {
            if (!enableManagedFileImageEditRef.current) return;
            const img = resolveManagedImg(event.target);
            if (img) {
              const id = parseManagedFileIdFromImageSrc(img.src);
              if (id != null) {
                const r = img.getBoundingClientRect();
                setHoverManagedImageEdit((prev) => {
                  if (
                    prev &&
                    prev.fileId === id &&
                    Math.abs(prev.top - r.top) < 0.5 &&
                    Math.abs(prev.right - r.right) < 0.5
                  ) {
                    return prev;
                  }
                  return { fileId: id, top: r.top, right: r.right };
                });
                return;
              }
            }
            setHoverManagedImageEdit(null);
          };

          const onMouseLeave = (event: MouseEvent) => {
            const related = event.relatedTarget;
            if (related instanceof Node && hoverManagedImageChipRef.current?.contains(related)) {
              return;
            }
            setHoverManagedImageEdit(null);
          };

          pmRoot.addEventListener('dblclick', onDblClick, true);
          pmRoot.addEventListener('mousemove', onMouseMove);
          pmRoot.addEventListener('mouseleave', onMouseLeave);
          toolbarCleanupRef.current.push(() => {
            pmRoot.removeEventListener('dblclick', onDblClick, true);
            pmRoot.removeEventListener('mousemove', onMouseMove);
            pmRoot.removeEventListener('mouseleave', onMouseLeave);
          });
        }

        if (!instance?.insertToolbarItem) return;

        try {
          const convertor = (instance as unknown as {
            convertor?: {
              toMdConvertors?: {
                nodeTypeConvertors?: Record<
                  string,
                  (
                    state: {
                      write: (text: string) => void;
                      convertInline: (node: unknown) => void;
                      closeBlock: (node: unknown) => void;
                    },
                    nodeInfo: { node: WysiwygNode; parent?: WysiwygParentNode; index?: number }
                  ) => void
                >;
              };
            };
          }).convertor;
          const nodeTypeConvertors = convertor?.toMdConvertors?.nodeTypeConvertors;
          const originalParagraph = nodeTypeConvertors?.paragraph;
          if (nodeTypeConvertors && originalParagraph) {
            nodeTypeConvertors.paragraph = function patchedParagraph(state, nodeInfo) {
              const className = getTccBlockClassFromWysiwygNode(nodeInfo.node);
              if (className) {
                const previous =
                  typeof nodeInfo.index === 'number' && nodeInfo.index > 0
                    ? nodeInfo.parent?.child?.(nodeInfo.index - 1)
                    : undefined;
                const next =
                  typeof nodeInfo.index === 'number' && nodeInfo.parent && nodeInfo.index < (nodeInfo.parent.childCount ?? 0) - 1
                    ? nodeInfo.parent.child?.(nodeInfo.index + 1)
                    : undefined;
                const isFirstInRun = getTccBlockClassFromWysiwygNode(previous) !== className;
                const isLastInRun = getTccBlockClassFromWysiwygNode(next) !== className;

                if (isFirstInRun) {
                  state.write(`<div class="${className}">`);
                }
                state.write('<p>');
                state.convertInline(nodeInfo.node);
                state.write('</p>');
                if (isLastInRun) {
                  state.write('</div>');
                  state.closeBlock(nodeInfo.node);
                } else {
                  state.write('\n');
                }
                return;
              }
              return originalParagraph(state, nodeInfo);
            };
          }
        } catch {
          /* ignore convertor patch failures */
        }
        const normalizeCurrentWysiwyg = () => {
          const view = instance.wwEditor?.view;
          if (view) normalizeStyledHtmlBlocks(view);
        };
        normalizeCurrentWysiwyg();
        instance.on?.('changeMode', (mode) => {
          if (mode === 'wysiwyg') {
            requestAnimationFrame(normalizeCurrentWysiwyg);
          }
        });

        if (onUploadImage && instance.addHook) {
          instance.addHook('addImageBlobHook', async (blob: Blob, callback: (url: string, text?: string) => void) => {
            try {
              const uploaded = await onUploadImage(blob);
              if (uploaded?.url) {
                callback(uploaded.url, uploaded.altText ?? '');
              }
            } catch {
              // Upload errors are handled by caller.
            }
            // Prevent ToastUI from inserting base64 data URLs.
            return false;
          });
        }

        if (readMoreInToolbar) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'toastui-editor-toolbar-icons';
          btn.style.cssText = 'width:28px;height:28px;font-size:14px;line-height:1;color:#01B9BC;';
          btn.title = 'Insert read more';
          btn.textContent = READ_MORE_MARKER;
          btn.addEventListener('click', () => {
            instance.insertText?.('\n\n' + READ_MORE_MARKER + '\n\n');
          });
          try {
            instance.insertToolbarItem({ groupIndex: 3, itemIndex: 1 }, {
              name: 'readmore',
              tooltip: 'Insert read more',
              el: btn,
            });
          } catch {
            /* ignore */
          }
        }

        const stylesContainer = document.createElement('div');
        stylesContainer.className = 'tcc-editor-styles-toolbar-item';
        createRoot(stylesContainer).render(<ToolbarStylesDropdown onApplyStyle={applyCannedStyle} />);
        try {
          instance.insertToolbarItem({ groupIndex: 0, itemIndex: 1 }, {
            name: 'tccStyles',
            tooltip: 'Styles',
            el: stylesContainer,
          });
        } catch {
          /* ignore */
        }

        const linkBtn = createToolbarIconButton('Create or edit link (Ctrl+K)', <HiOutlineLink aria-hidden="true" />);
        linkBtn.addEventListener('click', openLinkDialog);
        try {
          instance.insertToolbarItem({ groupIndex: 3, itemIndex: 0 }, {
            name: 'tccLink',
            tooltip: 'Create or edit link',
            el: linkBtn,
          });
        } catch {
          /* ignore */
        }

        const unlinkBtn = createToolbarIconButton('Remove link', <HiOutlineLinkSlash aria-hidden="true" />);
        unlinkBtn.disabled = true;
        unlinkBtn.setAttribute('aria-disabled', 'true');
        unlinkButtonRef.current = unlinkBtn;
        unlinkBtn.addEventListener('click', removeTouchedLinks);
        try {
          instance.insertToolbarItem({ groupIndex: 3, itemIndex: 1 }, {
            name: 'tccUnlink',
            tooltip: 'Remove link',
            el: unlinkBtn,
          });
        } catch {
          /* ignore */
        }

        const youtubeBtn = createToolbarIconButton('Insert YouTube video', <HiOutlinePlayCircle aria-hidden="true" />);
        youtubeBtn.addEventListener('click', openYoutubeEmbedDialog);
        try {
          instance.insertToolbarItem({ groupIndex: 3, itemIndex: 2 }, {
            name: 'tccYoutube',
            tooltip: 'Insert YouTube video',
            el: youtubeBtn,
          });
        } catch {
          /* ignore */
        }

        const viewDom = instance.wwEditor?.view as unknown as { dom?: HTMLElement };
        const queueUnlinkStateUpdate = () => requestAnimationFrame(updateUnlinkButtonState);
        viewDom.dom?.addEventListener('keyup', queueUnlinkStateUpdate);
        viewDom.dom?.addEventListener('mouseup', queueUnlinkStateUpdate);
        viewDom.dom?.addEventListener('focusin', queueUnlinkStateUpdate);
        document.addEventListener('selectionchange', queueUnlinkStateUpdate);
        toolbarCleanupRef.current.push(() => {
          viewDom.dom?.removeEventListener('keyup', queueUnlinkStateUpdate);
          viewDom.dom?.removeEventListener('mouseup', queueUnlinkStateUpdate);
          viewDom.dom?.removeEventListener('focusin', queueUnlinkStateUpdate);
          document.removeEventListener('selectionchange', queueUnlinkStateUpdate);
        });
        updateUnlinkButtonState();
        viewDom.dom?.addEventListener('keydown', (event: KeyboardEvent) => {
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
            event.preventDefault();
            openLinkDialog();
          }
        });

        if (instance?.getMarkdown) {
          onWysiwygReady?.();
        }
      }, 0);
    };

    useEffect(() => {
      return () => {
        for (const cleanup of toolbarCleanupRef.current) cleanup();
        toolbarCleanupRef.current = [];
      };
    }, []);

    useEffect(() => {
      if (!linkDraft) return;
      const target = linkDraft.text.trim() ? linkUrlInputRef.current : linkTextInputRef.current;
      requestAnimationFrame(() => target?.focus());
    }, [linkDraft]);

    useEffect(() => {
      const open = youtubeDraft != null;
      if (open && !youtubeDialogWasOpenRef.current) {
        requestAnimationFrame(() => youtubeVideoInputRef.current?.focus());
      }
      youtubeDialogWasOpenRef.current = open;
    }, [youtubeDraft != null]);

    useEffect(() => {
      if (!youtubeDraft) return;
      const onPointerDown = (event: PointerEvent) => {
        const panel = youtubeDialogRef.current;
        const target = event.target;
        if (!(target instanceof Node) || !panel || panel.contains(target)) return;
        setYoutubeDraft(null);
      };
      document.addEventListener('pointerdown', onPointerDown, true);
      return () => document.removeEventListener('pointerdown', onPointerDown, true);
    }, [youtubeDraft != null]);

    useEffect(() => {
      const applyTheme = (root: Element) => {
        if (dark) {
          root.classList.add('toastui-editor-dark');
        } else {
          root.classList.remove('toastui-editor-dark');
        }
      };

      const wrapper = wrapperRef.current;
      if (!wrapper) return;

      const root = wrapper.querySelector('.toastui-editor-defaultUI');
      if (root) {
        applyTheme(root);
        return;
      }

      const observer = new MutationObserver(() => {
        const el = wrapper.querySelector('.toastui-editor-defaultUI');
        if (el) {
          applyTheme(el);
        }
      });
      observer.observe(wrapper, { childList: true, subtree: true });
      return () => observer.disconnect();
    }, [dark]);

    useEffect(() => {
      if (!fill || !wrapperRef.current) return;
      const el = wrapperRef.current;
      const updateHeight = () => {
        const height = el.clientHeight || el.getBoundingClientRect().height || 300;
        setFillHeight(Math.max(200, height));
      };
      const ro = new ResizeObserver((entries) => {
        const { height } = entries[0]?.contentRect ?? {};
        if (height && height > 0) setFillHeight(Math.max(200, height));
        else updateHeight();
      });
      ro.observe(el);
      updateHeight();
      const raf = requestAnimationFrame(updateHeight);
      const t = setTimeout(updateHeight, 100);
      return () => {
        ro.disconnect();
        cancelAnimationFrame(raf);
        clearTimeout(t);
      };
    }, [fill]);

    const editorHeight = fill ? `${fillHeight}px` : minHeight;

    return (
      <div
        ref={wrapperRef}
        className={`markdown-description-editor relative ${fill ? 'flex-1 min-h-0 flex flex-col' : ''} ${className}`}
        onClickCapture={(event) => {
          const target = event.target instanceof Element ? event.target : null;
          const link = target?.closest('.toastui-editor-ww-container a');
          if (!link) return;
          event.preventDefault();
        }}
      >
        <style>{`
          .markdown-description-editor .toastui-editor-defaultUI .ProseMirror {
            height: 100% !important;
            overflow-y: auto;
            scrollbar-gutter: stable;
          }
          .markdown-description-editor .toastui-editor-ww-container .ProseMirror {
            color: #374151;
            line-height: 1.65;
          }
          .markdown-description-editor .toastui-editor-dark .ProseMirror,
          .markdown-description-editor .toastui-editor-dark .toastui-editor-ww-container {
            background-color: #374151 !important;
          }
          .markdown-description-editor .toastui-editor-dark .toastui-editor-ww-container .ProseMirror {
            color: #d1d5db;
          }
          .markdown-description-editor .toastui-editor-ww-container a {
            pointer-events: none;
            cursor: text;
          }
          .markdown-description-editor.flex-1 .toastui-editor-defaultUI {
            flex: 1;
            min-height: 0;
            display: flex;
            flex-direction: column;
          }
          .markdown-description-editor.flex-1 .toastui-editor-defaultUI .ProseMirror {
            flex: 1;
          }
          .markdown-description-editor .tcc-editor-icon-button {
            width: 28px;
            height: 28px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            color: #374151 !important;
            background: transparent !important;
            background-image: none !important;
            border: 0 !important;
            border-radius: 3px;
            outline: none !important;
            box-shadow: none !important;
            padding: 0;
            margin: 0;
            line-height: 1 !important;
            vertical-align: middle;
            cursor: pointer;
          }
          .markdown-description-editor .tcc-editor-icon-button svg {
            width: 21px;
            height: 21px;
            stroke-width: 1.8;
          }
          .markdown-description-editor .tcc-editor-icon-button:hover {
            background-color: rgba(31, 41, 55, 0.08) !important;
            border: 0 !important;
            outline: none !important;
            box-shadow: none !important;
          }
          .markdown-description-editor .tcc-editor-icon-button:focus,
          .markdown-description-editor .tcc-editor-icon-button:active,
          .markdown-description-editor .tcc-editor-icon-button:hover:focus {
            border: 0 !important;
            outline: none !important;
            box-shadow: none !important;
          }
          .markdown-description-editor .tcc-editor-icon-button:focus-visible {
            outline: 2px solid #01B9BC !important;
            outline-offset: 2px;
          }
          .markdown-description-editor .tcc-editor-icon-button:disabled {
            cursor: default;
            opacity: 0.3;
          }
          .markdown-description-editor .tcc-editor-icon-button:disabled:hover {
            background-color: transparent !important;
          }
          .markdown-description-editor .toastui-editor-dark .tcc-editor-icon-button {
            color: #e5e7eb !important;
          }
          .markdown-description-editor .toastui-editor-dark .tcc-editor-icon-button:hover {
            background-color: rgba(229, 231, 235, 0.12) !important;
            border: 0 !important;
            outline: none !important;
            box-shadow: none !important;
          }
          .markdown-description-editor .toastui-editor-dark .tcc-editor-icon-button:disabled:hover {
            background-color: transparent !important;
          }
          .markdown-description-editor .tcc-editor-styles-toolbar-item {
            position: relative;
            height: 28px;
            display: inline-flex;
            align-items: center;
          }
          .markdown-description-editor .tcc-editor-styles-dropdown {
            position: relative;
          }
          .markdown-description-editor .tcc-editor-style-button {
            width: 28px;
            height: 28px;
            display: inline-flex;
            align-items: center;
            gap: 4px;
            border: 0 !important;
            border-radius: 3px;
            background: transparent !important;
            justify-content: center;
            padding: 0;
            color: #374151;
            font-size: 12px;
            font-weight: 600;
            line-height: 1;
            cursor: pointer;
            outline: none !important;
            box-shadow: none !important;
          }
          .markdown-description-editor .tcc-editor-style-button:hover {
            background-color: rgba(31, 41, 55, 0.08) !important;
          }
          .markdown-description-editor .tcc-editor-style-button:focus-visible {
            outline: 2px solid #01B9BC !important;
            outline-offset: 2px;
          }
          .markdown-description-editor .tcc-editor-style-button svg {
            width: 21px;
            height: 21px;
            stroke-width: 1.8;
          }
          .tcc-editor-style-menu {
            z-index: 30;
            min-width: 180px;
            border: 1px solid #e5e7eb;
            border-radius: 8px;
            background: white;
            padding: 4px;
            box-shadow: 0 12px 30px rgba(15, 23, 42, 0.18);
          }
          .tcc-editor-style-menu button {
            width: 100%;
            display: flex;
            flex-direction: column;
            align-items: flex-start;
            gap: 2px;
            border: 0;
            border-radius: 6px;
            background: transparent;
            padding: 8px 10px;
            color: #111827;
            text-align: left;
            cursor: pointer;
          }
          .tcc-editor-style-menu button:hover,
          .tcc-editor-style-menu button:focus {
            background: #f3f4f6;
            outline: none;
          }
          .tcc-editor-style-menu-description {
            color: #6b7280;
            font-size: 11px;
          }
          .tcc-editor-style-menu-divider {
            margin: 6px 0;
            border: 0;
            border-top: 1px solid #e5e7eb;
          }
          .markdown-description-editor .toastui-editor-contents .tcc-style-informational,
          .markdown-description-editor .toastui-editor-ww-container .ProseMirror .tcc-style-informational {
            font-size: 0.875em !important;
            line-height: 1.5 !important;
            color: #4b5563 !important;
          }
          .markdown-description-editor .toastui-editor-contents .tcc-style-info-box,
          .markdown-description-editor .toastui-editor-ww-container .ProseMirror p.tcc-style-info-box,
          .markdown-description-editor .toastui-editor-ww-container .ProseMirror div.tcc-style-info-box,
          .markdown-description-editor .toastui-editor-contents .tcc-style-critical-box,
          .markdown-description-editor .toastui-editor-ww-container .ProseMirror p.tcc-style-critical-box,
          .markdown-description-editor .toastui-editor-ww-container .ProseMirror div.tcc-style-critical-box,
          .markdown-description-editor .toastui-editor-contents .tcc-style-callout,
          .markdown-description-editor .toastui-editor-ww-container .ProseMirror p.tcc-style-callout,
          .markdown-description-editor .toastui-editor-ww-container .ProseMirror div.tcc-style-callout,
          .markdown-description-editor .toastui-editor-contents .tcc-style-aside,
          .markdown-description-editor .toastui-editor-ww-container .ProseMirror p.tcc-style-aside,
          .markdown-description-editor .toastui-editor-ww-container .ProseMirror div.tcc-style-aside {
            display: block !important;
            margin: 0.85rem 0 !important;
            padding: 0.75rem 0.9rem !important;
            border-radius: 0.625rem !important;
            font-size: 1em !important;
            line-height: 1.55 !important;
          }
          .markdown-description-editor .toastui-editor-contents .tcc-style-info-box,
          .markdown-description-editor .toastui-editor-ww-container .ProseMirror p.tcc-style-info-box,
          .markdown-description-editor .toastui-editor-ww-container .ProseMirror div.tcc-style-info-box {
            border: 1px solid #bfdbfe !important;
            background: #eff6ff !important;
            color: #1e3a8a !important;
          }
          .markdown-description-editor .toastui-editor-contents .tcc-style-critical-box,
          .markdown-description-editor .toastui-editor-ww-container .ProseMirror p.tcc-style-critical-box,
          .markdown-description-editor .toastui-editor-ww-container .ProseMirror div.tcc-style-critical-box {
            border: 1px solid #fecaca !important;
            background: #fef2f2 !important;
            color: #991b1b !important;
          }
          .markdown-description-editor .toastui-editor-contents .tcc-style-callout,
          .markdown-description-editor .toastui-editor-ww-container .ProseMirror p.tcc-style-callout,
          .markdown-description-editor .toastui-editor-ww-container .ProseMirror div.tcc-style-callout {
            border: 1px solid #d1d5db !important;
            background: #f9fafb !important;
            color: #374151 !important;
          }
          .markdown-description-editor .toastui-editor-contents .tcc-style-aside,
          .markdown-description-editor .toastui-editor-ww-container .ProseMirror p.tcc-style-aside,
          .markdown-description-editor .toastui-editor-ww-container .ProseMirror div.tcc-style-aside {
            float: right !important;
            clear: right !important;
            width: min(45%, 18rem) !important;
            margin: 0.25rem 0 0.75rem 1rem !important;
            border: 1px solid #d1d5db !important;
            background: #f9fafb !important;
            color: #374151 !important;
            font-size: 0.925em !important;
          }
          /* Merge sibling paras with the same block class into one visual card */
          .markdown-description-editor .toastui-editor-ww-container .ProseMirror p.tcc-style-info-box:has(+ p.tcc-style-info-box),
          .markdown-description-editor .toastui-editor-ww-container .ProseMirror p.tcc-style-critical-box:has(+ p.tcc-style-critical-box),
          .markdown-description-editor .toastui-editor-ww-container .ProseMirror p.tcc-style-callout:has(+ p.tcc-style-callout),
          .markdown-description-editor .toastui-editor-ww-container .ProseMirror p.tcc-style-aside:has(+ p.tcc-style-aside) {
            margin-bottom: 0 !important;
            border-bottom-left-radius: 0 !important;
            border-bottom-right-radius: 0 !important;
            border-bottom: none !important;
            padding-bottom: 0.35rem !important;
          }
          .markdown-description-editor .toastui-editor-ww-container .ProseMirror p.tcc-style-info-box + p.tcc-style-info-box,
          .markdown-description-editor .toastui-editor-ww-container .ProseMirror p.tcc-style-critical-box + p.tcc-style-critical-box,
          .markdown-description-editor .toastui-editor-ww-container .ProseMirror p.tcc-style-callout + p.tcc-style-callout,
          .markdown-description-editor .toastui-editor-ww-container .ProseMirror p.tcc-style-aside + p.tcc-style-aside {
            margin-top: 0 !important;
            border-top-left-radius: 0 !important;
            border-top-right-radius: 0 !important;
            border-top: none !important;
            padding-top: 0.35rem !important;
          }
          .markdown-description-editor .toastui-editor-contents .tcc-style-green,
          .markdown-description-editor .toastui-editor-ww-container .ProseMirror .tcc-style-green {
            font-size: 1em !important;
            color: #27ae60 !important;
          }
          .markdown-description-editor .toastui-editor-contents .tcc-style-red,
          .markdown-description-editor .toastui-editor-ww-container .ProseMirror .tcc-style-red {
            font-size: 1em !important;
            color: #e74c3c !important;
          }
          .markdown-description-editor .toastui-editor-contents .tcc-style-yellow,
          .markdown-description-editor .toastui-editor-ww-container .ProseMirror .tcc-style-yellow {
            font-size: 1em !important;
            color: #f39c12 !important;
          }
          .markdown-description-editor .toastui-editor-contents .tcc-style-button-link,
          .markdown-description-editor .toastui-editor-ww-container .ProseMirror .tcc-style-button-link {
            display: inline-block !important;
            border-radius: 9999px !important;
            background: #01B9BC !important;
            padding: 0.35rem 0.75rem !important;
            color: white !important;
            font-size: 1em !important;
            font-weight: 700 !important;
            line-height: 1.2 !important;
          }
          .markdown-description-editor .toastui-editor-contents .tcc-style-button-link a,
          .markdown-description-editor .toastui-editor-ww-container .ProseMirror .tcc-style-button-link a {
            color: inherit !important;
            text-decoration: none !important;
          }
          .markdown-description-editor .toastui-editor-contents .tcc-style-muted,
          .markdown-description-editor .toastui-editor-ww-container .ProseMirror .tcc-style-muted {
            font-size: 1em !important;
            color: #6b7280 !important;
          }
          .markdown-description-editor .toastui-editor-contents .tcc-style-lead,
          .markdown-description-editor .toastui-editor-ww-container .ProseMirror .tcc-style-lead {
            font-size: 1.18em !important;
            line-height: 1.6 !important;
            color: #374151 !important;
          }
          .markdown-description-editor .toastui-editor-contents .tcc-style-badge,
          .markdown-description-editor .toastui-editor-ww-container .ProseMirror .tcc-style-badge {
            display: inline-block !important;
            border: 1px solid #99f6e4 !important;
            border-radius: 9999px !important;
            background: #ccfbf1 !important;
            padding: 0.12rem 0.5rem !important;
            color: #115e59 !important;
            font-size: 0.78em !important;
            font-weight: 700 !important;
            letter-spacing: 0.02em !important;
            line-height: 1.4 !important;
            text-transform: uppercase !important;
          }
          .markdown-description-editor .toastui-editor-dark .tcc-editor-style-button {
            color: #e5e7eb;
          }
          .markdown-description-editor .toastui-editor-dark .tcc-editor-style-button:hover {
            background-color: rgba(229, 231, 235, 0.12) !important;
          }
          .markdown-description-editor .toastui-editor-dark .toastui-editor-contents .tcc-style-informational,
          .markdown-description-editor .toastui-editor-dark .toastui-editor-ww-container .ProseMirror .tcc-style-informational {
            color: #d1d5db !important;
          }
          .markdown-description-editor .toastui-editor-dark .toastui-editor-contents .tcc-style-info-box,
          .markdown-description-editor .toastui-editor-dark .toastui-editor-ww-container .ProseMirror p.tcc-style-info-box,
          .markdown-description-editor .toastui-editor-dark .toastui-editor-ww-container .ProseMirror div.tcc-style-info-box {
            border-color: #1d4ed8 !important;
            background: rgba(30, 64, 175, 0.22) !important;
            color: #dbeafe !important;
          }
          .markdown-description-editor .toastui-editor-dark .toastui-editor-contents .tcc-style-critical-box,
          .markdown-description-editor .toastui-editor-dark .toastui-editor-ww-container .ProseMirror p.tcc-style-critical-box,
          .markdown-description-editor .toastui-editor-dark .toastui-editor-ww-container .ProseMirror div.tcc-style-critical-box {
            border-color: #991b1b !important;
            background: rgba(127, 29, 29, 0.26) !important;
            color: #fee2e2 !important;
          }
          .markdown-description-editor .toastui-editor-dark .toastui-editor-contents .tcc-style-callout,
          .markdown-description-editor .toastui-editor-dark .toastui-editor-ww-container .ProseMirror p.tcc-style-callout,
          .markdown-description-editor .toastui-editor-dark .toastui-editor-ww-container .ProseMirror div.tcc-style-callout {
            border-color: #4b5563 !important;
            background: rgba(31, 41, 55, 0.85) !important;
            color: #e5e7eb !important;
          }
          .markdown-description-editor .toastui-editor-dark .toastui-editor-contents .tcc-style-aside,
          .markdown-description-editor .toastui-editor-dark .toastui-editor-ww-container .ProseMirror p.tcc-style-aside,
          .markdown-description-editor .toastui-editor-dark .toastui-editor-ww-container .ProseMirror div.tcc-style-aside {
            border-color: #4b5563 !important;
            background: rgba(31, 41, 55, 0.85) !important;
            color: #e5e7eb !important;
          }
          .markdown-description-editor .toastui-editor-dark .toastui-editor-contents .tcc-style-muted,
          .markdown-description-editor .toastui-editor-dark .toastui-editor-ww-container .ProseMirror .tcc-style-muted {
            color: #9ca3af !important;
          }
          .markdown-description-editor .toastui-editor-dark .toastui-editor-contents .tcc-style-lead,
          .markdown-description-editor .toastui-editor-dark .toastui-editor-ww-container .ProseMirror .tcc-style-lead {
            color: #f3f4f6 !important;
          }
          .markdown-description-editor .toastui-editor-dark .toastui-editor-contents .tcc-style-badge,
          .markdown-description-editor .toastui-editor-dark .toastui-editor-ww-container .ProseMirror .tcc-style-badge {
            border-color: #0f766e !important;
            background: rgba(20, 184, 166, 0.22) !important;
            color: #ccfbf1 !important;
          }
          .markdown-description-editor .toastui-editor-ww-container .ProseMirror img[src*="img.youtube.com/vi/"] {
            display: block;
            width: 100%;
            max-width: 560px;
            height: auto;
            aspect-ratio: 16 / 9;
            object-fit: cover;
            border-radius: 0.375rem;
            border: 1px solid #374151;
          }
          .markdown-description-editor .toastui-editor-dark .toastui-editor-ww-container .ProseMirror img[src*="img.youtube.com/vi/"] {
            border-color: #4b5563;
          }
          .markdown-description-editor .toastui-editor-ww-container .ProseMirror img[src^="youtube://"] {
            display: block;
            width: 100%;
            max-width: 560px;
            aspect-ratio: 16 / 9;
            object-fit: cover;
            background: linear-gradient(135deg, #1f2937 0%, #111827 100%);
            border: 1px solid #374151;
          }
          .markdown-description-editor .toastui-editor-dark .toastui-editor-ww-container .ProseMirror img[src^="youtube://"] {
            border-color: #4b5563;
          }
        `}</style>
        <Editor
          ref={editorRef}
          initialValue={
            initialValue.trim() === '' ? EMPTY_INITIAL : markdownYoutubeEmbedsForWysiwyg(initialValue.trim())
          }
          placeholder={placeholder}
          initialEditType="wysiwyg"
          height={editorHeight}
          useCommandShortcut
          usageStatistics={false}
          onLoad={handleEditorLoad}
          plugins={[linkEditPlugin, tccBlockStyleEnterPlugin]}
          customMarkdownRenderer={{
            html: markdownHtmlRenderer,
          }}
          customHTMLRenderer={{
            htmlBlock: {
              div: (node: { attrs?: Record<string, string>; childrenHTML?: string }) => [
                { type: 'openTag', tagName: 'div', attributes: node.attrs ?? {} },
                { type: 'html', content: node.childrenHTML ?? '' },
                { type: 'closeTag', tagName: 'div' },
              ],
            },
            htmlInline: {
              small: (node: { attrs?: Record<string, string> }, context: { entering: boolean }) =>
                renderHTMLTagToken('small', node, context),
              span: (node: { attrs?: Record<string, string> }, context: { entering: boolean }) =>
                renderHTMLTagToken('span', node, context),
            },
          }}
          toolbarItems={[
            ['heading', 'bold', 'italic', 'strike'],
            ['hr', 'quote'],
            ['ul', 'ol'],
            [],
          ]}
        />
        {linkDraft ? (
          <div
            className="absolute inset-x-4 top-12 z-20 max-w-xl rounded-xl border border-gray-200 bg-white p-4 shadow-2xl shadow-gray-900/20 dark:border-gray-700 dark:bg-gray-900"
            role="dialog"
            aria-label="Create or edit link"
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                setLinkDraft(null);
              } else if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                applyLinkDraft();
              }
            }}
          >
            <div className="mb-3 flex items-start justify-between gap-4">
              <div>
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Create or edit link</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Select an article or paste a URL. Edge spaces are kept outside the link.
                </p>
              </div>
              <button
                type="button"
                className="rounded px-2 py-1 text-sm text-gray-500 hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary-teal dark:hover:bg-gray-800 dark:hover:text-gray-200"
                onClick={() => setLinkDraft(null)}
              >
                Close
              </button>
            </div>
            <div className="space-y-3">
              <FormField label="Link text" htmlFor={linkTextId} required>
                <input
                  id={linkTextId}
                  ref={linkTextInputRef}
                  className="app-input"
                  value={linkDraft.text}
                  onChange={(event) => setLinkDraft((draft) => (draft ? { ...draft, text: event.target.value } : draft))}
                />
              </FormField>
              <FormField label="Published article" htmlFor={articlePickerId} helperText="Choosing an article fills in the URL below.">
                <ArticleAutocomplete
                  inputId={articlePickerId}
                  value={selectedArticle}
                  onChange={(article) => {
                    setSelectedArticle(article);
                    if (article) {
                      setLinkDraft((draft) => (draft ? { ...draft, url: `/articles/${article.slug}` } : draft));
                    }
                  }}
                  placeholder="Search published articles..."
                />
              </FormField>
              <FormField label="URL" htmlFor={linkUrlId} required>
                <input
                  id={linkUrlId}
                  ref={linkUrlInputRef}
                  className="app-input font-mono text-sm"
                  value={linkDraft.url}
                  onChange={(event) => {
                    setSelectedArticle(null);
                    setLinkDraft((draft) => (draft ? { ...draft, url: event.target.value } : draft));
                  }}
                  placeholder="https://example.com or /articles/example"
                />
              </FormField>
              <FormCheckbox
                label="Open in new window"
                checked={linkDraft.openInNewWindow}
                onChange={(openInNewWindow) =>
                  setLinkDraft((draft) => (draft ? { ...draft, openInNewWindow } : draft))
                }
              />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary-teal dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800"
                onClick={() => setLinkDraft(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded-md bg-primary-teal px-3 py-2 text-sm font-medium text-white hover:bg-primary-teal/90 focus:outline-none focus:ring-2 focus:ring-primary-teal focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={!linkDraft.text.trim() || !linkDraft.url.trim()}
                onClick={applyLinkDraft}
              >
                Apply link
              </button>
            </div>
          </div>
        ) : null}
        {youtubeDraft ? (
          <div
            ref={youtubeDialogRef}
            className="absolute inset-x-4 top-12 z-20 max-w-xl rounded-xl border border-gray-200 bg-white p-4 shadow-2xl shadow-gray-900/20 dark:border-gray-700 dark:bg-gray-900"
            role="dialog"
            aria-label="Insert YouTube video"
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                setYoutubeDraft(null);
              } else if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                applyYoutubeDraft();
              }
            }}
          >
            <div className="mb-3 flex items-start justify-between gap-4">
              <div>
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Insert YouTube video</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Inserts <span className="font-mono text-[11px]">![title](youtube://…)</span> so the video appears on the public article.
                </p>
              </div>
              <button
                type="button"
                className="rounded px-2 py-1 text-sm text-gray-500 hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary-teal dark:hover:bg-gray-800 dark:hover:text-gray-200"
                onClick={() => setYoutubeDraft(null)}
              >
                Close
              </button>
            </div>
            <div className="space-y-3">
              <FormField
                label="Video title for accessibility"
                htmlFor={youtubeTitleId}
                helperText="Shown as the iframe title and when the embed cannot load."
              >
                <input
                  id={youtubeTitleId}
                  className="app-input"
                  value={youtubeDraft.title}
                  onChange={(event) =>
                    setYoutubeDraft((draft) => (draft ? { ...draft, title: event.target.value } : draft))
                  }
                  placeholder="e.g. Final draw highlights"
                />
              </FormField>
              <FormField
                label="YouTube URL or video ID"
                htmlFor={youtubeUrlId}
                required
                helperText="Paste a watch, embed, Shorts, or youtu.be link, or an 11-character ID."
              >
                <input
                  id={youtubeUrlId}
                  ref={youtubeVideoInputRef}
                  className="app-input font-mono text-sm"
                  value={youtubeDraft.videoIdOrUrl}
                  onChange={(event) =>
                    setYoutubeDraft((draft) => (draft ? { ...draft, videoIdOrUrl: event.target.value } : draft))
                  }
                  placeholder="https://www.youtube.com/watch?v=…"
                />
              </FormField>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary-teal dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800"
                onClick={() => setYoutubeDraft(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded-md bg-primary-teal px-3 py-2 text-sm font-medium text-white hover:bg-primary-teal/90 focus:outline-none focus:ring-2 focus:ring-primary-teal focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={!youtubeDraft.videoIdOrUrl.trim()}
                onClick={applyYoutubeDraft}
              >
                Insert video
              </button>
            </div>
          </div>
        ) : null}
        {enableManagedFileImageEdit ? (
          <ContentFileEditModal
            isOpen={managedImageModal.open}
            file={managedImageModal.file}
            onClose={closeManagedImageModal}
            onImageBytesUpdated={handleManagedImageBytesUpdated}
          />
        ) : null}
        {enableManagedFileImageEdit && hoverManagedImageEdit
          ? createPortal(
              <div
                ref={hoverManagedImageChipRef}
                className="pointer-events-auto fixed z-[45] flex"
                style={{
                  top: hoverManagedImageEdit.top + 6,
                  left: hoverManagedImageEdit.right - 36,
                }}
              >
                <button
                  type="button"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-gray-200 bg-white/95 text-gray-600 shadow-md backdrop-blur-sm transition-colors hover:bg-white hover:text-primary-teal focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-teal/40 dark:border-gray-600 dark:bg-gray-900/95 dark:text-gray-300 dark:hover:text-primary-teal"
                  aria-label="Edit image file"
                  title="Edit image"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => void openManagedImageEditor(hoverManagedImageEdit.fileId)}
                >
                  <HiPencilSquare className="h-4 w-4" aria-hidden />
                </button>
              </div>,
              document.body
            )
          : null}
      </div>
    );
  }
);

MarkdownDescriptionEditor.displayName = 'MarkdownDescriptionEditor';

export default MarkdownDescriptionEditor;
