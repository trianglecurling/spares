import type { Node as PMNode, ResolvedPos } from 'prosemirror-model';
import { keymap } from 'prosemirror-keymap';
import type { Command } from 'prosemirror-state';
import { EditorState, NodeSelection, Plugin, TextSelection } from 'prosemirror-state';
import type { Transaction } from 'prosemirror-state';
import type { EditorView, NodeView } from 'prosemirror-view';

export const TCC_ACCORDION_CLASS = 'tcc-accordion';
export const TCC_ACCORDION_ATTR = 'data-tcc-accordion';
export const TCC_ACCORDION_ITEM_CLASS = 'tcc-accordion-item';
export const TCC_ACCORDION_PANEL_CLASS = 'tcc-accordion-panel';
export const TCC_ACCORDION_PANEL_INNER_CLASS = 'tcc-accordion-panel-inner';
export const TCC_ACCORDION_EDITABLE_CLASS = 'tcc-accordion-editable';
export const TCC_ACCORDION_MIN_ENTRIES = 1;
/** Keeps empty accordion titles editable without showing the browser default "Details" label. */
const SUMMARY_EDITOR_PLACEHOLDER = '\u200B';
const BROWSER_DEFAULT_SUMMARY_LABEL = 'Details';

type AccordionNodeAttrs = {
  htmlAttrs?: Record<string, string>;
  htmlBlock?: boolean;
  childrenHTML?: string;
};

type AccordionPmNode = {
  type?: { name?: string };
  attrs?: AccordionNodeAttrs;
  nodeSize?: number;
};

export function isTccAccordionHtmlAttrs(htmlAttrs: Record<string, string> | null | undefined): boolean {
  if (!htmlAttrs) return false;
  const classes = (htmlAttrs.class ?? '').split(/\s+/);
  if (!classes.includes(TCC_ACCORDION_CLASS)) return false;
  return htmlAttrs[TCC_ACCORDION_ATTR] === 'true';
}

export function isTccAccordionNode(node: AccordionPmNode | null | undefined): boolean {
  return node?.type?.name === 'div' && Boolean(node.attrs?.htmlBlock) && isTccAccordionHtmlAttrs(node.attrs?.htmlAttrs);
}

export function buildAccordionItemHtml(sectionNumber: number): string {
  return `<details class="${TCC_ACCORDION_ITEM_CLASS}"><summary>Section ${sectionNumber}</summary><div class="${TCC_ACCORDION_PANEL_CLASS}"><div class="${TCC_ACCORDION_PANEL_INNER_CLASS}"><p>Content</p></div></div></details>`;
}

export function buildAccordionChildrenHtml(entryCount: number): string {
  const count = clampAccordionEntryCount(entryCount);
  return normalizeAccordionChildrenHtmlForStorage(
    Array.from({ length: count }, (_, index) => buildAccordionItemHtml(index + 1)).join('')
  );
}

function extractDirectDetailsElements(container: HTMLElement): HTMLDetailsElement[] {
  return Array.from(container.childNodes).flatMap((node) =>
    node instanceof HTMLDetailsElement ? [node] : []
  );
}

function serializeDirectDetailsHtml(detailsElements: HTMLDetailsElement[]): string {
  const sanitized = document.createElement('div');
  for (const detailsEl of detailsElements) {
    const clone = detailsEl.cloneNode(true) as HTMLDetailsElement;
    const summary = clone.querySelector(':scope > summary');
    if (summary instanceof HTMLElement) {
      normalizeSummaryForStorage(summary);
    }
    clone.removeAttribute('open');
    clone.open = false;
    sanitized.appendChild(clone);
  }
  return sanitized.innerHTML;
}

function normalizeSummaryForStorage(summary: HTMLElement): void {
  const text = (summary.textContent ?? '').replace(/\u200B/g, '').trim();
  if (!text) {
    summary.textContent = '';
  }
}

/** Remove editor-only nodes between accordion sections (e.g. blank divs from contenteditable). */
export function pruneAccordionEditableDom(editable: HTMLElement): void {
  for (const child of Array.from(editable.childNodes)) {
    if (!(child instanceof HTMLDetailsElement)) {
      child.remove();
    }
  }
}

function ensureAccordionPanelInner(detailsEl: HTMLDetailsElement): HTMLElement {
  const existingPanel = detailsEl.querySelector(`:scope > .${TCC_ACCORDION_PANEL_CLASS}`);
  let panelEl: HTMLElement;
  if (existingPanel instanceof HTMLElement) {
    panelEl = existingPanel;
  } else {
    panelEl = document.createElement('div');
    panelEl.className = TCC_ACCORDION_PANEL_CLASS;
    const summary = detailsEl.querySelector(':scope > summary');
    if (summary) {
      summary.insertAdjacentElement('afterend', panelEl);
    } else {
      detailsEl.appendChild(panelEl);
    }
  }

  const existingPanelInner = panelEl.querySelector(`:scope > .${TCC_ACCORDION_PANEL_INNER_CLASS}`);
  if (existingPanelInner instanceof HTMLElement) {
    return existingPanelInner;
  }

  const panelInnerEl = document.createElement('div');
  panelInnerEl.className = TCC_ACCORDION_PANEL_INNER_CLASS;
  while (panelEl.firstChild) {
    panelInnerEl.appendChild(panelEl.firstChild);
  }
  panelEl.appendChild(panelInnerEl);
  return panelInnerEl;
}

/** Move panel body content that landed as a direct child of `<details>` back into the panel inner. */
function normalizeAccordionDetailsStructure(container: HTMLElement): boolean {
  let changed = false;

  for (const detailsNode of container.querySelectorAll(`details.${TCC_ACCORDION_ITEM_CLASS}, details`)) {
    if (!(detailsNode instanceof HTMLDetailsElement)) continue;

    const panelInner = ensureAccordionPanelInner(detailsNode);
    for (const child of Array.from(detailsNode.children)) {
      if (child.tagName === 'SUMMARY') continue;
      if (child.classList.contains(TCC_ACCORDION_PANEL_CLASS)) continue;
      panelInner.appendChild(child);
      changed = true;
    }
  }

  return changed;
}

/** Persist accordion sections collapsed; the editor forces them open only for editing. */
export function normalizeAccordionChildrenHtmlForStorage(childrenHTML: string): string {
  const container = document.createElement('div');
  container.innerHTML = childrenHTML.trim();
  normalizeAccordionDetailsStructure(container);
  return serializeDirectDetailsHtml(extractDirectDetailsElements(container));
}

/** Strip editor-persisted `open` from accordion items in saved markdown (legacy content). */
export function stripAccordionOpenStateFromMarkdown(markdown: string): string {
  if (!markdown.includes(TCC_ACCORDION_CLASS)) return markdown;

  return markdown
    .replace(/<details\b([^>]*)\s+open(?:=(?:''|""|true))?\s*/gi, '<details$1 ')
    .replace(/<details\b\s+open(?:=(?:''|""|true))?\s*/gi, '<details ');
}

function buildAccordionMarkdownBlock(htmlAttrs: Record<string, string> | undefined, childrenHTML: string): string {
  const attrs = htmlAttrs ?? {};
  let openTag = '<div';
  for (const [name, value] of Object.entries(attrs)) {
    openTag += ` ${name}="${String(value).replace(/"/g, "'")}"`;
  }
  openTag += '>';
  return `${openTag}${childrenHTML}</div>`;
}

function findMatchingClosingDivIndex(html: string, openTagStart: number): number {
  const openTagPattern = /<div\b/gi;
  const closeTagPattern = /<\/div\s*>/gi;

  openTagPattern.lastIndex = openTagStart;
  const firstOpen = openTagPattern.exec(html);
  if (!firstOpen) return -1;

  let depth = 1;
  let searchFrom = firstOpen.index + firstOpen[0].length;

  while (searchFrom < html.length && depth > 0) {
    openTagPattern.lastIndex = searchFrom;
    closeTagPattern.lastIndex = searchFrom;
    const nextOpen = openTagPattern.exec(html);
    const nextClose = closeTagPattern.exec(html);
    if (!nextOpen && !nextClose) return -1;

    const openAt = nextOpen ? nextOpen.index : Number.POSITIVE_INFINITY;
    const closeAt = nextClose ? nextClose.index : Number.POSITIVE_INFINITY;

    if (openAt < closeAt) {
      depth += 1;
      searchFrom = openAt + nextOpen![0].length;
    } else {
      depth -= 1;
      if (depth === 0) return closeAt + nextClose![0].length;
      searchFrom = closeAt + nextClose![0].length;
    }
  }

  return -1;
}

/** Read live accordion HTML into markdown without mutating the ProseMirror doc (preserves caret). */
export function injectLiveAccordionHtmlIntoMarkdown(view: EditorView, markdown: string): string {
  if (!markdown.includes(TCC_ACCORDION_CLASS)) return markdown;

  const liveBlocks: string[] = [];
  view.state.doc.nodesBetween(0, view.state.doc.content.size, (node, pos) => {
    if (!isTccAccordionNode(node)) return undefined;
    const dom = view.nodeDOM(pos);
    if (!(dom instanceof HTMLElement)) return false;
    const childrenHTML = readAccordionChildrenHtml(dom);
    liveBlocks.push(
      buildAccordionMarkdownBlock(node.attrs?.htmlAttrs as Record<string, string> | undefined, childrenHTML)
    );
    return false;
  });

  if (!liveBlocks.length) return markdown;

  let blockIndex = 0;
  let result = '';
  let cursor = 0;
  const openRe = /<div\b[^>]*\btcc-accordion\b[^>]*>/gi;
  let match: RegExpExecArray | null;

  while ((match = openRe.exec(markdown)) !== null && blockIndex < liveBlocks.length) {
    const start = match.index;
    const end = findMatchingClosingDivIndex(markdown, start);
    if (end < 0) break;
    result += markdown.slice(cursor, start) + liveBlocks[blockIndex++];
    cursor = end;
    openRe.lastIndex = end;
  }

  return result + markdown.slice(cursor);
}

function isAccordionEditableFocused(): boolean {
  const active = document.activeElement;
  return active instanceof Element && Boolean(active.closest(`.${TCC_ACCORDION_CLASS} .${TCC_ACCORDION_EDITABLE_CLASS}`));
}

function isAccordionDomBeingEdited(accordionDom: HTMLElement): boolean {
  const editable = getAccordionEditableRoot(accordionDom);
  const active = document.activeElement;
  return active instanceof Node && editable.contains(active);
}

function readAccordionChildrenHtml(accordionDom: HTMLElement): string {
  const editable = getAccordionEditableRoot(accordionDom);
  // Dirty-check polling calls getMarkdown while the user may be typing in an accordion.
  // Normalizing the live DOM during that read disrupts the native selection and scroll.
  if (!isAccordionDomBeingEdited(accordionDom)) {
    pruneAccordionEditableDom(editable);
    normalizeAccordionDetailsStructure(editable);
  }
  return serializeDirectDetailsHtml(extractDirectDetailsElements(editable));
}

export function countAccordionEntries(childrenHTML: string): number {
  const container = document.createElement('div');
  container.innerHTML = childrenHTML.trim();
  return container.querySelectorAll(`:scope > details.${TCC_ACCORDION_ITEM_CLASS}, :scope > details`).length;
}

export function resizeAccordionChildrenHtml(childrenHTML: string, newCount: number): string {
  const container = document.createElement('div');
  container.innerHTML = childrenHTML.trim();
  const details = extractDirectDetailsElements(container);
  const targetCount = clampAccordionEntryCount(newCount);
  const currentCount = details.length;

  const working = document.createElement('div');
  for (const detailsEl of details) {
    working.appendChild(detailsEl.cloneNode(true));
  }

  if (targetCount > currentCount) {
    for (let index = currentCount; index < targetCount; index += 1) {
      working.insertAdjacentHTML('beforeend', buildAccordionItemHtml(index + 1));
    }
  } else if (targetCount < currentCount) {
    const workingDetails = extractDirectDetailsElements(working);
    for (let index = currentCount - 1; index >= targetCount; index -= 1) {
      workingDetails[index]?.remove();
    }
  }

  return normalizeAccordionChildrenHtmlForStorage(working.innerHTML);
}

export function clampAccordionEntryCount(count: number): number {
  if (!Number.isFinite(count)) return TCC_ACCORDION_MIN_ENTRIES;
  return Math.max(TCC_ACCORDION_MIN_ENTRIES, Math.floor(count));
}

export function resolveTccAccordionElement(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const accordion = target.closest(`.${TCC_ACCORDION_CLASS}[${TCC_ACCORDION_ATTR}]`);
  return accordion instanceof HTMLElement ? accordion : null;
}

export function findTccAccordionNodePos(view: EditorView, accordionEl: HTMLElement): number | null {
  const pos = view.posAtDOM(accordionEl, 0);
  if (pos < 0) return null;

  const $pos = view.state.doc.resolve(pos);
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    const node = $pos.node(depth);
    if (isTccAccordionNode(node)) {
      return $pos.before(depth);
    }
  }

  const nodeAt = view.state.doc.nodeAt(pos);
  if (isTccAccordionNode(nodeAt)) return pos;
  return null;
}

function applyAccordionDomAttrs(dom: HTMLElement, htmlAttrs: Record<string, string> | undefined) {
  if (htmlAttrs) {
    for (const [name, value] of Object.entries(htmlAttrs)) {
      if (name === 'class') {
        dom.className = value;
      } else {
        dom.setAttribute(name, value);
      }
    }
  }
  dom.classList.add('html-block');
}

function getAccordionEditableRoot(accordionDom: HTMLElement): HTMLElement {
  const editable = accordionDom.querySelector(`:scope > .${TCC_ACCORDION_EDITABLE_CLASS}`);
  return editable instanceof HTMLElement ? editable : accordionDom;
}

function replaceTccAccordionNode(
  view: EditorView,
  pos: number,
  node: PMNode,
  childrenHTML: string,
  addToHistory: boolean
): boolean {
  if (!isTccAccordionNode(node)) return false;
  const normalizedNext = normalizeAccordionChildrenHtmlForStorage(childrenHTML);
  const normalizedStored = normalizeAccordionChildrenHtmlForStorage(node.attrs.childrenHTML ?? '');
  if (normalizedNext === normalizedStored) return false;

  const newNode = node.type.create({
    ...node.attrs,
    childrenHTML: normalizedNext,
  });
  const tr = view.state.tr.replaceWith(pos, pos + node.nodeSize, newNode);
  const transaction = tr.setMeta('addToHistory', addToHistory);
  if (!isAccordionEditableFocused()) {
    transaction.scrollIntoView();
  }
  view.dispatch(transaction);
  return true;
}

export function syncTccAccordionHtmlFromDom(view: EditorView, options?: { force?: boolean }): boolean {
  if (!options?.force && isAccordionEditableFocused()) return false;

  const updates: Array<{ pos: number; childrenHTML: string; node: PMNode }> = [];

  view.state.doc.nodesBetween(0, view.state.doc.content.size, (node, pos) => {
    if (!isTccAccordionNode(node)) return undefined;

    const dom = view.nodeDOM(pos);
    if (!(dom instanceof HTMLElement)) return false;

    const nextChildrenHtml = readAccordionChildrenHtml(dom);
    const storedChildrenHtml = normalizeAccordionChildrenHtmlForStorage(node.attrs?.childrenHTML ?? '');
    if (nextChildrenHtml === storedChildrenHtml) return false;

    updates.push({ pos, childrenHTML: nextChildrenHtml, node: node as PMNode });
    return false;
  });

  if (!updates.length) return false;

  let tr = view.state.tr;
  for (const update of updates.reverse()) {
    const mappedPos = tr.mapping.map(update.pos);
    const current = tr.doc.nodeAt(mappedPos);
    if (!current || !isTccAccordionNode(current)) continue;

    const newNode = current.type.create({
      ...current.attrs,
      childrenHTML: update.childrenHTML,
    });
    tr = tr.replaceWith(mappedPos, mappedPos + current.nodeSize, newNode);
  }

  view.dispatch(tr.setMeta('addToHistory', false).scrollIntoView());
  return true;
}

/** Accordion html-blocks are atoms; without a trailing paragraph there is nowhere to place the caret after the last one. */
function findTopLevelBlockDepth($from: ResolvedPos): number | null {
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if ($from.node(depth - 1).type.name === 'doc') return depth;
  }
  return null;
}

function isSentinelParagraphAfterAccordion($from: ResolvedPos, doc: PMNode): boolean {
  const blockDepth = findTopLevelBlockDepth($from);
  if (blockDepth == null) return false;
  if ($from.node(blockDepth).type.name !== 'paragraph') return false;
  if ($from.index(blockDepth - 1) !== doc.childCount - 1) return false;

  const blockStart = $from.before(blockDepth);
  const nodeBefore = doc.resolve(blockStart).nodeBefore;
  return nodeBefore != null && isTccAccordionNode(nodeBefore);
}

function appendTrailingParagraphIfAccordionLast(state: EditorState): Transaction | null {
  const { doc, schema, selection } = state;
  const last = doc.lastChild;
  if (!last || !isTccAccordionNode(last)) return null;
  const paragraph = schema.nodes.paragraph;
  if (!paragraph) return null;

  const insertPos = doc.content.size;
  let tr = state.tr.insert(insertPos, paragraph.create()).setMeta('addToHistory', false);

  const accordionPos = insertPos - last.nodeSize;
  const shouldFocusTrailing = selection.from >= accordionPos && selection.from <= insertPos;

  if (shouldFocusTrailing) {
    tr = tr.setSelection(TextSelection.create(tr.doc, insertPos + 1));
  }

  return tr;
}

/** Prevent Backspace from joining away the required empty paragraph after a trailing accordion. */
const blockSentinelBackspace: Command = (state, _dispatch, view) => {
  if (view?.composing) return false;
  const { selection, doc } = state;
  if (!(selection instanceof TextSelection) || !selection.empty) return false;

  const $from = selection.$from;
  if (!isSentinelParagraphAfterAccordion($from, doc)) return false;
  if ($from.parentOffset !== 0 || $from.parent.content.size !== 0) return false;

  return true;
};

function withTrailingParagraphIfAccordionLast(tr: Transaction, schema: EditorState['schema']): Transaction {
  const last = tr.doc.lastChild;
  if (!last || !isTccAccordionNode(last)) return tr;
  const paragraph = schema.nodes.paragraph;
  if (!paragraph) return tr;
  return tr.insert(tr.doc.content.size, paragraph.create());
}

export function ensureTrailingParagraphAfterAccordion(view: EditorView): boolean {
  const tr = appendTrailingParagraphIfAccordionLast(view.state);
  if (!tr) return false;
  view.dispatch(tr.setMeta('addToHistory', false).scrollIntoView());
  return true;
}

export function insertTccAccordion(view: EditorView, entryCount: number): boolean {
  const divType = view.state.schema.nodes.div;
  if (!divType) return false;

  const childrenHTML = buildAccordionChildrenHtml(entryCount);
  const node = divType.create({
    htmlAttrs: {
      class: TCC_ACCORDION_CLASS,
      [TCC_ACCORDION_ATTR]: 'true',
    },
    childrenHTML,
  });

  const insertTr = withTrailingParagraphIfAccordionLast(
    view.state.tr.replaceSelectionWith(node),
    view.state.schema
  );
  view.dispatch(insertTr.scrollIntoView());
  return true;
}

export function setTccAccordionEntryCount(view: EditorView, pos: number, entryCount: number): boolean {
  const node = view.state.doc.nodeAt(pos);
  if (!node || !isTccAccordionNode(node)) return false;

  const childrenHTML = resizeAccordionChildrenHtml(node.attrs?.childrenHTML ?? '', entryCount);
  return replaceTccAccordionNode(view, pos, node, childrenHTML, true);
}

export function deleteTccAccordion(view: EditorView, pos: number): boolean {
  const node = view.state.doc.nodeAt(pos);
  if (!node || !isTccAccordionNode(node)) return false;

  const from = pos;
  const to = pos + node.nodeSize;
  let tr = view.state.tr.delete(from, to);

  if (tr.doc.content.size === 0) {
    const paragraph = view.state.schema.nodes.paragraph;
    if (paragraph) {
      tr = tr.insert(0, paragraph.create());
    }
  }

  const selectionPos = Math.min(from, Math.max(1, tr.doc.content.size - 1));
  tr = tr.setSelection(TextSelection.near(tr.doc.resolve(selectionPos), -1));
  view.dispatch(tr.scrollIntoView());
  return true;
}

/* -------------------------------------------------------------------------------------------------
 * Native panel formatting
 *
 * Toast UI stores the whole accordion as a single opaque `div` html-block (childrenHTML string),
 * so ProseMirror cannot manage the nested panel content as real nodes. Headings and canned styles
 * are therefore applied directly to the contenteditable panel DOM, then picked up by the existing
 * live-DOM export path (`injectLiveAccordionHtmlIntoMarkdown`) and blur sync.
 * ----------------------------------------------------------------------------------------------- */

const TCC_STYLE_CLASS_PREFIX = 'tcc-style-';

const ACCORDION_BLOCK_STYLE_CLASSES = new Set([
  'tcc-style-info-box',
  'tcc-style-critical-box',
  'tcc-style-callout',
  'tcc-style-aside',
]);

export type AccordionSelectionContext = {
  editable: HTMLElement;
  inSummary: boolean;
  panelInner: HTMLElement | null;
  selection: Selection;
  range: Range;
};

export type AccordionSelectionSnapshot = {
  editable: HTMLElement;
  range: Range;
};

export type AccordionActiveFormat = {
  headingLevel: number | null;
  styles: string[];
};

function elementFromNode(node: Node | null): Element | null {
  if (!node) return null;
  return node instanceof Element ? node : node.parentElement;
}

function rangeIntersectsNode(range: Range, node: Node): boolean {
  if (typeof range.intersectsNode === 'function') return range.intersectsNode(node);
  const nodeRange = document.createRange();
  nodeRange.selectNode(node);
  return (
    range.compareBoundaryPoints(Range.END_TO_START, nodeRange) < 0 &&
    range.compareBoundaryPoints(Range.START_TO_END, nodeRange) > 0
  );
}

export function getAccordionSelectionContext(): AccordionSelectionContext | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  const anchorEl = elementFromNode(range.startContainer);
  const editable = anchorEl?.closest(`.${TCC_ACCORDION_EDITABLE_CLASS}`);
  if (!(editable instanceof HTMLElement)) return null;
  const panelInner = anchorEl?.closest(`.${TCC_ACCORDION_PANEL_INNER_CLASS}`);
  return {
    editable,
    inSummary: Boolean(anchorEl?.closest('summary')),
    panelInner: panelInner instanceof HTMLElement ? panelInner : null,
    selection,
    range,
  };
}

export function captureAccordionSelectionSnapshot(): AccordionSelectionSnapshot | null {
  const ctx = getAccordionSelectionContext();
  if (!ctx) return null;
  return { editable: ctx.editable, range: ctx.range.cloneRange() };
}

export function restoreAccordionSelectionSnapshot(snapshot: AccordionSelectionSnapshot | null): boolean {
  if (!snapshot || !snapshot.editable.isConnected) return false;
  const selection = window.getSelection();
  if (!selection) return false;
  selection.removeAllRanges();
  selection.addRange(snapshot.range.cloneRange());
  return true;
}

function removeTccStyleClasses(element: HTMLElement) {
  for (const className of Array.from(element.classList)) {
    if (className.startsWith(TCC_STYLE_CLASS_PREFIX)) element.classList.remove(className);
  }
  if (!element.classList.length) element.removeAttribute('class');
}

function setSingleTccStyleClass(element: HTMLElement, styleClass: string) {
  removeTccStyleClasses(element);
  element.classList.add(styleClass);
}

function getBlockStyleClassName(element: HTMLElement): string | null {
  for (const className of element.classList) {
    if (ACCORDION_BLOCK_STYLE_CLASSES.has(className)) return className;
  }
  return null;
}

function isBlockStyleWrapper(element: HTMLElement): boolean {
  return element.tagName === 'DIV' && getBlockStyleClassName(element) != null;
}

/** Unwrap `<div class="tcc-style-*"><p>…</p></div>` and return the inner blocks. */
function unwrapBlockStyleWrapper(wrapper: HTMLElement): HTMLElement[] {
  const parent = wrapper.parentNode;
  if (!parent) return [];
  const children = Array.from(wrapper.children).filter((child): child is HTMLElement => child instanceof HTMLElement);
  for (const child of children) parent.insertBefore(child, wrapper);
  parent.removeChild(wrapper);
  return children;
}

function normalizeBlockForStyleContainer(block: HTMLElement): HTMLElement {
  if (isHeadingTag(block)) return replaceBlockTag(block, 'p', true);
  if (isBlockStyleWrapper(block)) {
    const paragraph = Array.from(block.children).find(
      (child): child is HTMLElement => child instanceof HTMLElement && child.tagName === 'P'
    );
    if (paragraph) return paragraph;
    const replacement = document.createElement('p');
    replacement.innerHTML = block.innerHTML;
    return replacement;
  }
  if (block.tagName === 'P' && getBlockStyleClassName(block)) {
    removeTccStyleClasses(block);
    return block;
  }
  return block.tagName === 'P' ? block : replaceBlockTag(block, 'p', true);
}

function flattenPanelBlocksForEditing(blocks: HTMLElement[]): HTMLElement[] {
  return blocks.flatMap((block) => {
    if (isBlockStyleWrapper(block)) return unwrapBlockStyleWrapper(block);
    if (block.tagName === 'P' && getBlockStyleClassName(block)) {
      removeTccStyleClasses(block);
      return [block];
    }
    return [block];
  });
}

/** Match main-editor markdown: `<div class="tcc-style-*"><p>…</p></div>`. */
function wrapPanelBlocksInStyleContainer(blocks: HTMLElement[], styleClass: string): HTMLElement {
  if (blocks.length === 1 && isBlockStyleWrapper(blocks[0])) {
    setSingleTccStyleClass(blocks[0], styleClass);
    return blocks[0];
  }

  const innerBlocks = blocks.flatMap((block) => {
    if (isBlockStyleWrapper(block)) return unwrapBlockStyleWrapper(block);
    return [normalizeBlockForStyleContainer(block)];
  });

  const wrapper = document.createElement('div');
  wrapper.className = styleClass;

  const insertPoint = blocks[0];
  const parent = insertPoint.parentNode;
  if (parent) {
    parent.insertBefore(wrapper, insertPoint);
    for (const block of blocks) {
      if (block.parentNode === parent) block.remove();
    }
  }

  for (const inner of innerBlocks) {
    removeTccStyleClasses(inner);
    wrapper.appendChild(inner);
  }

  return wrapper;
}

/** Upgrade legacy `<p class="tcc-style-*">` panel blocks to the canonical wrapper markup. */
function migrateLegacyAccordionPanelBlockStyles(editable: HTMLElement): void {
  editable.querySelectorAll(`.${TCC_ACCORDION_PANEL_INNER_CLASS} > p`).forEach((node) => {
    if (!(node instanceof HTMLElement)) return;
    const styleClass = getBlockStyleClassName(node);
    if (!styleClass) return;
    removeTccStyleClasses(node);
    const wrapper = document.createElement('div');
    wrapper.className = styleClass;
    node.replaceWith(wrapper);
    wrapper.appendChild(node);
  });
}

function isHeadingTag(element: Element): boolean {
  return /^h[1-6]$/i.test(element.tagName);
}

function getPanelBlock(node: Node | null, panelInner: HTMLElement): HTMLElement | null {
  let current = elementFromNode(node);
  while (current && current !== panelInner) {
    if (current.parentElement === panelInner && current instanceof HTMLElement) return current;
    current = current.parentElement;
  }
  return null;
}

function getPanelBlocksInRange(panelInner: HTMLElement, range: Range): HTMLElement[] {
  const blocks = Array.from(panelInner.children).filter(
    (child): child is HTMLElement => child instanceof HTMLElement && rangeIntersectsNode(range, child)
  );
  if (blocks.length) return blocks;

  const single = getPanelBlock(range.startContainer, panelInner);
  if (single) return [single];

  if (panelInner.childNodes.length) {
    const paragraph = document.createElement('p');
    while (panelInner.firstChild) paragraph.appendChild(panelInner.firstChild);
    panelInner.appendChild(paragraph);
    return [paragraph];
  }
  return [];
}

/** Replace a block element's tag, preserving inner HTML and non-class attributes. */
function replaceBlockTag(block: HTMLElement, tagName: string, dropStyleClasses: boolean): HTMLElement {
  const sameTag = block.tagName.toLowerCase() === tagName.toLowerCase();
  if (sameTag) {
    if (dropStyleClasses) removeTccStyleClasses(block);
    return block;
  }

  const replacement = document.createElement(tagName);
  replacement.innerHTML = block.innerHTML;
  for (const attr of Array.from(block.attributes)) {
    if (attr.name === 'class') continue;
    replacement.setAttribute(attr.name, attr.value);
  }
  const keptClasses = Array.from(block.classList).filter(
    (className) => !(dropStyleClasses && className.startsWith(TCC_STYLE_CLASS_PREFIX))
  );
  if (keptClasses.length) replacement.className = keptClasses.join(' ');
  block.replaceWith(replacement);
  return replacement;
}

function selectBlocksContents(blocks: HTMLElement[]) {
  if (!blocks.length) return;
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.setStart(blocks[0], 0);
  const last = blocks[blocks.length - 1];
  range.setEnd(last, last.childNodes.length);
  selection.removeAllRanges();
  selection.addRange(range);
}

function selectNodeContents(node: Node) {
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(node);
  selection.removeAllRanges();
  selection.addRange(range);
}

export function applyAccordionHeadingToSelection(level: number): boolean {
  const ctx = getAccordionSelectionContext();
  if (!ctx || ctx.inSummary || !ctx.panelInner) return false;
  const panelBlocks = getPanelBlocksInRange(ctx.panelInner, ctx.range);
  if (!panelBlocks.length) return false;
  const blocks = flattenPanelBlocksForEditing(panelBlocks);
  if (!blocks.length) return false;
  const tag = level >= 1 && level <= 6 ? `h${level}` : 'p';
  const updated = blocks.map((block) => replaceBlockTag(normalizeBlockForStyleContainer(block), tag, true));
  selectBlocksContents(updated);
  ensureAllAccordionPanelParagraphs(ctx.editable);
  return true;
}

export function applyAccordionBlockStyleToSelection(styleClass: string): boolean {
  const ctx = getAccordionSelectionContext();
  if (!ctx || ctx.inSummary || !ctx.panelInner) return false;
  const blocks = getPanelBlocksInRange(ctx.panelInner, ctx.range);
  if (!blocks.length) return false;
  const wrapper = wrapPanelBlocksInStyleContainer(blocks, styleClass);
  selectBlocksContents([wrapper]);
  ensureAllAccordionPanelParagraphs(ctx.editable);
  return true;
}

function getEnclosingInlineStyleElement(range: Range, styleClass: string): HTMLElement | null {
  let current = elementFromNode(range.startContainer);
  while (current && current.classList) {
    if (
      (current.tagName === 'SPAN' || current.tagName === 'SMALL') &&
      current.classList.contains(styleClass) &&
      current.contains(range.endContainer)
    ) {
      return current as HTMLElement;
    }
    if (current.classList.contains(TCC_ACCORDION_EDITABLE_CLASS)) break;
    current = current.parentElement;
  }
  return null;
}

function unwrapElement(element: HTMLElement) {
  const parent = element.parentNode;
  if (!parent) return;
  while (element.firstChild) parent.insertBefore(element.firstChild, element);
  parent.removeChild(element);
}

function unwrapTccInlineStylesInRange(scope: HTMLElement, range: Range) {
  const candidates = Array.from(scope.querySelectorAll('span, small')).filter(
    (element): element is HTMLElement =>
      element instanceof HTMLElement &&
      Array.from(element.classList).some((className) => className.startsWith(TCC_STYLE_CLASS_PREFIX)) &&
      rangeIntersectsNode(range, element)
  );
  for (const element of candidates) unwrapElement(element);
}

export function applyAccordionInlineStyleToSelection(tag: 'span' | 'small', styleClass: string): boolean {
  const ctx = getAccordionSelectionContext();
  if (!ctx || ctx.inSummary || ctx.range.collapsed) return false;

  const existing = getEnclosingInlineStyleElement(ctx.range, styleClass);
  if (existing) {
    unwrapElement(existing);
    return true;
  }

  const scope = ctx.panelInner ?? ctx.editable;
  unwrapTccInlineStylesInRange(scope, ctx.range);

  const refreshed = window.getSelection();
  if (!refreshed || refreshed.rangeCount === 0) return false;
  const range = refreshed.getRangeAt(0);

  const wrapper = document.createElement(tag);
  wrapper.className = styleClass;
  try {
    range.surroundContents(wrapper);
  } catch {
    const contents = range.extractContents();
    wrapper.appendChild(contents);
    range.insertNode(wrapper);
  }
  selectNodeContents(wrapper);
  return true;
}

export function clearAccordionStylesInSelection(): boolean {
  const ctx = getAccordionSelectionContext();
  if (!ctx || ctx.inSummary) return false;

  const scope = ctx.panelInner ?? ctx.editable;
  unwrapTccInlineStylesInRange(scope, ctx.range);

  if (ctx.panelInner) {
    const blocks = getPanelBlocksInRange(ctx.panelInner, ctx.range);
    const updated: HTMLElement[] = [];
    for (const block of blocks) {
      if (isBlockStyleWrapper(block)) {
        updated.push(...unwrapBlockStyleWrapper(block));
        continue;
      }
      removeTccStyleClasses(block);
      updated.push(isHeadingTag(block) ? replaceBlockTag(block, 'p', false) : block);
    }
    selectBlocksContents(updated);
  }
  ensureAllAccordionPanelParagraphs(ctx.editable);
  return true;
}

export function getAccordionActiveFormat(): AccordionActiveFormat | null {
  const ctx = getAccordionSelectionContext();
  if (!ctx) return null;
  if (ctx.inSummary) return { headingLevel: null, styles: [] };

  const styles = new Set<string>();
  let headingLevel: number | null = null;

  if (ctx.panelInner) {
    const panelBlock = getPanelBlock(ctx.range.startContainer, ctx.panelInner);
    if (panelBlock) {
      const styleWrapper = isBlockStyleWrapper(panelBlock)
        ? panelBlock
        : panelBlock.parentElement && isBlockStyleWrapper(panelBlock.parentElement)
          ? panelBlock.parentElement
          : null;

      if (styleWrapper) {
        const blockStyle = getBlockStyleClassName(styleWrapper);
        if (blockStyle) styles.add(blockStyle);
      } else {
        const legacyStyle = getBlockStyleClassName(panelBlock);
        if (legacyStyle) styles.add(legacyStyle);
      }

      const contentBlock =
        styleWrapper?.querySelector(
          ':scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > h5, :scope > h6, :scope > p'
        ) ?? panelBlock;
      if (contentBlock instanceof HTMLElement) {
        const match = /^h([1-6])$/i.exec(contentBlock.tagName);
        if (match) headingLevel = Number(match[1]);
      }
    }
  }

  let current = elementFromNode(ctx.range.startContainer);
  while (current && ctx.editable.contains(current)) {
    if (current.tagName === 'SPAN' || current.tagName === 'SMALL') {
      for (const className of current.classList) {
        if (className.startsWith(TCC_STYLE_CLASS_PREFIX)) styles.add(className);
      }
    }
    current = current.parentElement;
  }

  return { headingLevel, styles: [...styles] };
}

function ensureAccordionDetailsOpen(root: HTMLElement) {
  root.querySelectorAll('details').forEach((detailsEl) => {
    if (detailsEl instanceof HTMLDetailsElement && !detailsEl.open) {
      detailsEl.open = true;
    }
  });
}

function getPanelInnerFromSelection(): HTMLElement | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const anchor = selection.anchorNode;
  if (!anchor) return null;
  const element = anchor instanceof Element ? anchor : anchor.parentElement;
  const panelInner = element?.closest(`.${TCC_ACCORDION_PANEL_INNER_CLASS}`);
  return panelInner instanceof HTMLElement ? panelInner : null;
}

function isSelectionInAccordionSummary(): boolean {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return false;
  const anchor = selection.anchorNode;
  if (!anchor) return false;
  const element = anchor instanceof Element ? anchor : anchor.parentElement;
  return Boolean(element?.closest('summary'));
}

function countPanelParagraphs(panelInner: HTMLElement): number {
  return panelInner.querySelectorAll('p').length;
}

function isRangeAtParagraphStart(range: Range, paragraph: HTMLElement): boolean {
  const testRange = document.createRange();
  testRange.selectNodeContents(paragraph);
  testRange.setEnd(range.startContainer, range.startOffset);
  return testRange.toString().length === 0;
}

function selectionTargetsOnlyPanelParagraph(onlyParagraph: HTMLParagraphElement): boolean {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return false;
  const range = selection.getRangeAt(0);
  return onlyParagraph.contains(range.startContainer) || range.commonAncestorContainer === onlyParagraph;
}

function shouldPreventDeletingOnlyPanelParagraph(panelInner: HTMLElement, onlyParagraph: HTMLParagraphElement): boolean {
  if (countPanelParagraphs(panelInner) !== 1) return false;

  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return false;
  const range = selection.getRangeAt(0);

  if (!range.collapsed && range.intersectsNode(panelInner)) {
    const scratch = document.createElement('div');
    scratch.appendChild(range.cloneContents());
    if (scratch.querySelector('p')) return true;
  }

  if (!selectionTargetsOnlyPanelParagraph(onlyParagraph)) return false;

  if (!range.collapsed) {
    const selectedText = range.toString();
    const paragraphText = onlyParagraph.textContent ?? '';
    if (selectedText && selectedText === paragraphText) return false;
    return range.intersectsNode(onlyParagraph);
  }

  return isRangeAtParagraphStart(range, onlyParagraph);
}

/** Each accordion section must keep at least one `<p>` so the details body stays editable. */
function ensurePanelInnerMinimumParagraph(panelInner: HTMLElement): boolean {
  if (panelInner.querySelector('p')) return false;

  const paragraph = document.createElement('p');
  paragraph.appendChild(document.createElement('br'));
  panelInner.appendChild(paragraph);

  const selection = window.getSelection();
  if (selection && panelInner.contains(selection.anchorNode)) {
    const range = document.createRange();
    range.setStart(paragraph, 0);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  return true;
}

function getSummaryFromSelection(): HTMLElement | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const anchor = selection.anchorNode;
  if (!anchor) return null;
  const element = anchor instanceof Element ? anchor : anchor.parentElement;
  const summary = element?.closest('summary');
  return summary instanceof HTMLElement ? summary : null;
}

function getSummaryMeaningfulText(summary: HTMLElement): string {
  return (summary.textContent ?? '').replace(/\u200B/g, '').trim();
}

function isSummaryEffectivelyEmpty(summary: HTMLElement): boolean {
  return getSummaryMeaningfulText(summary).length === 0;
}

function isRangeAtSummaryStart(range: Range, summary: HTMLElement): boolean {
  const testRange = document.createRange();
  testRange.selectNodeContents(summary);
  testRange.setEnd(range.startContainer, range.startOffset);
  return testRange.toString().replace(/\u200B/g, '').length === 0;
}

function placeCaretInSummary(summary: HTMLElement, offset: number) {
  const selection = window.getSelection();
  if (!selection) return;
  const textNode = Array.from(summary.childNodes).find((node) => node.nodeType === Node.TEXT_NODE);
  if (textNode) {
    const range = document.createRange();
    range.setStart(textNode, Math.min(offset, textNode.textContent?.length ?? 0));
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    return;
  }
  const range = document.createRange();
  range.setStart(summary, 0);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

function ensureSummaryMinimumContent(summary: HTMLElement): boolean {
  let changed = false;
  const meaningful = getSummaryMeaningfulText(summary);

  if (meaningful === BROWSER_DEFAULT_SUMMARY_LABEL && summary.childNodes.length <= 1) {
    summary.textContent = '';
    changed = true;
  }

  if (!isSummaryEffectivelyEmpty(summary)) {
    return changed;
  }

  if ((summary.textContent ?? '').replace(/\u200B/g, '') !== '') {
    summary.textContent = '';
    changed = true;
  }

  if (!(summary.textContent ?? '').includes(SUMMARY_EDITOR_PLACEHOLDER)) {
    summary.textContent = SUMMARY_EDITOR_PLACEHOLDER;
    changed = true;
  }

  if (changed) {
    placeCaretInSummary(summary, SUMMARY_EDITOR_PLACEHOLDER.length);
  }

  return changed;
}

function ensureAccordionDetailsSummary(detailsEl: HTMLDetailsElement): boolean {
  const existing = detailsEl.querySelector(':scope > summary');
  if (existing instanceof HTMLElement) {
    return ensureSummaryMinimumContent(existing);
  }

  const summary = document.createElement('summary');
  summary.textContent = SUMMARY_EDITOR_PLACEHOLDER;
  detailsEl.insertBefore(summary, detailsEl.firstChild);
  return true;
}

function ensureAllAccordionSummaries(editable: HTMLElement): boolean {
  let changed = false;
  editable.querySelectorAll(`details.${TCC_ACCORDION_ITEM_CLASS}, details`).forEach((node) => {
    if (!(node instanceof HTMLDetailsElement)) return;
    if (ensureAccordionDetailsSummary(node)) changed = true;
  });
  return changed;
}

function shouldPreventSummaryDelete(summary: HTMLElement): boolean {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return false;
  const range = selection.getRangeAt(0);
  if (!summary.contains(range.startContainer)) return false;

  if (!range.collapsed) {
    return false;
  }

  return isSummaryEffectivelyEmpty(summary) && isRangeAtSummaryStart(range, summary);
}

function ensureAccordionEditableStructure(editable: HTMLElement): boolean {
  return ensureAllAccordionPanelParagraphs(editable) || ensureAllAccordionSummaries(editable);
}

function ensureAllAccordionPanelParagraphs(editable: HTMLElement): boolean {
  let changed = normalizeAccordionDetailsStructure(editable);
  editable.querySelectorAll(`.${TCC_ACCORDION_PANEL_INNER_CLASS}`).forEach((node) => {
    if (node instanceof HTMLElement && ensurePanelInnerMinimumParagraph(node)) {
      changed = true;
    }
  });
  return changed;
}

function isSummaryInteractionTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest('summary'));
}

function preventSummaryToggle(event: Event) {
  if (!isSummaryInteractionTarget(event.target)) return;
  event.preventDefault();
}

function getSummaryLastTextNode(summary: HTMLElement): Text | null {
  const walker = document.createTreeWalker(summary, NodeFilter.SHOW_TEXT);
  let lastText: Text | null = null;
  let node = walker.nextNode();
  while (node) {
    const textNode = node as Text;
    if (textNode.textContent?.length) lastText = textNode;
    node = walker.nextNode();
  }
  return lastText;
}

function getSummaryTextEndRect(summary: HTMLElement): DOMRect | null {
  const lastText = getSummaryLastTextNode(summary);
  if (!lastText) return null;

  const range = document.createRange();
  range.setStart(lastText, lastText.length);
  range.collapse(true);
  const rects = range.getClientRects();
  if (rects.length > 0) return rects[rects.length - 1] ?? null;
  return range.getBoundingClientRect();
}

function placeCaretAtSummaryEnd(summary: HTMLElement) {
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(summary);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

function fixSummaryEndCaretOnClick(event: MouseEvent) {
  if (!(event.target instanceof Element)) return;
  const summary = event.target.closest('summary');
  if (!summary || !summary.closest('[contenteditable="true"]')) return;

  const endRect = getSummaryTextEndRect(summary);
  if (!endRect) return;

  const summaryRect = summary.getBoundingClientRect();
  const withinSummaryRow =
    event.clientY >= summaryRect.top - 1 && event.clientY <= summaryRect.bottom + 1;
  const clickPastTextEnd = event.clientX > endRect.right + 1;

  if (!withinSummaryRow || !clickPastTextEnd) return;

  placeCaretAtSummaryEnd(summary);
  event.preventDefault();
}

function isEventInsideAccordionDom(dom: HTMLElement, event: Event): boolean {
  const target = event.target;
  return target instanceof Node && dom.contains(target);
}

function createTccAccordionNodeView(
  node: PMNode,
  view: EditorView,
  getPos: () => number | undefined
): NodeView {
  const dom = document.createElement('div');
  applyAccordionDomAttrs(dom, node.attrs.htmlAttrs as Record<string, string> | undefined);
  dom.contentEditable = 'false';

  const content = document.createElement('div');
  content.className = TCC_ACCORDION_EDITABLE_CLASS;
  content.contentEditable = 'true';
  content.innerHTML = normalizeAccordionChildrenHtmlForStorage((node.attrs.childrenHTML as string) ?? '');
  dom.appendChild(content);
  pruneAccordionEditableDom(content);
  migrateLegacyAccordionPanelBlockStyles(content);
  ensureAccordionEditableStructure(content);
  ensureAccordionDetailsOpen(content);

  const syncFromDom = (addToHistory: boolean) => {
    const pos = getPos();
    if (pos == null) return;
    const current = view.state.doc.nodeAt(pos);
    if (!current || !isTccAccordionNode(current)) return;
    pruneAccordionEditableDom(content);
    ensureAccordionEditableStructure(content);
    replaceTccAccordionNode(
      view,
      pos,
      current,
      serializeDirectDetailsHtml(extractDirectDetailsElements(content)),
      addToHistory
    );
  };

  const scheduleEditablePrune = () => {
    requestAnimationFrame(() => {
      ensureAccordionEditableStructure(content);
      pruneAccordionEditableDom(content);
    });
  };

  const onEditableBeforeInput = (event: Event) => {
    if (!(event instanceof InputEvent)) return;

    if (isSelectionInAccordionSummary() && event.inputType === 'insertParagraph') {
      event.preventDefault();
      return;
    }

    if (!event.inputType.startsWith('delete')) return;

    const summary = getSummaryFromSelection();
    if (summary && shouldPreventSummaryDelete(summary)) {
      event.preventDefault();
      ensureSummaryMinimumContent(summary);
      return;
    }

    const panelInner = getPanelInnerFromSelection();
    if (!panelInner) return;
    const onlyParagraph = panelInner.querySelector('p');
    if (!(onlyParagraph instanceof HTMLParagraphElement)) return;
    if (shouldPreventDeletingOnlyPanelParagraph(panelInner, onlyParagraph)) {
      event.preventDefault();
    }
  };

  const onEditableKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Enter') {
      if (isSelectionInAccordionSummary()) {
        event.preventDefault();
      }
      return;
    }

    if (event.key !== 'Backspace' && event.key !== 'Delete') return;

    const summary = getSummaryFromSelection();
    if (summary && shouldPreventSummaryDelete(summary)) {
      event.preventDefault();
      ensureSummaryMinimumContent(summary);
      return;
    }

    const panelInner = getPanelInnerFromSelection();
    if (!panelInner) return;
    const onlyParagraph = panelInner.querySelector('p');
    if (!(onlyParagraph instanceof HTMLParagraphElement)) return;
    if (shouldPreventDeletingOnlyPanelParagraph(panelInner, onlyParagraph)) {
      event.preventDefault();
    }
  };

  const onEditableInput = () => {
    ensureAccordionEditableStructure(content);
    scheduleEditablePrune();
  };

  const onMouseDown = (event: MouseEvent) => {
    event.stopPropagation();
    fixSummaryEndCaretOnClick(event);

    const pos = getPos();
    if (pos == null) return;

    requestAnimationFrame(() => {
      const currentPos = getPos();
      if (currentPos == null) return;
      const { selection } = view.state;
      const node = view.state.doc.nodeAt(currentPos);
      if (!node) return;

      const selectionOnAccordion =
        (selection instanceof NodeSelection && selection.from === currentPos) ||
        (selection.from >= currentPos && selection.to <= currentPos + node.nodeSize);

      if (selectionOnAccordion) return;

      view.dispatch(
        view.state.tr
          .setSelection(NodeSelection.create(view.state.doc, currentPos))
          .setMeta('addToHistory', false)
      );
    });
  };

  const onBlur = (event: FocusEvent) => {
    const related = event.relatedTarget;
    if (related instanceof Node && dom.contains(related)) return;
    syncFromDom(true);
  };

  const onDetailsToggle = (event: Event) => {
    const target = event.target;
    if (target instanceof HTMLDetailsElement && !target.open) {
      target.open = true;
    }
  };

  content.addEventListener('mousedown', onMouseDown, true);
  content.addEventListener('click', preventSummaryToggle, true);
  content.addEventListener('blur', onBlur, true);
  content.addEventListener('beforeinput', onEditableBeforeInput, true);
  content.addEventListener('keydown', onEditableKeyDown, true);
  content.addEventListener('input', onEditableInput, true);
  content.addEventListener('toggle', onDetailsToggle, true);

  return {
    dom,
    ignoreMutation(mutation) {
      // Accordion panels use a nested contenteditable; ignore all DOM mutations there
      // (including selection) so ProseMirror does not call selectionToDOM and scroll back
      // to the last main-document caret while the user is typing inside the accordion.
      if ('target' in mutation && mutation.target instanceof Node && dom.contains(mutation.target)) {
        return true;
      }
      return false;
    },
    stopEvent(event) {
      if (!isEventInsideAccordionDom(dom, event)) return false;

      switch (event.type) {
        case 'mousedown':
        case 'click':
        case 'keydown':
        case 'keypress':
        case 'keyup':
        case 'beforeinput':
        case 'input':
        case 'paste':
        case 'cut':
        case 'compositionstart':
        case 'compositionupdate':
        case 'compositionend':
          return true;
        default:
          return false;
      }
    },
    update(updatedNode) {
      if (!isTccAccordionNode(updatedNode)) return false;
      const nextHtml = normalizeAccordionChildrenHtmlForStorage((updatedNode.attrs.childrenHTML as string) ?? '');
      const currentHtml = normalizeAccordionChildrenHtmlForStorage(content.innerHTML);
      if (nextHtml !== currentHtml) {
        content.innerHTML = nextHtml;
        pruneAccordionEditableDom(content);
        migrateLegacyAccordionPanelBlockStyles(content);
        ensureAccordionEditableStructure(content);
        ensureAccordionDetailsOpen(content);
      }
      return true;
    },
    destroy() {
      syncFromDom(false);
      content.removeEventListener('mousedown', onMouseDown, true);
      content.removeEventListener('click', preventSummaryToggle, true);
      content.removeEventListener('blur', onBlur, true);
      content.removeEventListener('beforeinput', onEditableBeforeInput, true);
      content.removeEventListener('keydown', onEditableKeyDown, true);
      content.removeEventListener('input', onEditableInput, true);
      content.removeEventListener('toggle', onDetailsToggle, true);
    },
  };
}

export function createTccAccordionEditorPlugin() {
  return {
    wysiwygNodeViews: {
      div: (
        node: PMNode,
        view: EditorView,
        getPos: () => number | undefined,
        _eventEmitter: unknown
      ): NodeView | undefined => {
        if (!isTccAccordionNode(node)) return undefined;
        return createTccAccordionNodeView(node, view, getPos);
      },
    },
    wysiwygPlugins: [
      () => keymap({ Backspace: blockSentinelBackspace }),
      () =>
        new Plugin({
          props: {
            handleScrollToSelection() {
              if (isAccordionEditableFocused() || getAccordionSelectionContext()) {
                return true;
              }
              return false;
            },
          },
        }),
      () =>
        new Plugin({
          appendTransaction(transactions, _oldState, newState) {
            if (!transactions.some((tr) => tr.docChanged)) return null;
            return appendTrailingParagraphIfAccordionLast(newState);
          },
        }),
      () =>
        new Plugin({
          props: {
            handleKeyDown(view, event) {
              const { selection } = view.state;
              if (!(selection instanceof NodeSelection) || !isTccAccordionNode(selection.node)) {
                return false;
              }

              const nodeDom = view.nodeDOM(selection.from);
              if (nodeDom instanceof HTMLElement) {
                const editable = getAccordionEditableRoot(nodeDom);
                if (!editable.contains(document.activeElement)) {
                  editable.focus();
                }
              }

              event.preventDefault();
              return true;
            },
          },
        }),
    ],
  };
}
