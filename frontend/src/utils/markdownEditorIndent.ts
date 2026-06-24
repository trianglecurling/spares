import { chainCommands, splitBlockAs } from 'prosemirror-commands';
import { keydownHandler } from 'prosemirror-keymap';
import type { Node as ProseMirrorNode, ResolvedPos } from 'prosemirror-model';
import { Plugin, TextSelection, type Command, type EditorState, type Transaction } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { sinkListItem, liftListItem } from 'prosemirror-schema-list';

export const TCC_INDENT_ATTR = 'data-tcc-indent';
export const MAX_TCC_INDENT = 8;
export const TCC_INDENT_EM = 1.5;

type BlockAttrs = Record<string, unknown> & {
  htmlAttrs?: Record<string, string> | null;
  classNames?: string[] | null;
  level?: number;
};

export function getTccIndent(node: { attrs?: BlockAttrs | null } | null | undefined): number {
  const raw = node?.attrs?.htmlAttrs?.[TCC_INDENT_ATTR];
  const parsed = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function setTccIndentInAttrs(attrs: BlockAttrs, level: number): BlockAttrs {
  const htmlAttrs = { ...(attrs.htmlAttrs ?? {}) };
  if (level <= 0) {
    delete htmlAttrs[TCC_INDENT_ATTR];
  } else {
    htmlAttrs[TCC_INDENT_ATTR] = String(level);
  }
  return {
    ...attrs,
    htmlAttrs: Object.keys(htmlAttrs).length > 0 ? htmlAttrs : null,
  };
}

export function cloneBlockAttrs(attrs: BlockAttrs | null | undefined): BlockAttrs {
  if (!attrs) return {};
  const classNames = attrs.classNames;
  return {
    ...attrs,
    classNames: Array.isArray(classNames) ? [...classNames] : classNames,
    htmlAttrs: attrs.htmlAttrs ? { ...attrs.htmlAttrs } : attrs.htmlAttrs,
  };
}

export function isAtBlockTextStart($from: ResolvedPos): boolean {
  return $from.parentOffset === 0;
}

function isAtBlockTextStartForBackspace(state: EditorState, view?: EditorView): boolean {
  const { selection } = state;
  if (!(selection instanceof TextSelection) || !selection.empty) return false;
  const $from = selection.$from;
  if (view ? !view.endOfTextblock('backward', state) : $from.parentOffset > 0) return false;
  return true;
}

function isEffectivelyEmptyTextblock($from: ResolvedPos): boolean {
  const parent = $from.parent;
  if (!parent.isTextblock) return false;
  return parent.content.size === 0 || parent.textContent.length === 0;
}

/** Same cut resolution as prosemirror-commands joinBackward. */
function findCutBefore($pos: ResolvedPos): ResolvedPos | null {
  if (!$pos.parent.type.spec.isolating) {
    for (let i = $pos.depth - 1; i >= 0; i -= 1) {
      if ($pos.index(i) > 0) return $pos.doc.resolve($pos.before(i + 1));
      if ($pos.node(i).type.spec.isolating) break;
    }
  }
  return null;
}

export function isInListContext($from: ResolvedPos): boolean {
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if ($from.node(depth).type.name === 'listItem') return true;
  }
  return false;
}

function isListNodeName(name: string): boolean {
  return name === 'bulletList' || name === 'orderedList';
}

function findListItemDepth($from: ResolvedPos): number | null {
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if ($from.node(depth).type.name === 'listItem') return depth;
  }
  return null;
}

/** Trailing empty list item created by Enter at the end of a list. */
function isTrailingEmptyListItem($from: ResolvedPos): boolean {
  if (!isInListContext($from) || !isEffectivelyEmptyTextblock($from)) return false;
  if (!isAtBlockTextStart($from)) return false;
  const listItemDepth = findListItemDepth($from);
  if (listItemDepth == null) return false;
  const listDepth = listItemDepth - 1;
  const list = $from.node(listDepth);
  if (!isListNodeName(list.type.name)) return false;
  return $from.index(listDepth) === list.childCount - 1;
}

function getListEndTextPosition(doc: ProseMirrorNode, listStart: number): number | null {
  const listNode = doc.nodeAt(listStart);
  if (!listNode || !isListNodeName(listNode.type.name)) return null;
  const endPos = listStart + listNode.nodeSize - 1;
  const $pos = doc.resolve(endPos);
  if ($pos.parent.isTextblock) return endPos;
  return TextSelection.near($pos, -1).from;
}

function isInTableContext($from: ResolvedPos): boolean {
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const name = $from.node(depth).type.name;
    if (name === 'tableHeadCell' || name === 'tableBodyCell') return true;
  }
  return false;
}

export function findIndentableBlockDepth($from: ResolvedPos): number | null {
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const name = $from.node(depth).type.name;
    if (name === 'paragraph' || name === 'heading') return depth;
  }
  return null;
}

function blockHasPreservedSplitAttrs(node: ProseMirrorNode, hasBlockStyle: (classNames: string[] | null | undefined) => boolean): boolean {
  if (node.type.name === 'paragraph') {
    return Boolean(hasBlockStyle(node.attrs?.classNames as string[] | null | undefined)) || getTccIndent(node) > 0;
  }
  if (node.type.name === 'heading') {
    return getTccIndent(node) > 0;
  }
  return false;
}

export function createTccPreservingBlockSplit(
  hasBlockStyle: (classNames: string[] | null | undefined) => boolean
): Command {
  return splitBlockAs((node) => {
    if (!blockHasPreservedSplitAttrs(node, hasBlockStyle)) return null;
    return {
      type: node.type,
      attrs: cloneBlockAttrs(node.attrs as BlockAttrs),
    };
  });
}

function increaseIndent(forceLineStart: boolean): Command {
  return (state, dispatch, view) => {
    if (view?.composing) return false;
    const { selection, schema } = state;
    if (!(selection instanceof TextSelection)) return false;
    const $from = selection.$from;

    if (isInListContext($from)) {
      if (!forceLineStart && !isAtBlockTextStart($from)) return false;
      return sinkListItem(schema.nodes.listItem)(state, dispatch);
    }

    if (isInTableContext($from)) return false;
    if (!forceLineStart && !isAtBlockTextStart($from)) return false;

    const depth = findIndentableBlockDepth($from);
    if (depth == null) return false;
    const block = $from.node(depth);
    const indent = getTccIndent(block);
    if (indent >= MAX_TCC_INDENT) return false;
    if (!dispatch) return true;
    const pos = $from.before(depth);
    dispatch(
      state.tr
        .setNodeMarkup(pos, undefined, setTccIndentInAttrs(block.attrs as BlockAttrs, indent + 1))
        .scrollIntoView()
    );
    return true;
  };
}

function decreaseIndent(forceLineStart: boolean): Command {
  return (state, dispatch, view) => {
    if (view?.composing) return false;
    const { selection, schema } = state;
    if (!(selection instanceof TextSelection)) return false;
    const $from = selection.$from;

    if (isInListContext($from)) {
      if (!forceLineStart && !isAtBlockTextStart($from)) return false;
      return liftListItem(schema.nodes.listItem)(state, dispatch);
    }

    if (isInTableContext($from)) return false;
    if (!forceLineStart && !isAtBlockTextStart($from)) return false;

    const depth = findIndentableBlockDepth($from);
    if (depth == null) return false;
    const block = $from.node(depth);
    const indent = getTccIndent(block);
    if (indent <= 0) return false;
    if (!dispatch) return true;
    const pos = $from.before(depth);
    dispatch(
      state.tr
        .setNodeMarkup(pos, undefined, setTccIndentInAttrs(block.attrs as BlockAttrs, indent - 1))
        .scrollIntoView()
    );
    return true;
  };
}

function emptyIndentedBlockEnter(): Command {
  return (state, dispatch, view) => {
    if (view?.composing) return false;
    const selection = state.selection;
    if (!(selection instanceof TextSelection) || !selection.empty) return false;

    const $from = selection.$from;
    const depth = findIndentableBlockDepth($from);
    if (depth == null) return false;

    const block = $from.node(depth);
    if (block.content.size > 0) return false;

    const indent = getTccIndent(block);
    if (indent <= 0) return false;

    if (!dispatch) return true;
    const pos = $from.before(depth);
    dispatch(
      state.tr
        .setNodeMarkup(pos, undefined, setTccIndentInAttrs(block.attrs as BlockAttrs, 0))
        .scrollIntoView()
    );
    return true;
  };
}

export function canTccOutdent(state: EditorState): boolean {
  const $from = state.selection.$from;
  if (isInListContext($from)) {
    return liftListItem(state.schema.nodes.listItem)(state, undefined);
  }
  const depth = findIndentableBlockDepth($from);
  if (depth == null) return false;
  return getTccIndent($from.node(depth)) > 0;
}

function backspaceExitTrailingEmptyListItem(): Command {
  return (state, dispatch, view) => {
    if (view?.composing) return false;
    const { selection, schema } = state;
    if (!(selection instanceof TextSelection) || !selection.empty) return false;
    const $from = selection.$from;
    if (!isTrailingEmptyListItem($from)) return false;

    const listItemDepth = findListItemDepth($from);
    if (listItemDepth == null) return false;
    const listDepth = listItemDepth - 1;
    const listStart = $from.before(listDepth);
    const listNode = $from.node(listDepth);
    const listItemStart = $from.before(listItemDepth);
    const listItemNode = $from.node(listItemDepth);
    const paragraphType = schema.nodes.paragraph;
    if (!paragraphType) return false;

    if (!dispatch) return true;
    const insertPos = listStart + listNode.nodeSize - listItemNode.nodeSize;
    const tr = state.tr.delete(listItemStart, listItemStart + listItemNode.nodeSize);
    tr.insert(insertPos, paragraphType.create(null, []));
    dispatch(tr.setSelection(TextSelection.create(tr.doc, insertPos + 1)).scrollIntoView());
    return true;
  };
}

function backspaceJoinListFromFollowingParagraph(): Command {
  return (state, dispatch, view) => {
    if (view?.composing) return false;
    if (!isAtBlockTextStartForBackspace(state, view)) return false;

    const $from = state.selection.$from;
    if (isInListContext($from)) return false;

    const $cut = findCutBefore($from);
    if (!$cut) return false;

    const listNode = $cut.nodeBefore;
    const afterBlock = $cut.nodeAfter;
    if (!listNode || !afterBlock || !isListNodeName(listNode.type.name)) return false;
    if (!afterBlock.isTextblock || !isEffectivelyEmptyTextblock($from)) return false;

    const listStart = $cut.pos - listNode.nodeSize;
    const targetPos = getListEndTextPosition(state.doc, listStart);
    if (targetPos == null) return false;

    if (!dispatch) return true;
    const blockStart = $from.before($from.depth);
    const tr = state.tr.delete(blockStart, blockStart + $from.parent.nodeSize);
    dispatch(tr.setSelection(TextSelection.create(tr.doc, targetPos)).scrollIntoView());
    return true;
  };
}

function backspaceOutdent(): Command {
  return (state, dispatch, view) => {
    if (view?.composing) return false;
    if (!isAtBlockTextStartForBackspace(state, view)) return false;
    const $from = state.selection.$from;
    if (isInListContext($from)) return false;
    return decreaseIndent(false)(state, dispatch, view);
  };
}

const tccListBackspace = chainCommands(
  backspaceJoinListFromFollowingParagraph(),
  backspaceExitTrailingEmptyListItem(),
  backspaceOutdent()
);

function createTccListBackspacePlugin(): Plugin {
  return new Plugin({
    props: {
      handleKeyDown: keydownHandler({
        Backspace: tccListBackspace,
      }),
    },
  });
}

/** Run list-aware Backspace handling (used by editor capture-phase keydown as well). */
export function runTccListBackspace(
  state: EditorState,
  dispatch: EditorView['dispatch'],
  view: EditorView
): boolean {
  return tccListBackspace(state, dispatch, view);
}

function indentedBlockContinueEnter(
  preservingBlockSplit: Command,
  hasBlockStyle: (classNames: string[] | null | undefined) => boolean
): Command {
  return (state, dispatch, view) => {
    if (view?.composing) return false;
    const selection = state.selection;
    if (!(selection instanceof TextSelection) || !selection.empty) return false;

    const $from = selection.$from;
    const depth = findIndentableBlockDepth($from);
    if (depth == null) return false;

    const block = $from.node(depth);
    if (block.content.size === 0) return false;

    const hasStyle =
      block.type.name === 'paragraph' &&
      hasBlockStyle(block.attrs?.classNames as string[] | null | undefined);
    const indent = getTccIndent(block);

    if (hasStyle || indent <= 0) return false;

    const atEnd = $from.parent === block && $from.parentOffset === block.content.size;
    if (atEnd) {
      if (!dispatch) return true;
      const blockType = state.schema.nodes[block.type.name];
      if (!blockType) return false;
      const insertPos = $from.after(depth);
      const newBlock = blockType.create(cloneBlockAttrs(block.attrs as BlockAttrs), []);
      const tr = state.tr.insert(insertPos, newBlock);
      const innerStart = insertPos + 1;
      dispatch(tr.setSelection(TextSelection.create(tr.doc, innerStart)).scrollIntoView());
      return true;
    }

    return preservingBlockSplit(state, dispatch);
  };
}

export function createTccIndentPlugin(
  context: {
    pmKeymap: { keymap: (bindings: Record<string, Command>) => Plugin };
  },
  options: {
    preservingBlockSplit: Command;
    hasBlockStyle: (classNames: string[] | null | undefined) => boolean;
  }
) {
  const { preservingBlockSplit, hasBlockStyle } = options;

  return {
    wysiwygPlugins: [
      () => createTccListBackspacePlugin(),
      () =>
        context.pmKeymap.keymap({
          Enter: chainCommands(
            emptyIndentedBlockEnter(),
            indentedBlockContinueEnter(preservingBlockSplit, hasBlockStyle)
          ),
          Tab: increaseIndent(false),
          'Shift-Tab': decreaseIndent(false),
        }),
    ],
    wysiwygCommands: {
      tccIncreaseIndent: (
        _payload: unknown,
        state: EditorState,
        dispatch: EditorView['dispatch'],
        view: EditorView
      ) => increaseIndent(true)(state, dispatch, view),
      tccDecreaseIndent: (
        _payload: unknown,
        state: EditorState,
        dispatch: EditorView['dispatch'],
        view: EditorView
      ) => decreaseIndent(true)(state, dispatch, view),
    },
  };
}

const INDENTED_BLOCK_TAG_RE = /^(p|h[1-6])$/i;

function parseIndentedBlockFromHtml(html: string): { tag: string; indent: number; innerHtml: string } | null {
  const container = document.createElement('div');
  container.innerHTML = html.trim();
  const el = container.firstElementChild;
  if (!el || container.childElementCount !== 1) return null;
  if (!INDENTED_BLOCK_TAG_RE.test(el.tagName)) return null;
  const indent = Number.parseInt(el.getAttribute(TCC_INDENT_ATTR) ?? '', 10);
  if (!Number.isFinite(indent) || indent <= 0) return null;
  return {
    tag: el.tagName.toLowerCase(),
    indent,
    innerHtml: el.innerHTML,
  };
}

export function normalizeIndentedHtmlBlocks(
  view: {
    state: EditorState;
    dispatch: (tr: Transaction) => void;
  },
  buildInlineNodesFromHTML: (schema: EditorState['schema'], html: string) => unknown[]
) {
  const { doc, schema } = view.state;
  let tr = view.state.tr;
  const replacements: Array<{ from: number; to: number; node: ProseMirrorNode }> = [];

  doc.nodesBetween(0, doc.content.size, (node, pos) => {
    if (!node.attrs?.htmlBlock) return undefined;
    const className = node.attrs?.htmlAttrs?.class;
    if (className) return false;

    const parsed = parseIndentedBlockFromHtml(node.attrs.childrenHTML ?? '');
    if (!parsed) return false;

    const inlineNodes = buildInlineNodesFromHTML(schema, parsed.innerHtml);
    const attrs = setTccIndentInAttrs(
      { htmlAttrs: null, classNames: null },
      parsed.indent
    );

    if (parsed.tag === 'p') {
      const paragraph = schema.nodes.paragraph?.create?.(
        attrs,
        inlineNodes.length ? (inlineNodes as ProseMirrorNode[]) : undefined
      );
      if (paragraph) replacements.push({ from: pos, to: pos + node.nodeSize, node: paragraph });
    } else {
      const level = Number.parseInt(parsed.tag.slice(1), 10);
      const headingType = schema.nodes.heading;
      if (headingType && Number.isFinite(level)) {
        const heading = headingType.create(
          { ...attrs, level },
          inlineNodes.length ? (inlineNodes as ProseMirrorNode[]) : undefined
        );
        replacements.push({ from: pos, to: pos + node.nodeSize, node: heading });
      }
    }
    return false;
  });

  for (const replacement of replacements.reverse()) {
    tr = tr.replaceRangeWith(replacement.from, replacement.to, replacement.node);
  }

  if (replacements.length) {
    view.dispatch(tr.setMeta('addToHistory', false).scrollIntoView());
  }
}

type MdConvertorState = {
  write: (text: string) => void;
  convertInline: (node: unknown) => void;
  closeBlock: (node: unknown) => void;
};

type MdNodeInfo = {
  node: {
    attrs?: BlockAttrs;
    type?: { name?: string };
  };
};

export function writeIndentedBlockMarkdown(
  state: MdConvertorState,
  nodeInfo: MdNodeInfo,
  tagName: 'p' | `h${number}`
) {
  const indent = getTccIndent(nodeInfo.node);
  if (indent <= 0) return false;
  state.write(`<${tagName} ${TCC_INDENT_ATTR}="${indent}">`);
  state.convertInline(nodeInfo.node);
  state.write(`</${tagName}>`);
  state.closeBlock(nodeInfo.node);
  return true;
}

export function getTccIndentCssRules(scope: string): string {
  const blockStyleClasses = [
    'tcc-style-info-box',
    'tcc-style-critical-box',
    'tcc-style-callout',
    'tcc-style-aside',
  ];
  const rules: string[] = [];
  for (let level = 1; level <= MAX_TCC_INDENT; level += 1) {
    const offset = `${level * TCC_INDENT_EM}em`;
    rules.push(
      `${scope} [${TCC_INDENT_ATTR}="${level}"] { margin-inline-start: ${offset} !important; }`
    );
    for (const blockClass of blockStyleClasses) {
      rules.push(
        `${scope} p.${blockClass}[${TCC_INDENT_ATTR}="${level}"] { margin-inline-start: ${offset} !important; }`
      );
    }
  }
  return rules.join('\n');
}
