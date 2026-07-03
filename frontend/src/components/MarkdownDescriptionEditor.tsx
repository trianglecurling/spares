/**
 * Markdown description editor using ToastUI Editor.
 * WYSIWYG-only (no Markdown tab). Content is stored as Markdown on the backend.
 * Respects light/dark theme.
 */

import { forwardRef, useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { EditorState, TextSelection, type Command, type Plugin } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import type { ResolvedPos } from 'prosemirror-model';
import { LuIndentDecrease, LuIndentIncrease } from 'react-icons/lu';
import { TfiLayoutAccordionMerged } from 'react-icons/tfi';
import {
  HiOutlineLink,
  HiOutlineLinkSlash,
  HiOutlinePaintBrush,
  HiOutlinePhoto,
  HiOutlinePlayCircle,
  HiOutlineTrash,
  HiPencilSquare,
} from 'react-icons/hi2';
import {
  canTccOutdent,
  createTccIndentPlugin,
  createTccPreservingBlockSplit,
  getTccIndent,
  getTccIndentCssRules,
  normalizeIndentedHtmlBlocks,
  runTccListBackspace,
  TCC_INDENT_ATTR,
  writeIndentedBlockMarkdown,
} from '../utils/markdownEditorIndent';
import {
  buildInlineNodesFromHTML,
  repairMarkdownLinksInHtmlContent,
  repairMarkdownLinksInRawHtmlBlocks,
  writeWysiwygInlineAsHtml,
} from '../utils/markdownEditorInlineHtml';
import { createTccPlainTextPastePlugin } from '../utils/markdownEditorPaste';
import {
  applyAccordionBlockStyleToSelection,
  applyAccordionHeadingToSelection,
  applyAccordionInlineStyleToSelection,
  applyAccordionLinkToSelection,
  captureAccordionSelectionSnapshot,
  clampAccordionEntryCount,
  clearAccordionStylesInSelection,
  countAccordionEntries,
  createTccAccordionEditorPlugin,
  deleteTccAccordion,
  ensureTrailingParagraphAfterAccordion,
  findTccAccordionNodePos,
  getAccordionActiveFormat,
  getAccordionSelectionContext,
  hasAccordionTouchedLink,
  insertTccAccordion,
  readAccordionLinkDraftFromSelection,
  removeAccordionLinkInSelection,
  resolveTccAccordionElement,
  restoreAccordionSelectionSnapshot,
  setTccAccordionEntryCount,
  injectLiveAccordionHtmlIntoMarkdown,
  stripAccordionOpenStateFromMarkdown,
  syncTccAccordionHtmlFromDom,
  TCC_ACCORDION_EDITABLE_CLASS,
  TCC_ACCORDION_MIN_ENTRIES,
  type AccordionSelectionSnapshot,
} from '../utils/markdownEditorAccordion';
import '@toast-ui/editor/dist/toastui-editor.css';
import '@toast-ui/editor/dist/theme/toastui-editor-dark.css';
import { Editor } from '@toast-ui/react-editor';
import ArticleAutocomplete, { type ArticleOption } from './ArticleAutocomplete';
import ChoiceInput from './ChoiceInput';
import ContentFileEditModal, { type ManagedFile } from './ContentFileEditModal';
import FormCheckbox from './FormCheckbox';
import FormField from './FormField';
import { toContactRecipientChoiceOptions } from '../constants/contactRecipients';
import { PUBLIC_SYSTEM_PAGE_OPTIONS, type PublicSystemPagePath } from '../constants/publicSystemPages';
import { usePublicContactRecipients } from '../hooks/usePublicContactRecipients';
import { useAlert } from '../contexts/AlertContext';
import { useConfirm } from '../contexts/ConfirmContext';
import api from '../utils/api';
import { OPEN_IN_NEW_WINDOW_TITLE } from '../constants/markdownLink';
import {
  buildMarkdownEditorLinkUrl,
  inferMarkdownEditorLinkTarget,
  isMarkdownEditorLinkDraftReady,
  MARKDOWN_EDITOR_LINK_TYPE_CHOICES,
  type MarkdownEditorLinkType,
} from '../utils/markdownEditorLink';
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

function groupCannedStyleMenuRows(menu: CannedStyleMenuRow[]): CannedStyleOptionDef[][] {
  const groups: CannedStyleOptionDef[][] = [];
  let current: CannedStyleOptionDef[] = [];
  for (const row of menu) {
    if ('divider' in row) {
      if (current.length > 0) groups.push(current);
      current = [];
      continue;
    }
    current.push(row);
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

const CANNED_STYLE_MENU_GROUPS = groupCannedStyleMenuRows(CANNED_STYLE_MENU);

function clampStyleMenuPosition(buttonRect: DOMRect, menu: HTMLElement): { top: number; left: number } {
  const margin = 8;
  const gap = 4;
  const menuWidth = menu.offsetWidth;
  const menuHeight = menu.offsetHeight;
  let left = buttonRect.left;
  let top = buttonRect.bottom + gap;
  left = Math.min(Math.max(margin, left), window.innerWidth - menuWidth - margin);
  if (top + menuHeight > window.innerHeight - margin) {
    const above = buttonRect.top - menuHeight - gap;
    top = above >= margin ? above : Math.max(margin, window.innerHeight - menuHeight - margin);
  }
  return { top, left };
}

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
      insertText: (text: string, from: number, to?: number) => WysiwygView['state']['tr'];
      replaceRange: (from: number, to: number, slice: unknown) => WysiwygView['state']['tr'];
      replaceRangeWith: (from: number, to: number, node: unknown) => WysiwygView['state']['tr'];
      setNodeMarkup: (pos: number, type?: unknown, attrs?: Record<string, unknown>) => WysiwygView['state']['tr'];
      setSelection?: (selection: unknown) => WysiwygView['state']['tr'];
      setMeta?: (key: string, value: unknown) => WysiwygView['state']['tr'];
      addStoredMark?: (mark: unknown) => WysiwygView['state']['tr'];
      removeStoredMark?: (mark: unknown) => WysiwygView['state']['tr'];
      scrollIntoView: () => WysiwygView['state']['tr'];
    };
  };
  dispatch: (tr: WysiwygView['state']['tr']) => void;
  focus: () => void;
  updateState?: (state: EditorState) => void;
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
    level?: number;
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
  off?: (type: string, handler?: (value?: unknown) => void) => void;
  isWysiwygMode?: () => boolean;
  getSelectedText?: () => string;
  wwEditor?: { view?: WysiwygView };
  eventEmitter?: { emit?: (type: string, ...args: unknown[]) => void };
};

type LinkRange = {
  from: number;
  to: number;
  mark: LinkMark;
};

type LinkDraft = {
  text: string;
  url: string;
  linkType: MarkdownEditorLinkType;
  articleSlug: string | null;
  contactRecipient: string | null;
  systemPagePath: PublicSystemPagePath | null;
  openInNewWindow: boolean;
  from: number;
  to: number;
  empty: boolean;
  accordionSnapshot?: AccordionSelectionSnapshot | null;
};

type YoutubeDraft = {
  title: string;
  videoIdOrUrl: string;
};

type AccordionInsertDraft = {
  entryCount: number;
};

type AccordionEditDraft = {
  pos: number;
  entryCount: number;
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

function getActiveHeadingLevel(view: WysiwygView): number | null {
  const $from = view.state.selection.$from as unknown as ResolvedPos;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth) as unknown as WysiwygNode;
    if (node.type?.name === 'heading') {
      const level = node.attrs?.level;
      return typeof level === 'number' ? level : null;
    }
  }
  return null;
}

function resolveActiveHeadingLevel(view: WysiwygView | undefined): number | null {
  const accordionFormat = getAccordionActiveFormat();
  if (accordionFormat) return accordionFormat.headingLevel;
  if (!view) return null;
  return getActiveHeadingLevel(view);
}

function getActiveBlockStyle(view: WysiwygView): CannedStyle | null {
  const styledBlock = getBlockStyleRange(view);
  if (styledBlock) {
    const blockClass = getTccBlockClassFromWysiwygNode(styledBlock.node);
    if (blockClass) return blockClass as CannedStyle;
  }

  const $from = view.state.selection.$from as unknown as ResolvedPos;
  const depth = findEnclosingStyleableBlockDepth($from);
  if (depth == null) return null;
  const block = $from.node(depth) as unknown as WysiwygNode;
  const blockClass = getTccBlockClassFromParagraphClassNames(block.attrs?.classNames);
  return blockClass ? (blockClass as CannedStyle) : null;
}

function getActiveInlineStylesInScope(view: WysiwygView): CannedStyle[] {
  const { selection, doc } = view.state;
  const found = new Set<CannedStyle>();

  const collectFromMarks = (marks: ReadonlyArray<{ attrs?: { htmlAttrs?: { class?: string } } }> | undefined) => {
    for (const mark of marks ?? []) {
      const className = mark.attrs?.htmlAttrs?.class;
      if (className && CANNED_STYLE_OPTIONS.some((option) => option.value === className && option.kind === 'inline')) {
        found.add(className as CannedStyle);
      }
    }
  };

  if (!selection.empty) {
    doc.nodesBetween(selection.from, selection.to, (node) => {
      if (!node.isText) return;
      collectFromMarks(node.marks as ReadonlyArray<{ attrs?: { htmlAttrs?: { class?: string } } }>);
    });
  } else {
    const $from = selection.$from as unknown as ResolvedPos;
    collectFromMarks($from.marks());
  }

  return [...found];
}

function getActiveCannedStyles(view: WysiwygView): CannedStyle[] {
  const styles: CannedStyle[] = [];
  const blockStyle = getActiveBlockStyle(view);
  if (blockStyle) styles.push(blockStyle);
  for (const inlineStyle of getActiveInlineStylesInScope(view)) {
    if (!styles.includes(inlineStyle)) styles.push(inlineStyle);
  }
  return styles;
}

function cannedStylesEqual(left: CannedStyle[], right: CannedStyle[]): boolean {
  if (left.length !== right.length) return false;
  const a = [...left].sort();
  const b = [...right].sort();
  return a.every((value, index) => value === b[index]);
}

function getCannedStyleLabel(style: CannedStyle): string | null {
  if (style === 'default') return null;
  return CANNED_STYLE_OPTIONS.find((option) => option.value === style)?.label ?? null;
}

function updateHeadingPopupActiveState(popup: Element, level: number | null) {
  popup.querySelectorAll('li[data-level], li[data-type="Paragraph"]').forEach((item) => {
    item.classList.remove('tcc-editor-heading-menu-item--active');
    item.removeAttribute('aria-current');
  });
  const activeItem =
    level == null
      ? popup.querySelector('li[data-type="Paragraph"]')
      : popup.querySelector(`li[data-level="${level}"]`);
  if (!activeItem) return;
  activeItem.classList.add('tcc-editor-heading-menu-item--active');
  activeItem.setAttribute('aria-current', 'true');
}

function getSelectedStyleableBlocks(view: WysiwygView) {
  const { doc, selection } = view.state;
  const blocks: Array<{ from: number; node: WysiwygNode }> = [];
  doc.nodesBetween(selection.from, selection.to, (node, pos) => {
    const blockType = node.type?.name;
    if (node.isBlock && (blockType === 'paragraph' || blockType === 'heading')) {
      blocks.push({ from: pos, node });
      return false;
    }
    return undefined;
  });
  return blocks;
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

    const inlineNodes = buildInlineNodesFromHTML(
      schema,
      repairMarkdownLinksInHtmlContent(node.attrs.childrenHTML ?? '')
    );
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
    view.dispatch(tr.setMeta?.('addToHistory', false).scrollIntoView() ?? tr.scrollIntoView());
  }
}

/** Clear undo/redo stacks so Ctrl+Z cannot roll back past the current document (e.g. after load/normalization). */
function resetWysiwygUndoHistory(view: WysiwygView) {
  if (!view.updateState) return;
  const state = view.state as unknown as EditorState;
  view.updateState(
    EditorState.create({
      doc: state.doc,
      selection: state.selection,
      storedMarks: state.storedMarks,
      plugins: state.plugins,
    })
  );
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

type MarkdownHtmlRendererContext = {
  entering?: boolean;
  origin?: () => { text?: string; rawHTML?: string };
};

function markdownHtmlRenderer(
  nodeInfo?: { node?: HtmlMarkdownNode } | HtmlMarkdownNode,
  context?: boolean | MarkdownHtmlRendererContext
) {
  const node = (nodeInfo && 'node' in nodeInfo ? nodeInfo.node : nodeInfo) as HtmlMarkdownNode | undefined;
  if (node?.attrs?.htmlInline) {
    return markdownInlineHtmlRenderer(nodeInfo, context);
  }

  const rendererContext = typeof context === 'object' && context ? context : undefined;
  if (rendererContext?.origin) {
    return rendererContext.origin() ?? {};
  }
  return {};
}

function createToolbarIconButton(label: string, icon: ReactNode) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'tcc-editor-icon-button';
  // Tooltip is provided by Toast UI via insertToolbarItem; avoid duplicate native title tooltips.
  button.setAttribute('aria-label', label);
  createRoot(button).render(icon);
  return button;
}

function ToolbarStylesDropdown({
  onApplyStyle,
  activeStyles,
  dark = false,
}: {
  onApplyStyle: (style: CannedStyle) => void;
  activeStyles: CannedStyle[];
  dark?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const hasActiveStyle = activeStyles.length > 0;
  const activeLabels = activeStyles
    .map((style) => getCannedStyleLabel(style))
    .filter((label): label is string => label != null);

  const isStyleMenuItemActive = (style: CannedStyle) =>
    style === 'default' ? activeStyles.length === 0 : activeStyles.includes(style);

  const renderStyleMenuItem = (row: CannedStyleOptionDef) => (
    <button
      key={row.value}
      type="button"
      role="menuitem"
      className={isStyleMenuItemActive(row.value) ? 'tcc-editor-style-menu-item--active' : undefined}
      aria-current={isStyleMenuItemActive(row.value) ? 'true' : undefined}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => {
        onApplyStyle(row.value);
        setOpen(false);
      }}
    >
      <span>{row.label}</span>
      <span className="tcc-editor-style-menu-description">{row.description}</span>
    </button>
  );

  useLayoutEffect(() => {
    if (!open) {
      setMenuPosition(null);
      return;
    }

    const updatePosition = () => {
      const button = buttonRef.current;
      const menu = menuRef.current;
      if (!button || !menu) return;
      setMenuPosition(clampStyleMenuPosition(button.getBoundingClientRect(), menu));
    };

    updatePosition();
    const raf = requestAnimationFrame(updatePosition);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open, activeStyles.join('|')]);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Node ? event.target : null;
      if (target && wrapperRef.current?.contains(target)) return;
      if (target && menuRef.current?.contains(target)) return;
      setOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [open]);

  return (
    <div className="tcc-editor-styles-dropdown" ref={wrapperRef}>
      <button
        ref={buttonRef}
        type="button"
        className={`tcc-editor-style-button${hasActiveStyle ? ' tcc-editor-style-button--active' : ''}`}
        aria-label={
          activeLabels.length > 0 ? `Styles, current: ${activeLabels.join(', ')}` : 'Styles'
        }
        aria-haspopup="menu"
        aria-expanded={open}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setOpen((value) => !value)}
      >
        <HiOutlinePaintBrush aria-hidden="true" />
      </button>
      {open
        ? createPortal(
            <div
              ref={menuRef}
              className={`tcc-editor-style-menu${dark ? ' tcc-editor-style-menu--dark' : ''}`}
              role="menu"
              aria-label="Text styles"
              style={{
                position: 'fixed',
                top: menuPosition?.top ?? -9999,
                left: menuPosition?.left ?? -9999,
                visibility: menuPosition ? 'visible' : 'hidden',
              }}
            >
              {CANNED_STYLE_MENU_GROUPS.map((group, groupIndex) => {
                const isDefaultGroup = group.length === 1 && group[0]?.value === 'default';
                const isInlineGroup = group[0]?.kind === 'inline';
                const sectionLabel =
                  group[0]?.kind === 'block'
                    ? 'Block styles'
                    : group[0]?.kind === 'inline'
                      ? 'Inline styles'
                      : null;
                return (
                  <div key={group.map((row) => row.value).join('-')} className="tcc-editor-style-menu-group">
                    {isDefaultGroup ? (
                      renderStyleMenuItem(group[0])
                    ) : (
                      <div role="group" aria-label={sectionLabel ?? undefined}>
                        {sectionLabel ? (
                          <p className="tcc-editor-style-menu-section-title">{sectionLabel}</p>
                        ) : null}
                        <div
                          className={`tcc-editor-style-menu-grid${isInlineGroup ? ' tcc-editor-style-menu-grid--inline' : ''}`}
                        >
                          {group.map((row) => renderStyleMenuItem(row))}
                        </div>
                      </div>
                    )}
                    {groupIndex < CANNED_STYLE_MENU_GROUPS.length - 1 ? (
                      <hr className="tcc-editor-style-menu-divider" role="separator" />
                    ) : null}
                  </div>
                );
              })}
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

function findEnclosingStyleableBlockDepth($from: ResolvedPos): number | null {
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const name = $from.node(depth).type.name;
    if (name === 'paragraph' || name === 'heading') return depth;
  }
  return null;
}

function getCursorStyleableBlock(view: WysiwygView): { from: number; node: WysiwygNode } | null {
  const $from = view.state.selection.$from as unknown as ResolvedPos;
  const depth = findEnclosingStyleableBlockDepth($from);
  if (depth == null) return null;
  return {
    from: $from.before(depth),
    node: $from.node(depth) as unknown as WysiwygNode,
  };
}

function getStyleApplicationBlocks(view: WysiwygView): Array<{ from: number; node: WysiwygNode }> {
  const styledBlock = getBlockStyleRange(view);
  if (styledBlock) return [{ from: styledBlock.from, node: styledBlock.node }];

  const { selection } = view.state;
  if (!selection.empty) {
    const blocks = getSelectedStyleableBlocks(view);
    if (blocks.length) return blocks;
  }

  const cursorBlock = getCursorStyleableBlock(view);
  return cursorBlock ? [cursorBlock] : [];
}

function getInlineMarkClass(mark: LinkMark & { attrs?: { htmlAttrs?: { class?: string } } }): string | undefined {
  return mark.attrs?.htmlAttrs?.class;
}

function isCannedInlineMark(mark: LinkMark & { attrs?: { htmlAttrs?: { class?: string } } }): boolean {
  const className = getInlineMarkClass(mark);
  if (!className) return false;
  return CANNED_STYLE_OPTIONS.some((option) => option.value === className && option.kind === 'inline');
}

function rangeHasCannedInlineStyle(view: WysiwygView, from: number, to: number): boolean {
  const { doc } = view.state;
  let found = false;
  doc.nodesBetween(from, to, (node) => {
    if (!node.isText) return;
    for (const mark of node.marks ?? []) {
      if (isCannedInlineMark(mark as LinkMark & { attrs?: { htmlAttrs?: { class?: string } } })) {
        found = true;
        return false;
      }
    }
  });
  return found;
}

function hasCannedInlineStyleInScope(view: WysiwygView): boolean {
  const { selection } = view.state;
  if (!selection.empty) {
    return rangeHasCannedInlineStyle(view, selection.from, selection.to);
  }
  const $from = selection.$from as unknown as ResolvedPos;
  return $from.marks().some((mark) => isCannedInlineMark(mark as LinkMark & { attrs?: { htmlAttrs?: { class?: string } } }));
}

function getHeadingBlocksToRevert(view: WysiwygView): Array<{ from: number; node: WysiwygNode }> {
  const { selection } = view.state;
  if (!selection.empty) {
    return getSelectedStyleableBlocks(view).filter((block) => block.node.type?.name === 'heading');
  }
  const block = getCursorStyleableBlock(view);
  return block?.node.type?.name === 'heading' ? [block] : [];
}

function getContiguousCannedMarkRange(
  $from: ResolvedPos,
  targetMark: LinkMark & { attrs?: { htmlAttrs?: { class?: string } } }
): { from: number; to: number } | null {
  if (!isCannedInlineMark(targetMark)) return null;

  let from = $from.pos;
  let to = $from.pos;
  const doc = $from.doc;

  while (from > $from.start()) {
    const $before = doc.resolve(from - 1);
    const prevMark = $before.marks().find(
      (mark) =>
        mark.type === targetMark.type && getInlineMarkClass(mark as typeof targetMark) === getInlineMarkClass(targetMark)
    );
    if (!prevMark) break;
    from -= 1;
  }

  while (to < $from.end()) {
    const $after = doc.resolve(to);
    const nextMark = $after.marks().find(
      (mark) =>
        mark.type === targetMark.type && getInlineMarkClass(mark as typeof targetMark) === getInlineMarkClass(targetMark)
    );
    if (!nextMark) break;
    to += 1;
  }

  return { from, to };
}

function clearCannedInlineStyles(nextTr: WysiwygView['state']['tr'], view: WysiwygView): WysiwygView['state']['tr'] {
  const { schema, selection } = view.state;
  const $from = selection.$from as unknown as ResolvedPos;

  if (!selection.empty) {
    if (schema.marks.small) nextTr = nextTr.removeMark(selection.from, selection.to, schema.marks.small);
    if (schema.marks.span) nextTr = nextTr.removeMark(selection.from, selection.to, schema.marks.span);
    return nextTr;
  }

  if (schema.marks.small) nextTr = nextTr.removeStoredMark?.(schema.marks.small) ?? nextTr;
  if (schema.marks.span) nextTr = nextTr.removeStoredMark?.(schema.marks.span) ?? nextTr;

  for (const mark of $from.marks()) {
    const typedMark = mark as LinkMark & { attrs?: { htmlAttrs?: { class?: string } } };
    if (!isCannedInlineMark(typedMark)) continue;
    const range = getContiguousCannedMarkRange($from, typedMark);
    if (range) {
      nextTr = nextTr.removeMark(range.from, range.to, mark.type);
    }
  }

  return nextTr;
}

/** Split so both sides keep block style and/or text-indent attrs. */
const tccPreservingBlockSplit = createTccPreservingBlockSplit((classNames) =>
  Boolean(getTccBlockClassFromParagraphClassNames(classNames))
);

function tccIndentEditorPlugin(context: { pmKeymap: { keymap: (bindings: Record<string, Command>) => Plugin } }) {
  return createTccIndentPlugin(context, {
    preservingBlockSplit: tccPreservingBlockSplit,
    hasBlockStyle: (classNames) => Boolean(getTccBlockClassFromParagraphClassNames(classNames)),
  });
}

function tccPlainTextPastePlugin() {
  return createTccPlainTextPastePlugin();
}

function tccAccordionEditorPlugin() {
  return createTccAccordionEditorPlugin();
}

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

    return tccPreservingBlockSplit(state, dispatch);
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
    const linkTypeId = useId();
    const linkUrlId = useId();
    const articlePickerId = useId();
    const contactRecipientId = useId();
    const systemPageId = useId();
    const youtubeTitleId = useId();
    const youtubeUrlId = useId();
    const accordionInsertCountId = useId();
    const accordionEditCountId = useId();
    const editorRef = useRef<Editor>(null);
    const wrapperRef = useRef<HTMLDivElement>(null);
    const linkTextInputRef = useRef<HTMLInputElement>(null);
    const linkUrlInputRef = useRef<HTMLInputElement>(null);
    const youtubeVideoInputRef = useRef<HTMLInputElement>(null);
    const accordionInsertCountInputRef = useRef<HTMLInputElement>(null);
    const accordionEditCountInputRef = useRef<HTMLInputElement>(null);
    const imageFileInputRef = useRef<HTMLInputElement>(null);
    const youtubeDialogRef = useRef<HTMLDivElement>(null);
    const accordionInsertDialogRef = useRef<HTMLDivElement>(null);
    const accordionEditDialogRef = useRef<HTMLDivElement>(null);
    const youtubeDialogWasOpenRef = useRef(false);
    const linkDialogWasOpenRef = useRef(false);
    const accordionInsertDialogWasOpenRef = useRef(false);
    const accordionEditDialogWasOpenRef = useRef(false);
    const unlinkButtonRef = useRef<HTMLButtonElement | null>(null);
    const indentButtonRef = useRef<HTMLButtonElement | null>(null);
    const outdentButtonRef = useRef<HTMLButtonElement | null>(null);
    const headingBtnRef = useRef<HTMLButtonElement | null>(null);
    const stylesToolbarContainerRef = useRef<HTMLDivElement | null>(null);
    const lastToolbarActiveStylesRef = useRef<CannedStyle[]>([]);
    const toolbarCleanupRef = useRef<Array<() => void>>([]);
    const [stylesToolbarReady, setStylesToolbarReady] = useState(false);
    const [toolbarActiveStyles, setToolbarActiveStyles] = useState<CannedStyle[]>([]);
    const [fillHeight, setFillHeight] = useState<number>(300);
    const [linkDraft, setLinkDraft] = useState<LinkDraft | null>(null);
    const [youtubeDraft, setYoutubeDraft] = useState<YoutubeDraft | null>(null);
    const [accordionInsertDraft, setAccordionInsertDraft] = useState<AccordionInsertDraft | null>(null);
    const [accordionEditDraft, setAccordionEditDraft] = useState<AccordionEditDraft | null>(null);
    const [selectedArticle, setSelectedArticle] = useState<ArticleOption | null>(null);
    const { recipients: contactRecipients, loading: contactRecipientsLoading } = usePublicContactRecipients();
    const contactRecipientOptions = useMemo(
      () => toContactRecipientChoiceOptions(contactRecipients),
      [contactRecipients],
    );
    const { showAlert } = useAlert();
    const { confirm } = useConfirm();
    const [managedImageModal, setManagedImageModal] = useState<{ open: boolean; file: ManagedFile | null }>({
      open: false,
      file: null,
    });
    const [hoverManagedImageEdit, setHoverManagedImageEdit] = useState<{
      fileId: number;
      top: number;
      right: number;
    } | null>(null);
    const [hoverAccordionEdit, setHoverAccordionEdit] = useState<{
      pos: number;
      entryCount: number;
      top: number;
      right: number;
    } | null>(null);
    const hoverManagedImageChipRef = useRef<HTMLDivElement | null>(null);
    const hoverAccordionChipRef = useRef<HTMLDivElement | null>(null);
    const accordionHeadingSnapshotRef = useRef<AccordionSelectionSnapshot | null>(null);
    const accordionLinkSnapshotRef = useRef<AccordionSelectionSnapshot | null>(null);

    useImperativeHandle(ref, () => ({
      getMarkdown: () => {
        const instance = editorRef.current?.getInstance?.() as EditorInstance | undefined;
        if (!instance?.getMarkdown) return undefined;
        const view = instance.wwEditor?.view as unknown as EditorView | undefined;
        let md = instance.getMarkdown() ?? '';
        if (view) {
          md = injectLiveAccordionHtmlIntoMarkdown(view, md);
        }
        md = repairMarkdownLinksInRawHtmlBlocks(md);
        return stripAccordionOpenStateFromMarkdown(markdownStorageFromWysiwygYoutubeThumbnails(md)).trim();
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
    const onUploadImageRef = useRef(onUploadImage);
    onUploadImageRef.current = onUploadImage;

    const updateUnlinkButtonState = () => {
      const button = unlinkButtonRef.current;
      if (!button) return;
      const instance = getEditorInstance();
      const view = instance?.wwEditor?.view;
      const canUnlink = Boolean(
        instance?.isWysiwygMode?.() &&
          view?.state?.schema?.marks?.link &&
          (getTouchedLinkRanges(view).length || hasAccordionTouchedLink())
      );
      button.disabled = !canUnlink;
      button.setAttribute('aria-disabled', String(!canUnlink));
    };

    const updateIndentButtonState = () => {
      const outdentButton = outdentButtonRef.current;
      if (!outdentButton) return;
      const instance = getEditorInstance();
      const view = instance?.wwEditor?.view;
      const canOutdent = Boolean(
        instance?.isWysiwygMode?.() && view && canTccOutdent(view.state as unknown as EditorState)
      );
      outdentButton.disabled = !canOutdent;
      outdentButton.setAttribute('aria-disabled', String(!canOutdent));
    };

    const syncToolbarActiveStyles = (activeStyles: CannedStyle[]) => {
      if (cannedStylesEqual(lastToolbarActiveStylesRef.current, activeStyles)) return;
      lastToolbarActiveStylesRef.current = activeStyles;
      setToolbarActiveStyles(activeStyles);
    };

    const setHeadingToolbarState = (headingLevel: number | null) => {
      const headingBtn = headingBtnRef.current;
      if (headingBtn) {
        headingBtn.setAttribute(
          'aria-label',
          headingLevel != null ? `Heading, current: Heading ${headingLevel}` : 'Heading, current: Paragraph'
        );
        headingBtn.classList.toggle('active', headingLevel != null);
      }
      const headingPopup = wrapperRef.current?.querySelector('.toastui-editor-popup-add-heading');
      if (headingPopup) updateHeadingPopupActiveState(headingPopup, headingLevel);
    };

    const updateToolbarFormatState = () => {
      updateUnlinkButtonState();
      updateIndentButtonState();
      const instance = getEditorInstance();
      const view = instance?.wwEditor?.view;
      if (!instance?.isWysiwygMode?.() || !view) return;

      const accordionFormat = getAccordionActiveFormat();
      if (accordionFormat) {
        setHeadingToolbarState(accordionFormat.headingLevel);
        syncToolbarActiveStyles(accordionFormat.styles as CannedStyle[]);
        return;
      }

      setHeadingToolbarState(resolveActiveHeadingLevel(view));
      syncToolbarActiveStyles(getActiveCannedStyles(view));
    };

    const openLinkDialog = () => {
      const instance = getEditorInstance();
      if (!instance?.isWysiwygMode?.()) return;
      const view = instance.wwEditor?.view;
      if (!view?.state?.schema?.marks?.link) return;

      const snapshot = accordionLinkSnapshotRef.current;
      accordionLinkSnapshotRef.current = null;
      if (!getAccordionSelectionContext() && snapshot) {
        restoreAccordionSelectionSnapshot(snapshot);
      }

      const accordionLink = readAccordionLinkDraftFromSelection();

      setSelectedArticle(null);
      setYoutubeDraft(null);
      setAccordionInsertDraft(null);
      setAccordionEditDraft(null);

      if (accordionLink) {
        const inferred = inferMarkdownEditorLinkTarget(accordionLink.existingUrl);
        const url = buildMarkdownEditorLinkUrl({
          linkType: inferred.linkType,
          articleSlug: inferred.articleSlug,
          contactRecipient: inferred.contactRecipient,
          systemPagePath: inferred.systemPagePath,
          customUrl: inferred.customUrl,
        });

        setLinkDraft({
          text: accordionLink.text,
          url: inferred.linkType === 'custom-url' ? inferred.customUrl : url,
          linkType: inferred.linkType,
          articleSlug: inferred.articleSlug,
          contactRecipient: inferred.contactRecipient,
          systemPagePath: inferred.systemPagePath,
          openInNewWindow: accordionLink.openInNewWindow,
          from: 0,
          to: 0,
          empty: accordionLink.empty,
          accordionSnapshot: accordionLink.snapshot,
        });
        return;
      }

      const { doc, selection } = view.state;
      const touchedLink = getTouchedLinkRanges(view)[0];
      const from = touchedLink?.from ?? selection.from;
      const to = touchedLink?.to ?? selection.to;
      const selectedText = doc.textBetween(from, to, '\n', '\n');
      const trimmed = selection.empty || touchedLink ? { from, to, text: selectedText } : trimSelectionEdges(selectedText, from, to);
      const cursorLinkMark = getLinkMark(selection.$from.marks(), view.state.schema.marks.link);
      const activeLink = touchedLink?.mark ?? cursorLinkMark;

      const existingUrl = activeLink?.attrs?.linkUrl ?? '';
      const inferred = inferMarkdownEditorLinkTarget(existingUrl);
      const url = buildMarkdownEditorLinkUrl({
        linkType: inferred.linkType,
        articleSlug: inferred.articleSlug,
        contactRecipient: inferred.contactRecipient,
        systemPagePath: inferred.systemPagePath,
        customUrl: inferred.customUrl,
      });

      setLinkDraft({
        text: trimmed.text,
        url: inferred.linkType === 'custom-url' ? inferred.customUrl : url,
        linkType: inferred.linkType,
        articleSlug: inferred.articleSlug,
        contactRecipient: inferred.contactRecipient,
        systemPagePath: inferred.systemPagePath,
        openInNewWindow: activeLink?.attrs?.title === OPEN_IN_NEW_WINDOW_TITLE,
        from: trimmed.from,
        to: trimmed.to,
        empty: Boolean(selection.empty && !touchedLink),
      });
    };

    const applyLinkDraft = () => {
      if (!linkDraft) return;
      const text = linkDraft.text.trim();
      const url = buildMarkdownEditorLinkUrl({
        linkType: linkDraft.linkType,
        articleSlug: linkDraft.articleSlug,
        contactRecipient: linkDraft.contactRecipient,
        systemPagePath: linkDraft.systemPagePath,
        customUrl: linkDraft.url,
      }).trim();
      if (!isMarkdownEditorLinkDraftReady({ ...linkDraft, text, url })) return;

      const instance = getEditorInstance();
      const view = instance?.wwEditor?.view as unknown as EditorView | undefined;
      if (!view?.state?.schema?.marks?.link) return;

      if (linkDraft.accordionSnapshot) {
        restoreAccordionSelectionSnapshot(linkDraft.accordionSnapshot);
        if (!applyAccordionLinkToSelection({ url, text, openInNewWindow: linkDraft.openInNewWindow, empty: linkDraft.empty })) {
          showAlert('Could not apply link inside accordion.', 'error');
          return;
        }
        syncTccAccordionHtmlFromDom(view, { force: true });
        linkDraft.accordionSnapshot.editable.focus();
        setLinkDraft(null);
        setSelectedArticle(null);
        updateUnlinkButtonState();
        return;
      }

      const { schema } = view.state;
      const mark = schema.mark('link', {
        linkUrl: url,
        title: linkDraft.openInNewWindow ? OPEN_IN_NEW_WINDOW_TITLE : null,
      });
      let tr = view.state.tr.removeMark(linkDraft.from, linkDraft.to, schema.marks.link);
      const currentText = linkDraft.empty ? '' : view.state.doc.textBetween(linkDraft.from, linkDraft.to, '\n', '\n');
      const textChanged = linkDraft.empty || text !== currentText.trim();

      if (textChanged) {
        tr = tr.insertText(text, linkDraft.from, linkDraft.to);
        tr = tr.addMark(linkDraft.from, linkDraft.from + text.length, mark);
      } else {
        tr = tr.addMark(linkDraft.from, linkDraft.to, mark);
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
      setAccordionInsertDraft(null);
      setAccordionEditDraft(null);
      setYoutubeDraft({ title: '', videoIdOrUrl: '' });
    };

    const openAccordionInsertDialog = () => {
      const instance = getEditorInstance();
      if (!instance?.isWysiwygMode?.()) return;
      setLinkDraft(null);
      setYoutubeDraft(null);
      setAccordionEditDraft(null);
      setAccordionInsertDraft({ entryCount: 3 });
    };

    const openAccordionEditDialog = (pos: number, entryCount: number) => {
      const instance = getEditorInstance();
      if (!instance?.isWysiwygMode?.()) return;
      setLinkDraft(null);
      setYoutubeDraft(null);
      setAccordionInsertDraft(null);
      setHoverAccordionEdit(null);
      setAccordionEditDraft({ pos, entryCount });
    };

    const removeAccordion = async (pos: number) => {
      const instance = getEditorInstance();
      if (!instance?.isWysiwygMode?.()) return;
      const view = instance.wwEditor?.view as unknown as EditorView | undefined;
      if (!view) return;

      const confirmed = await confirm({
        title: 'Delete accordion',
        message: 'Remove this accordion and all of its sections from the article?',
        confirmText: 'Delete',
        variant: 'danger',
      });
      if (!confirmed) return;

      if (!deleteTccAccordion(view, pos)) {
        showAlert('Could not delete accordion.', 'error');
        return;
      }

      setHoverAccordionEdit(null);
      instance.focus?.();
      updateToolbarFormatState();
    };

    const applyAccordionInsertDraft = () => {
      if (!accordionInsertDraft) return;
      const entryCount = clampAccordionEntryCount(accordionInsertDraft.entryCount);
      const instance = getEditorInstance();
      const view = instance?.wwEditor?.view as unknown as EditorView | undefined;
      if (!view) return;
      if (!insertTccAccordion(view, entryCount)) {
        showAlert('Could not insert accordion.', 'error');
        return;
      }
      setAccordionInsertDraft(null);
      instance?.focus?.();
    };

    const applyAccordionEditDraft = () => {
      if (!accordionEditDraft) return;
      const entryCount = clampAccordionEntryCount(accordionEditDraft.entryCount);
      const instance = getEditorInstance();
      const view = instance?.wwEditor?.view as unknown as EditorView | undefined;
      if (!view) return;
      syncTccAccordionHtmlFromDom(view);
      if (!setTccAccordionEntryCount(view, accordionEditDraft.pos, entryCount)) {
        showAlert('Could not update accordion sections.', 'error');
        return;
      }
      setAccordionEditDraft(null);
      instance?.focus?.();
    };

    const openImageFilePicker = () => {
      const instance = getEditorInstance();
      if (!instance?.isWysiwygMode?.()) return;
      if (!onUploadImageRef.current) return;
      setLinkDraft(null);
      setYoutubeDraft(null);
      setAccordionInsertDraft(null);
      setAccordionEditDraft(null);
      imageFileInputRef.current?.click();
    };

    const handleImageFileSelected = async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      const upload = onUploadImageRef.current;
      if (!file || !upload) return;

      const mimeType = file.type || 'image/png';
      if (!mimeType.startsWith('image/')) {
        showAlert('Only image files are supported', 'error');
        return;
      }

      try {
        const uploaded = await upload(file);
        if (uploaded?.url) {
          const instance = getEditorInstance();
          instance?.exec?.('addImage', { imageUrl: uploaded.url, altText: uploaded.altText ?? '' });
          instance?.focus?.();
        }
      } catch {
        // Upload errors are handled by caller.
      }
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

      if (hasAccordionTouchedLink()) {
        if (!removeAccordionLinkInSelection()) return;
        syncTccAccordionHtmlFromDom(view as unknown as EditorView, { force: true });
        updateUnlinkButtonState();
        return;
      }

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

    const applyCannedStyleToAccordion = (style: CannedStyle): boolean => {
      const accordionCtx = getAccordionSelectionContext();
      if (!accordionCtx) return false;

      if (accordionCtx.inSummary) {
        showAlert('Headings and styles can’t be applied to an accordion title.', 'warning');
        return true;
      }

      if (style === 'default') {
        clearAccordionStylesInSelection();
      } else {
        const option = CANNED_STYLE_OPTIONS.find((item) => item.value === style);
        if (option?.kind === 'block') {
          applyAccordionBlockStyleToSelection(style);
        } else if (option?.kind === 'inline' && option.tag) {
          applyAccordionInlineStyleToSelection(option.tag, style);
        }
      }

      updateToolbarFormatState();
      return true;
    };

    const applyCannedStyle = (style: CannedStyle) => {
      const instance = getEditorInstance();
      if (!instance?.isWysiwygMode?.()) return;
      const view = instance.wwEditor?.view;
      if (!view) return;

      if (applyCannedStyleToAccordion(style)) return;

      const { schema, selection, tr } = view.state;
      const $from = selection.$from as unknown as ResolvedPos;
      let nextTr = tr;

      if (!selection.empty && style !== 'default') {
        if (schema.marks.small) nextTr = nextTr.removeMark(selection.from, selection.to, schema.marks.small);
        if (schema.marks.span) nextTr = nextTr.removeMark(selection.from, selection.to, schema.marks.span);
      }

      const styledBlock = getBlockStyleRange(view);
      if (style === 'default') {
        const hasInline = hasCannedInlineStyleInScope(view);
        const blockToClear = styledBlock ?? (selection.empty ? getCursorStyleableBlock(view) : null);
        if (blockToClear && getTccBlockClassFromWysiwygNode(blockToClear.node)) {
          nextTr = nextTr.setNodeMarkup(blockToClear.from, undefined, {
            ...(blockToClear.node.attrs ?? {}),
            classNames: null,
          });
        }
        nextTr = clearCannedInlineStyles(nextTr, view);
        if (!hasInline) {
          const paragraphType = schema.nodes.paragraph;
          for (const block of getHeadingBlocksToRevert(view)) {
            if (paragraphType) {
              nextTr = nextTr.setNodeMarkup(block.from, paragraphType, {});
            }
          }
        }
        view.dispatch(nextTr.scrollIntoView());
        view.focus();
        updateToolbarFormatState();
        return;
      }

      const option = CANNED_STYLE_OPTIONS.find((item) => item.value === style);
      if (!option) return;

      if (option.kind === 'block') {
        const blocks = getStyleApplicationBlocks(view);
        if (!blocks.length) return;
        const paragraphType = schema.nodes.paragraph;
        for (const block of blocks) {
          const isHeading = block.node.type?.name === 'heading';
          if (isHeading && paragraphType) {
            nextTr = nextTr.setNodeMarkup(block.from, paragraphType, {
              classNames: [style],
            });
          } else {
            nextTr = nextTr.setNodeMarkup(block.from, undefined, {
              ...(block.node.attrs ?? {}),
              classNames: [style],
            });
          }
        }
        view.dispatch(nextTr.scrollIntoView());
        view.focus();
        updateToolbarFormatState();
        return;
      }

      const markType = option.tag ? schema.marks[option.tag] : null;
      if (!markType) return;

      const mark = markType.create({
        htmlAttrs: {
          class: style,
        },
      });

      if (selection.empty) {
        const activeInlineMark = $from
          .marks()
          .find((existing) => existing.type === markType && getInlineMarkClass(existing) === style);
        if (activeInlineMark) {
          nextTr = nextTr.removeStoredMark?.(markType) ?? nextTr;
        } else {
          if (schema.marks.small) nextTr = nextTr.removeStoredMark?.(schema.marks.small) ?? nextTr;
          if (schema.marks.span) nextTr = nextTr.removeStoredMark?.(schema.marks.span) ?? nextTr;
          nextTr = nextTr.addStoredMark?.(mark) ?? nextTr;
        }
      } else {
        nextTr = nextTr.addMark(selection.from, selection.to, mark);
      }

      view.dispatch(nextTr.scrollIntoView());
      view.focus();
      updateToolbarFormatState();
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

        if (pmRoot) {
          const view = instance?.wwEditor?.view as unknown as EditorView | undefined;

          const onAccordionMouseMove = (event: MouseEvent) => {
            const accordionEl = resolveTccAccordionElement(event.target);
            if (accordionEl && view) {
              const pos = findTccAccordionNodePos(view, accordionEl);
              if (pos != null) {
                const node = view.state.doc.nodeAt(pos);
                const entryCount = countAccordionEntries(node?.attrs?.childrenHTML ?? accordionEl.innerHTML);
                const r = accordionEl.getBoundingClientRect();
                setHoverAccordionEdit((prev) => {
                  if (
                    prev &&
                    prev.pos === pos &&
                    Math.abs(prev.top - r.top) < 0.5 &&
                    Math.abs(prev.right - r.right) < 0.5
                  ) {
                    return prev;
                  }
                  return { pos, entryCount, top: r.top, right: r.right };
                });
                return;
              }
            }
            setHoverAccordionEdit(null);
          };

          const onAccordionMouseLeave = (event: MouseEvent) => {
            const related = event.relatedTarget;
            if (related instanceof Node && hoverAccordionChipRef.current?.contains(related)) {
              return;
            }
            setHoverAccordionEdit(null);
          };

          pmRoot.addEventListener('mousemove', onAccordionMouseMove);
          pmRoot.addEventListener('mouseleave', onAccordionMouseLeave);
          toolbarCleanupRef.current.push(() => {
            pmRoot.removeEventListener('mousemove', onAccordionMouseMove);
            pmRoot.removeEventListener('mouseleave', onAccordionMouseLeave);
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
              const indent = getTccIndent(nodeInfo.node);
              const indentAttr = indent > 0 ? ` ${TCC_INDENT_ATTR}="${indent}"` : '';
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
                state.write(`<p${indentAttr}>`);
                writeWysiwygInlineAsHtml(state, nodeInfo.node);
                state.write('</p>');
                if (isLastInRun) {
                  state.write('</div>');
                  state.closeBlock(nodeInfo.node);
                } else {
                  state.write('\n');
                }
                return;
              }
              if (writeIndentedBlockMarkdown(state, nodeInfo, 'p')) return;
              return originalParagraph(state, nodeInfo);
            };
          }
          const originalHeading = nodeTypeConvertors?.heading;
          if (nodeTypeConvertors && originalHeading) {
            nodeTypeConvertors.heading = function patchedHeading(state, nodeInfo) {
              const level = nodeInfo.node.attrs?.level ?? 1;
              if (writeIndentedBlockMarkdown(state, nodeInfo, `h${level}` as `h${number}`)) return;
              return originalHeading(state, nodeInfo);
            };
          }
        } catch {
          /* ignore convertor patch failures */
        }
        const normalizeCurrentWysiwyg = () => {
          const view = instance.wwEditor?.view;
          if (view) {
            normalizeStyledHtmlBlocks(view);
            normalizeIndentedHtmlBlocks(
              view as unknown as Parameters<typeof normalizeIndentedHtmlBlocks>[0],
              buildInlineNodesFromHTML
            );
          }
        };
        normalizeCurrentWysiwyg();
        instance.on?.('beforeConvertWysiwygToMarkdown', (markdownText: unknown) => {
          const view = instance.wwEditor?.view as unknown as EditorView | undefined;
          if (!view || typeof markdownText !== 'string') return markdownText;
          syncTccAccordionHtmlFromDom(view, { force: true });
          const withAccordions = injectLiveAccordionHtmlIntoMarkdown(view, markdownText);
          return repairMarkdownLinksInRawHtmlBlocks(withAccordions);
        });
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
        stylesToolbarContainerRef.current = stylesContainer;
        lastToolbarActiveStylesRef.current = [];
        setToolbarActiveStyles([]);
        try {
          instance.insertToolbarItem({ groupIndex: 0, itemIndex: 1 }, {
            name: 'tccStyles',
            tooltip: 'Styles',
            el: stylesContainer,
          });
          setStylesToolbarReady(true);
        } catch {
          /* ignore */
        }

        const closeHeadingPopup = () => {
          // Toast keeps its own popup open/close state, so close via its event bus to stay in sync.
          getEditorInstance()?.eventEmitter?.emit?.('closePopup');
          const popup = wrapperRef.current?.querySelector(
            '.toastui-editor-popup-add-heading'
          ) as HTMLElement | null;
          if (popup) popup.style.display = 'none';
        };

        const headingBtn = wrapperRef.current?.querySelector(
          '.toastui-editor-toolbar-icons.heading'
        ) as HTMLButtonElement | null;
        if (headingBtn && headingBtn.dataset.tccHeadingBound !== 'true') {
          headingBtn.dataset.tccHeadingBound = 'true';
          headingBtnRef.current = headingBtn;
          const onHeadingToolbarClick = () => {
            requestAnimationFrame(() => {
              const view = getEditorInstance()?.wwEditor?.view;
              const headingPopup = wrapperRef.current?.querySelector('.toastui-editor-popup-add-heading');
              if (headingPopup) {
                updateHeadingPopupActiveState(headingPopup, resolveActiveHeadingLevel(view));
              }
            });
          };
          // Preserve the accordion's native selection when opening the heading popup (the
          // toolbar button would otherwise blur the contenteditable panel).
          const onHeadingBtnMouseDown = (event: MouseEvent) => {
            const snapshot = captureAccordionSelectionSnapshot();
            accordionHeadingSnapshotRef.current = snapshot;
            if (snapshot) event.preventDefault();
          };
          // When the caret is inside an accordion panel, headings must be applied to the panel
          // DOM (the accordion is an opaque html-block in ProseMirror), so intercept the popup.
          const onHeadingPopupPointer = (event: MouseEvent) => {
            const target = event.target;
            if (!(target instanceof Element)) return;
            const item = target.closest(
              '.toastui-editor-popup-add-heading li[data-level], .toastui-editor-popup-add-heading li[data-type]'
            );
            if (!item) return;

            const snapshot = accordionHeadingSnapshotRef.current;
            const inAccordion = Boolean(snapshot) || Boolean(getAccordionSelectionContext());
            if (!inAccordion) return;

            event.preventDefault();
            event.stopImmediatePropagation();
            if (event.type !== 'click') return;

            if (!getAccordionSelectionContext()) restoreAccordionSelectionSnapshot(snapshot);
            accordionHeadingSnapshotRef.current = null;
            closeHeadingPopup();

            const ctx = getAccordionSelectionContext();
            if (!ctx) return;
            if (ctx.inSummary) {
              showAlert('Headings can’t be applied to an accordion title.', 'warning');
              return;
            }
            const levelAttr = item.getAttribute('data-level');
            applyAccordionHeadingToSelection(levelAttr ? Number(levelAttr) : 0);
            updateToolbarFormatState();
          };

          headingBtn.addEventListener('mousedown', onHeadingBtnMouseDown, true);
          headingBtn.addEventListener('click', onHeadingToolbarClick);
          wrapperRef.current?.addEventListener('mousedown', onHeadingPopupPointer, true);
          wrapperRef.current?.addEventListener('click', onHeadingPopupPointer, true);
          toolbarCleanupRef.current.push(() => {
            headingBtn.removeEventListener('mousedown', onHeadingBtnMouseDown, true);
            headingBtn.removeEventListener('click', onHeadingToolbarClick);
            wrapperRef.current?.removeEventListener('mousedown', onHeadingPopupPointer, true);
            wrapperRef.current?.removeEventListener('click', onHeadingPopupPointer, true);
          });
        } else if (headingBtn) {
          headingBtnRef.current = headingBtn;
        }

        const runTccIndentCommand = (command: 'tccIncreaseIndent' | 'tccDecreaseIndent') => {
          instance.exec?.(command);
          instance.focus?.();
          updateToolbarFormatState();
        };

        const outdentBtn = createToolbarIconButton('Decrease indent', <LuIndentDecrease aria-hidden="true" />);
        outdentBtn.disabled = true;
        outdentBtn.setAttribute('aria-disabled', 'true');
        outdentButtonRef.current = outdentBtn;
        outdentBtn.addEventListener('click', () => runTccIndentCommand('tccDecreaseIndent'));
        try {
          instance.insertToolbarItem({ groupIndex: 2, itemIndex: 2 }, {
            name: 'tccOutdent',
            tooltip: 'Decrease indent',
            el: outdentBtn,
          });
        } catch {
          /* ignore */
        }

        const indentBtn = createToolbarIconButton('Increase indent', <LuIndentIncrease aria-hidden="true" />);
        indentButtonRef.current = indentBtn;
        indentBtn.addEventListener('click', () => runTccIndentCommand('tccIncreaseIndent'));
        try {
          instance.insertToolbarItem({ groupIndex: 2, itemIndex: 3 }, {
            name: 'tccIndent',
            tooltip: 'Increase indent',
            el: indentBtn,
          });
        } catch {
          /* ignore */
        }

        const linkBtn = createToolbarIconButton('Create or edit link (Ctrl+K)', <HiOutlineLink aria-hidden="true" />);
        const onLinkBtnMouseDown = (event: MouseEvent) => {
          const snapshot = captureAccordionSelectionSnapshot();
          accordionLinkSnapshotRef.current = snapshot;
          if (snapshot) event.preventDefault();
        };
        linkBtn.addEventListener('mousedown', onLinkBtnMouseDown, true);
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
        toolbarCleanupRef.current.push(() => {
          linkBtn.removeEventListener('mousedown', onLinkBtnMouseDown, true);
          linkBtn.removeEventListener('click', openLinkDialog);
        });

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

        const youtubeToolbarIndex = onUploadImage ? 3 : 2;

        if (onUploadImage) {
          const imageBtn = createToolbarIconButton('Insert image', <HiOutlinePhoto aria-hidden="true" />);
          const onImageToolbarClick = () => openImageFilePicker();
          imageBtn.addEventListener('click', onImageToolbarClick);
          try {
            instance.insertToolbarItem({ groupIndex: 3, itemIndex: 2 }, {
              name: 'tccImage',
              tooltip: 'Insert image',
              el: imageBtn,
            });
          } catch {
            /* ignore */
          }
          toolbarCleanupRef.current.push(() => imageBtn.removeEventListener('click', onImageToolbarClick));
        }

        const youtubeBtn = createToolbarIconButton('Insert YouTube video', <HiOutlinePlayCircle aria-hidden="true" />);
        youtubeBtn.addEventListener('click', openYoutubeEmbedDialog);
        try {
          instance.insertToolbarItem({ groupIndex: 3, itemIndex: youtubeToolbarIndex }, {
            name: 'tccYoutube',
            tooltip: 'Insert YouTube video',
            el: youtubeBtn,
          });
        } catch {
          /* ignore */
        }

        const accordionBtn = createToolbarIconButton('Insert accordion', <TfiLayoutAccordionMerged aria-hidden="true" />);
        accordionBtn.addEventListener('click', openAccordionInsertDialog);
        try {
          instance.insertToolbarItem({ groupIndex: 3, itemIndex: youtubeToolbarIndex + 1 }, {
            name: 'tccAccordion',
            tooltip: 'Insert accordion',
            el: accordionBtn,
          });
        } catch {
          /* ignore */
        }

        const viewDom = instance.wwEditor?.view as unknown as { dom?: HTMLElement };
        const queueToolbarStateUpdate = () => requestAnimationFrame(updateToolbarFormatState);
        const queueToolbarStateAfterAccordionInteraction = () => {
          requestAnimationFrame(() => {
            requestAnimationFrame(updateToolbarFormatState);
          });
        };
        instance.on?.('changeToolbarState', queueToolbarStateUpdate);
        toolbarCleanupRef.current.push(() => {
          instance.off?.('changeToolbarState', queueToolbarStateUpdate);
        });
        const onAccordionEditableMouseDown = (event: MouseEvent) => {
          const target = event.target;
          if (target instanceof Element && target.closest(`.${TCC_ACCORDION_EDITABLE_CLASS}`)) {
            queueToolbarStateAfterAccordionInteraction();
          }
        };
        viewDom.dom?.addEventListener('mousedown', onAccordionEditableMouseDown, true);
        viewDom.dom?.addEventListener('keyup', queueToolbarStateUpdate);
        viewDom.dom?.addEventListener('mouseup', queueToolbarStateUpdate);
        viewDom.dom?.addEventListener('focusin', queueToolbarStateUpdate);
        document.addEventListener('selectionchange', queueToolbarStateUpdate);
        toolbarCleanupRef.current.push(() => {
          viewDom.dom?.removeEventListener('mousedown', onAccordionEditableMouseDown, true);
          viewDom.dom?.removeEventListener('keyup', queueToolbarStateUpdate);
          viewDom.dom?.removeEventListener('mouseup', queueToolbarStateUpdate);
          viewDom.dom?.removeEventListener('focusin', queueToolbarStateUpdate);
          document.removeEventListener('selectionchange', queueToolbarStateUpdate);
        });
        updateToolbarFormatState();
        const onListBackspaceKeydown = (event: KeyboardEvent) => {
          if (event.key !== 'Backspace' || event.isComposing) return;
          const view = instance?.wwEditor?.view;
          if (!view) return;
          if (
            runTccListBackspace(
              view.state as unknown as EditorState,
              view.dispatch as EditorView['dispatch'],
              view as unknown as EditorView
            )
          ) {
            event.preventDefault();
            // Prevent Toast UI / ProseMirror baseKeymap joinBackward from re-wrapping the
            // blank line into a new list item.
            event.stopPropagation();
          }
        };
        viewDom.dom?.addEventListener('keydown', onListBackspaceKeydown, true);
        toolbarCleanupRef.current.push(() => {
          viewDom.dom?.removeEventListener('keydown', onListBackspaceKeydown, true);
        });
        viewDom.dom?.addEventListener('keydown', (event: KeyboardEvent) => {
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
            event.preventDefault();
            openLinkDialog();
          }
        });

        const view = instance?.wwEditor?.view;
        if (view) {
          resetWysiwygUndoHistory(view);
          ensureTrailingParagraphAfterAccordion(view as unknown as EditorView);
        }

        if (instance?.getMarkdown) {
          onWysiwygReady?.();
        }
      }, 0);
    };

    useEffect(() => {
      return () => {
        for (const cleanup of toolbarCleanupRef.current) cleanup();
        toolbarCleanupRef.current = [];
        stylesToolbarContainerRef.current = null;
      };
    }, []);

    useEffect(() => {
      const open = linkDraft != null;
      if (open && !linkDialogWasOpenRef.current) {
        const target =
          linkDraft?.linkType === 'custom-url' && linkDraft.text.trim()
            ? linkUrlInputRef.current
            : linkTextInputRef.current;
        requestAnimationFrame(() => target?.focus());
      }
      linkDialogWasOpenRef.current = open;
    }, [linkDraft != null]);

    useEffect(() => {
      if (!linkDraft || linkDraft.linkType !== 'published-article' || !linkDraft.articleSlug) {
        return;
      }

      let canceled = false;
      const slug = linkDraft.articleSlug;

      void (async () => {
        try {
          const res = await api.get<ArticleOption[]>('/content/articles/lookup', {
            params: { q: slug, limit: 20 },
          });
          const match = res.data.find((article) => article.slug === slug);
          if (!canceled && match) {
            setSelectedArticle(match);
          }
        } catch {
          // Leave article picker empty when lookup fails.
        }
      })();

      return () => {
        canceled = true;
      };
    }, [linkDraft?.articleSlug, linkDraft?.linkType]);

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
      const open = accordionInsertDraft != null;
      if (open && !accordionInsertDialogWasOpenRef.current) {
        requestAnimationFrame(() => accordionInsertCountInputRef.current?.focus());
      }
      accordionInsertDialogWasOpenRef.current = open;
    }, [accordionInsertDraft != null]);

    useEffect(() => {
      if (!accordionInsertDraft) return;
      const onPointerDown = (event: PointerEvent) => {
        const panel = accordionInsertDialogRef.current;
        const target = event.target;
        if (!(target instanceof Node) || !panel || panel.contains(target)) return;
        setAccordionInsertDraft(null);
      };
      document.addEventListener('pointerdown', onPointerDown, true);
      return () => document.removeEventListener('pointerdown', onPointerDown, true);
    }, [accordionInsertDraft != null]);

    useEffect(() => {
      const open = accordionEditDraft != null;
      if (open && !accordionEditDialogWasOpenRef.current) {
        requestAnimationFrame(() => accordionEditCountInputRef.current?.focus());
      }
      accordionEditDialogWasOpenRef.current = open;
    }, [accordionEditDraft != null]);

    useEffect(() => {
      if (!accordionEditDraft) return;
      const onPointerDown = (event: PointerEvent) => {
        const panel = accordionEditDialogRef.current;
        const target = event.target;
        if (!(target instanceof Node) || !panel || panel.contains(target)) return;
        setAccordionEditDraft(null);
      };
      document.addEventListener('pointerdown', onPointerDown, true);
      return () => document.removeEventListener('pointerdown', onPointerDown, true);
    }, [accordionEditDraft != null]);

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
      const view = getEditorInstance()?.wwEditor?.view;
      if (view) syncToolbarActiveStyles(getActiveCannedStyles(view));
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
          .markdown-description-editor .toastui-editor-ww-container .ProseMirror > p:last-child {
            min-height: 1.25em;
          }
          .markdown-description-editor .toastui-editor-dark .ProseMirror,
          .markdown-description-editor .toastui-editor-dark .toastui-editor-ww-container {
            background-color: #374151 !important;
          }
          .markdown-description-editor .toastui-editor-dark .toastui-editor-ww-container .ProseMirror {
            color: #d1d5db;
          }
          ${getTccIndentCssRules('.markdown-description-editor .toastui-editor-ww-container .ProseMirror')}
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
          .markdown-description-editor .toastui-editor-popup-add-heading ul li.tcc-editor-heading-menu-item--active {
            background-color: #dff4ff;
            font-weight: 600;
          }
          .markdown-description-editor .toastui-editor-dark .toastui-editor-popup-add-heading ul li.tcc-editor-heading-menu-item--active {
            background-color: #1e3a4a;
            color: #e5e7eb;
          }
          .markdown-description-editor .toastui-editor-dark .toastui-editor-popup-add-heading ul li.tcc-editor-heading-menu-item--active h1,
          .markdown-description-editor .toastui-editor-dark .toastui-editor-popup-add-heading ul li.tcc-editor-heading-menu-item--active h2,
          .markdown-description-editor .toastui-editor-dark .toastui-editor-popup-add-heading ul li.tcc-editor-heading-menu-item--active h3,
          .markdown-description-editor .toastui-editor-dark .toastui-editor-popup-add-heading ul li.tcc-editor-heading-menu-item--active h4,
          .markdown-description-editor .toastui-editor-dark .toastui-editor-popup-add-heading ul li.tcc-editor-heading-menu-item--active h5,
          .markdown-description-editor .toastui-editor-dark .toastui-editor-popup-add-heading ul li.tcc-editor-heading-menu-item--active h6,
          .markdown-description-editor .toastui-editor-dark .toastui-editor-popup-add-heading ul li.tcc-editor-heading-menu-item--active div {
            color: inherit;
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
          .markdown-description-editor .tcc-editor-style-button--active {
            color: #01B9BC;
          }
          .tcc-editor-style-menu {
            z-index: 30;
            width: min(36rem, calc(100vw - 16px));
            max-height: min(70vh, calc(100vh - 16px));
            overflow-y: auto;
            border: 1px solid #e5e7eb;
            border-radius: 8px;
            background: white;
            padding: 4px;
            box-shadow: 0 12px 30px rgba(15, 23, 42, 0.18);
          }
          .tcc-editor-style-menu-group {
            display: flex;
            flex-direction: column;
            gap: 4px;
          }
          .tcc-editor-style-menu-section-title {
            margin: 0;
            padding: 4px 10px 0;
            font-size: 11px;
            font-weight: 600;
            line-height: 1.3;
            color: #6b7280;
          }
          .tcc-editor-style-menu-grid {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 4px;
          }
          .tcc-editor-style-menu-grid--inline {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }
          @media (max-width: 640px) {
            .tcc-editor-style-menu-grid--inline {
              grid-template-columns: repeat(2, minmax(0, 1fr));
            }
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
          .tcc-editor-style-menu button.tcc-editor-style-menu-item--active {
            background: #dff4ff;
            font-weight: 600;
          }
          .tcc-editor-style-menu-description {
            color: #6b7280;
            font-size: 11px;
            line-height: 1.35;
          }
          .tcc-editor-style-menu-divider {
            margin: 4px 0;
            border: 0;
            border-top: 1px solid #e5e7eb;
          }
          .tcc-editor-style-menu--dark {
            border-color: #494c56;
            background: #232428;
            box-shadow: 0 12px 30px rgba(0, 0, 0, 0.45);
          }
          .tcc-editor-style-menu--dark button {
            color: #e5e7eb;
          }
          .tcc-editor-style-menu--dark button:hover,
          .tcc-editor-style-menu--dark button:focus {
            background: #36383f;
          }
          .tcc-editor-style-menu--dark button.tcc-editor-style-menu-item--active {
            background: #1e3a4a;
            color: #e5e7eb;
          }
          .tcc-editor-style-menu--dark .tcc-editor-style-menu-description {
            color: #9ca3af;
          }
          .tcc-editor-style-menu--dark .tcc-editor-style-menu-section-title {
            color: #9ca3af;
          }
          .tcc-editor-style-menu--dark .tcc-editor-style-menu-divider {
            border-top-color: #393b42;
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
          .markdown-description-editor .toastui-editor-dark .tcc-editor-style-button--active {
            color: #67ccff;
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
          .markdown-description-editor .toastui-editor-ww-container .ProseMirror .tcc-accordion {
            position: relative;
            margin: 0.85rem 0;
            padding: 0;
            border: 1px dashed #d1d5db;
            border-radius: 0.75rem;
            overflow: hidden;
            background: rgba(249, 250, 251, 0.5);
          }
          .markdown-description-editor .toastui-editor-ww-container .ProseMirror .tcc-accordion-editable {
            outline: none;
          }
          .markdown-description-editor .toastui-editor-ww-container .ProseMirror .tcc-accordion-editable > :not(details) {
            display: none !important;
          }
          .markdown-description-editor .toastui-editor-dark .toastui-editor-ww-container .ProseMirror .tcc-accordion {
            border-color: #4b5563;
            background: rgba(17, 24, 39, 0.35);
          }
          .markdown-description-editor .toastui-editor-ww-container .ProseMirror .tcc-accordion details {
            margin: 0;
            border: none;
            border-radius: 0;
            overflow: visible;
            background: transparent;
          }
          .markdown-description-editor .toastui-editor-ww-container .ProseMirror .tcc-accordion details:not([open]) > .tcc-accordion-panel {
            display: block !important;
          }
          .markdown-description-editor .toastui-editor-ww-container .ProseMirror .tcc-accordion details + details {
            border-top: 1px solid #e5e7eb;
          }
          .markdown-description-editor .toastui-editor-dark .toastui-editor-ww-container .ProseMirror .tcc-accordion details + details {
            border-top-color: #374151;
          }
          .markdown-description-editor .toastui-editor-ww-container .ProseMirror .tcc-accordion summary {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            padding: 0.55rem 0.75rem;
            font-weight: 600;
            list-style: none;
            cursor: text;
            background: rgba(13, 185, 188, 0.07);
          }
          .markdown-description-editor .toastui-editor-ww-container .ProseMirror .tcc-accordion summary::after {
            content: '';
            flex: 1 1 auto;
            align-self: stretch;
            min-width: 0;
          }
          .markdown-description-editor .toastui-editor-dark .toastui-editor-ww-container .ProseMirror .tcc-accordion summary {
            background: rgba(13, 185, 188, 0.12);
          }
          .markdown-description-editor .toastui-editor-ww-container .ProseMirror .tcc-accordion summary::-webkit-details-marker {
            display: none;
          }
          .markdown-description-editor .toastui-editor-ww-container .ProseMirror .tcc-accordion summary::before {
            content: '';
            flex-shrink: 0;
            width: 0.4rem;
            height: 0.4rem;
            border-right: 2px solid currentColor;
            border-bottom: 2px solid currentColor;
            transform: rotate(45deg);
            opacity: 0.55;
          }
          .markdown-description-editor .toastui-editor-ww-container .ProseMirror .tcc-accordion .tcc-accordion-panel,
          .markdown-description-editor .toastui-editor-ww-container .ProseMirror .tcc-accordion details > :not(summary):not(.tcc-accordion-panel) {
            display: block !important;
            padding-inline: 0.75rem;
            padding-bottom: 0.75rem;
          }
          .markdown-description-editor .toastui-editor-ww-container .ProseMirror .tcc-accordion .tcc-accordion-panel-inner,
          .markdown-description-editor .toastui-editor-ww-container .ProseMirror .tcc-accordion details > :not(summary):not(.tcc-accordion-panel) {
            padding-top: 0.5rem;
            border-top: 1px solid #e5e7eb;
          }
          .markdown-description-editor .toastui-editor-ww-container .ProseMirror .tcc-accordion .tcc-accordion-panel-inner p:last-child {
            margin-bottom: 0;
          }
          .markdown-description-editor .toastui-editor-dark .toastui-editor-ww-container .ProseMirror .tcc-accordion .tcc-accordion-panel-inner,
          .markdown-description-editor .toastui-editor-dark .toastui-editor-ww-container .ProseMirror .tcc-accordion details > :not(summary):not(.tcc-accordion-panel) {
            border-top-color: #374151;
          }
        `}</style>
        {onUploadImage ? (
          <input
            ref={imageFileInputRef}
            type="file"
            accept="image/*"
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            onChange={handleImageFileSelected}
          />
        ) : null}
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
          plugins={[linkEditPlugin, tccIndentEditorPlugin, tccAccordionEditorPlugin, tccBlockStyleEnterPlugin, tccPlainTextPastePlugin]}
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
                  Choose a link target type, then pick an article, contact, system page, or custom URL.
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
              <FormField label="Link type" htmlFor={linkTypeId}>
                <ChoiceInput
                  inputId={linkTypeId}
                  layout="inline"
                  options={MARKDOWN_EDITOR_LINK_TYPE_CHOICES}
                  value={linkDraft.linkType}
                  onChange={(next) => {
                    if (next == null || Array.isArray(next)) return;
                    const linkType = next;
                    setSelectedArticle(null);
                    setLinkDraft((draft) => {
                      if (!draft) return draft;
                      const nextDraft: LinkDraft = {
                        ...draft,
                        linkType,
                        articleSlug: null,
                        contactRecipient: null,
                        systemPagePath: null,
                        url: linkType === 'custom-url' ? draft.url : '',
                      };
                      return {
                        ...nextDraft,
                        url: buildMarkdownEditorLinkUrl({
                          linkType: nextDraft.linkType,
                          articleSlug: nextDraft.articleSlug,
                          contactRecipient: nextDraft.contactRecipient,
                          systemPagePath: nextDraft.systemPagePath,
                          customUrl: nextDraft.url,
                        }),
                      };
                    });
                  }}
                  listboxLabel="Link type"
                />
              </FormField>
              {linkDraft.linkType === 'published-article' && (
                <FormField label="Published article" htmlFor={articlePickerId}>
                  <ArticleAutocomplete
                    inputId={articlePickerId}
                    value={selectedArticle}
                    onChange={(article) => {
                      setSelectedArticle(article);
                      setLinkDraft((draft) => {
                        if (!draft) return draft;
                        const articleSlug = article?.slug ?? null;
                        return {
                          ...draft,
                          articleSlug,
                          url: buildMarkdownEditorLinkUrl({
                            linkType: draft.linkType,
                            articleSlug,
                            contactRecipient: draft.contactRecipient,
                            systemPagePath: draft.systemPagePath,
                            customUrl: draft.url,
                          }),
                        };
                      });
                    }}
                    placeholder="Search published articles..."
                  />
                </FormField>
              )}
              {linkDraft.linkType === 'email-contact' && (
                <FormField label="Email contact" htmlFor={contactRecipientId}>
                  <ChoiceInput<string>
                    inputId={contactRecipientId}
                    options={contactRecipientOptions}
                    value={linkDraft.contactRecipient}
                    onChange={(next) => {
                      if (next == null || Array.isArray(next)) return;
                      setLinkDraft((draft) => {
                        if (!draft) return draft;
                        return {
                          ...draft,
                          contactRecipient: next,
                          url: buildMarkdownEditorLinkUrl({
                            linkType: draft.linkType,
                            articleSlug: draft.articleSlug,
                            contactRecipient: next,
                            systemPagePath: draft.systemPagePath,
                            customUrl: draft.url,
                          }),
                        };
                      });
                    }}
                    placeholder={contactRecipientsLoading ? 'Loading contacts...' : 'Choose a contact...'}
                    listboxLabel="Email contact"
                    disabled={contactRecipientsLoading || contactRecipientOptions.length === 0}
                  />
                </FormField>
              )}
              {linkDraft.linkType === 'system-page' && (
                <FormField label="System page" htmlFor={systemPageId}>
                  <ChoiceInput<PublicSystemPagePath>
                    inputId={systemPageId}
                    options={PUBLIC_SYSTEM_PAGE_OPTIONS}
                    value={linkDraft.systemPagePath}
                    onChange={(next) => {
                      if (next == null || Array.isArray(next)) return;
                      setLinkDraft((draft) => {
                        if (!draft) return draft;
                        return {
                          ...draft,
                          systemPagePath: next,
                          url: buildMarkdownEditorLinkUrl({
                            linkType: draft.linkType,
                            articleSlug: draft.articleSlug,
                            contactRecipient: draft.contactRecipient,
                            systemPagePath: next,
                            customUrl: draft.url,
                          }),
                        };
                      });
                    }}
                    placeholder="Choose a page..."
                    listboxLabel="System page"
                  />
                </FormField>
              )}
              {linkDraft.linkType === 'custom-url' && (
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
              )}
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
                disabled={
                  !isMarkdownEditorLinkDraftReady({
                    linkType: linkDraft.linkType,
                    text: linkDraft.text,
                    url: linkDraft.url,
                    articleSlug: linkDraft.articleSlug,
                    contactRecipient: linkDraft.contactRecipient,
                    systemPagePath: linkDraft.systemPagePath,
                  })
                }
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
        {accordionInsertDraft ? (
          <div
            ref={accordionInsertDialogRef}
            className="absolute inset-x-4 top-12 z-20 max-w-xl rounded-xl border border-gray-200 bg-white p-4 shadow-2xl shadow-gray-900/20 dark:border-gray-700 dark:bg-gray-900"
            role="dialog"
            aria-label="Insert accordion"
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                setAccordionInsertDraft(null);
              } else if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                applyAccordionInsertDraft();
              }
            }}
          >
            <div className="mb-3 flex items-start justify-between gap-4">
              <div>
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Insert accordion</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Creates expandable sections. In the editor, all sections stay open for editing.
                </p>
              </div>
              <button
                type="button"
                className="rounded px-2 py-1 text-sm text-gray-500 hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary-teal dark:hover:bg-gray-800 dark:hover:text-gray-200"
                onClick={() => setAccordionInsertDraft(null)}
              >
                Close
              </button>
            </div>
            <FormField
              label="Number of sections"
              htmlFor={accordionInsertCountId}
              required
              helperText={`At least ${TCC_ACCORDION_MIN_ENTRIES} section.`}
            >
              <input
                id={accordionInsertCountId}
                ref={accordionInsertCountInputRef}
                type="number"
                min={TCC_ACCORDION_MIN_ENTRIES}
                className="app-input"
                value={accordionInsertDraft.entryCount}
                onChange={(event) => {
                  const parsed = Number.parseInt(event.target.value, 10);
                  setAccordionInsertDraft((draft) =>
                    draft
                      ? {
                          ...draft,
                          entryCount: Number.isFinite(parsed) ? parsed : draft.entryCount,
                        }
                      : draft
                  );
                }}
              />
            </FormField>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary-teal dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800"
                onClick={() => setAccordionInsertDraft(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded-md bg-primary-teal px-3 py-2 text-sm font-medium text-white hover:bg-primary-teal/90 focus:outline-none focus:ring-2 focus:ring-primary-teal focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={
                  !Number.isFinite(accordionInsertDraft.entryCount) ||
                  accordionInsertDraft.entryCount < TCC_ACCORDION_MIN_ENTRIES
                }
                onClick={applyAccordionInsertDraft}
              >
                Insert accordion
              </button>
            </div>
          </div>
        ) : null}
        {accordionEditDraft ? (
          <div
            ref={accordionEditDialogRef}
            className="absolute inset-x-4 top-12 z-20 max-w-xl rounded-xl border border-gray-200 bg-white p-4 shadow-2xl shadow-gray-900/20 dark:border-gray-700 dark:bg-gray-900"
            role="dialog"
            aria-label="Edit accordion sections"
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                setAccordionEditDraft(null);
              } else if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                applyAccordionEditDraft();
              }
            }}
          >
            <div className="mb-3 flex items-start justify-between gap-4">
              <div>
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Edit accordion sections</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Adding or removing sections updates the end of the list. Removing a section deletes its content.
                </p>
              </div>
              <button
                type="button"
                className="rounded px-2 py-1 text-sm text-gray-500 hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary-teal dark:hover:bg-gray-800 dark:hover:text-gray-200"
                onClick={() => setAccordionEditDraft(null)}
              >
                Close
              </button>
            </div>
            <FormField
              label="Number of sections"
              htmlFor={accordionEditCountId}
              required
              helperText={`At least ${TCC_ACCORDION_MIN_ENTRIES} section.`}
            >
              <input
                id={accordionEditCountId}
                ref={accordionEditCountInputRef}
                type="number"
                min={TCC_ACCORDION_MIN_ENTRIES}
                className="app-input"
                value={accordionEditDraft.entryCount}
                onChange={(event) => {
                  const parsed = Number.parseInt(event.target.value, 10);
                  setAccordionEditDraft((draft) =>
                    draft
                      ? {
                          ...draft,
                          entryCount: Number.isFinite(parsed) ? parsed : draft.entryCount,
                        }
                      : draft
                  );
                }}
              />
            </FormField>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary-teal dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800"
                onClick={() => setAccordionEditDraft(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded-md bg-primary-teal px-3 py-2 text-sm font-medium text-white hover:bg-primary-teal/90 focus:outline-none focus:ring-2 focus:ring-primary-teal focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={
                  !Number.isFinite(accordionEditDraft.entryCount) ||
                  accordionEditDraft.entryCount < TCC_ACCORDION_MIN_ENTRIES
                }
                onClick={applyAccordionEditDraft}
              >
                Update sections
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
        {hoverAccordionEdit
          ? createPortal(
              <div
                ref={hoverAccordionChipRef}
                className="pointer-events-auto fixed z-[45] flex gap-1"
                style={{
                  top: hoverAccordionEdit.top + 6,
                  left: hoverAccordionEdit.right - 76,
                }}
              >
                <button
                  type="button"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-gray-200 bg-white/95 text-gray-600 shadow-md backdrop-blur-sm transition-colors hover:bg-white hover:text-primary-teal focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-teal/40 dark:border-gray-600 dark:bg-gray-900/95 dark:text-gray-300 dark:hover:text-primary-teal"
                  aria-label="Edit accordion sections"
                  title="Edit accordion sections"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => openAccordionEditDialog(hoverAccordionEdit.pos, hoverAccordionEdit.entryCount)}
                >
                  <HiPencilSquare className="h-4 w-4" aria-hidden />
                </button>
                <button
                  type="button"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-gray-200 bg-white/95 text-gray-600 shadow-md backdrop-blur-sm transition-colors hover:bg-white hover:text-red-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40 dark:border-gray-600 dark:bg-gray-900/95 dark:text-gray-300 dark:hover:text-red-400"
                  aria-label="Delete accordion"
                  title="Delete accordion"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => void removeAccordion(hoverAccordionEdit.pos)}
                >
                  <HiOutlineTrash className="h-4 w-4" aria-hidden />
                </button>
              </div>,
              document.body
            )
          : null}
        {stylesToolbarReady && stylesToolbarContainerRef.current
          ? createPortal(
              <ToolbarStylesDropdown
                onApplyStyle={applyCannedStyle}
                activeStyles={toolbarActiveStyles}
                dark={dark}
              />,
              stylesToolbarContainerRef.current
            )
          : null}
      </div>
    );
  }
);

MarkdownDescriptionEditor.displayName = 'MarkdownDescriptionEditor';

export default MarkdownDescriptionEditor;
