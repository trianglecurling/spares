import { chainCommands, lift, splitBlockAs } from 'prosemirror-commands';
import { keydownHandler } from 'prosemirror-keymap';
import type { Node as ProseMirrorNode, ResolvedPos } from 'prosemirror-model';
import { Plugin, TextSelection, EditorState, type Command, type Transaction } from 'prosemirror-state';
import { sinkListItem, liftListItem } from 'prosemirror-schema-list';
import { writeWysiwygInlineAsHtml, repairMarkdownLinksInHtmlContent } from './markdownEditorInlineHtml';

export const TCC_INDENT_ATTR = 'data-tcc-indent';
export const MAX_TCC_INDENT = 8;
export const TCC_INDENT_EM = 1.5;

const BLOCK_QUOTE_NODE = 'blockQuote';

type BlockTarget = {
  blockPos: number;
  type: 'listItem' | 'textblock';
};

/** Structural view type — avoids duplicate `prosemirror-view` installs across PM packages. */
type TccEditorView = {
  composing?: boolean;
  endOfTextblock?: (
    side: 'backward' | 'forward' | 'up' | 'down' | 'left' | 'right',
    state?: EditorState
  ) => boolean;
  dispatch: (transaction: Transaction) => void;
};

type TccEditorViewDispatch = TccEditorView['dispatch'];

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

function isAtBlockTextStartForBackspace(state: EditorState, view?: TccEditorView): boolean {
  const { selection } = state;
  if (!(selection instanceof TextSelection) || !selection.empty) return false;
  const $from = selection.$from;
  if (view?.endOfTextblock ? !view.endOfTextblock('backward', state) : $from.parentOffset > 0) return false;
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

function isInBlockQuote($from: ResolvedPos): boolean {
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if ($from.node(depth).type.name === BLOCK_QUOTE_NODE) return true;
  }
  return false;
}

function collectBlockTargets(doc: ProseMirrorNode, from: number, to: number): BlockTarget[] {
  const targets: BlockTarget[] = [];
  const seen = new Set<number>();

  doc.nodesBetween(from, to, (node, pos, parent) => {
    if (node.type.name === 'listItem') {
      if (!seen.has(pos)) {
        seen.add(pos);
        targets.push({ blockPos: pos, type: 'listItem' });
      }
      return false;
    }
    if (
      (node.type.name === 'paragraph' || node.type.name === 'heading') &&
      parent?.type.name !== 'listItem'
    ) {
      if (!seen.has(pos)) {
        seen.add(pos);
        targets.push({ blockPos: pos, type: 'textblock' });
      }
    }
    return undefined;
  });

  return targets;
}

function createTargetSelection(doc: ProseMirrorNode, target: BlockTarget): TextSelection | null {
  const node = doc.nodeAt(target.blockPos);
  if (!node) return null;
  const innerFrom = target.blockPos + 1;
  const innerTo = target.blockPos + node.nodeSize - 1;
  return TextSelection.create(doc, innerFrom, innerTo);
}

function applyCommandToDoc(
  doc: ProseMirrorNode,
  schema: EditorState['schema'],
  target: BlockTarget,
  command: Command
): ProseMirrorNode | null {
  const selection = createTargetSelection(doc, target);
  if (!selection) return null;
  const tempState = EditorState.create({ doc, schema, selection });
  let nextDoc: ProseMirrorNode | null = null;
  const applied = command(tempState, (tr) => {
    nextDoc = tr.doc;
  });
  return applied ? nextDoc : null;
}

function increaseTccIndentOnBlock(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  const $from = state.selection.$from;
  if (isInTableContext($from)) return false;
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
}

function decreaseTccIndentOnBlock(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  const $from = state.selection.$from;
  if (isInTableContext($from)) return false;
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
}

function canOutdentTarget(
  doc: ProseMirrorNode,
  schema: EditorState['schema'],
  target: BlockTarget
): boolean {
  const selection = createTargetSelection(doc, target);
  if (!selection) return false;
  const tempState = EditorState.create({ doc, schema, selection });
  const $from = selection.$from;

  if (target.type === 'listItem') {
    return liftListItem(schema.nodes.listItem)(tempState, undefined);
  }
  if (isInTableContext($from)) return false;
  if (isInBlockQuote($from)) return lift(tempState, undefined);
  return decreaseTccIndentOnBlock(tempState, undefined);
}

function dispatchDocReplacement(
  state: EditorState,
  dispatch: TccEditorViewDispatch,
  doc: ProseMirrorNode
): void {
  const { from, to } = state.selection;
  const tr = state.tr.replaceWith(0, state.doc.content.size, doc.content);
  const mappedFrom = Math.min(from, tr.doc.content.size);
  const mappedTo = Math.min(to, tr.doc.content.size);
  dispatch(tr.setSelection(TextSelection.create(tr.doc, mappedFrom, mappedTo)).scrollIntoView());
}

function increaseIndentOnAllBlocks(
  state: EditorState,
  dispatch: TccEditorViewDispatch | undefined,
  schema: EditorState['schema']
): boolean {
  const targets = collectBlockTargets(state.doc, state.selection.from, state.selection.to);
  if (targets.length === 0) return false;

  let doc = state.doc;
  let changed = false;

  for (let index = targets.length - 1; index >= 0; index -= 1) {
    const target = targets[index]!;
    const nextDoc =
      target.type === 'listItem'
        ? applyCommandToDoc(doc, schema, target, sinkListItem(schema.nodes.listItem))
        : applyCommandToDoc(doc, schema, target, increaseTccIndentOnBlock);
    if (!nextDoc) continue;
    doc = nextDoc;
    changed = true;
  }

  if (!changed) return false;
  if (dispatch) dispatchDocReplacement(state, dispatch, doc);
  return true;
}

function decreaseIndentOnAllBlocks(
  state: EditorState,
  dispatch: TccEditorViewDispatch | undefined,
  schema: EditorState['schema']
): boolean {
  const targets = collectBlockTargets(state.doc, state.selection.from, state.selection.to);
  if (targets.length === 0) return false;

  let doc = state.doc;
  let changed = false;

  for (let index = targets.length - 1; index >= 0; index -= 1) {
    const target = targets[index]!;
    const selection = createTargetSelection(doc, target);
    if (!selection) continue;
    const $from = selection.$from;

    let nextDoc: ProseMirrorNode | null = null;
    if (target.type === 'listItem') {
      nextDoc = applyCommandToDoc(doc, schema, target, liftListItem(schema.nodes.listItem));
    } else if (isInBlockQuote($from)) {
      nextDoc = applyCommandToDoc(doc, schema, target, lift);
    } else {
      nextDoc = applyCommandToDoc(doc, schema, target, decreaseTccIndentOnBlock);
    }

    if (!nextDoc) continue;
    doc = nextDoc;
    changed = true;
  }

  if (!changed) return false;
  if (dispatch) dispatchDocReplacement(state, dispatch, doc);
  return true;
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

    if (!selection.empty) {
      return increaseIndentOnAllBlocks(state, dispatch, schema);
    }

    const $from = selection.$from;

    if (isInListContext($from)) {
      if (!forceLineStart && !isAtBlockTextStart($from)) return false;
      return sinkListItem(schema.nodes.listItem)(state, dispatch);
    }

    if (isInTableContext($from)) return false;
    if (!forceLineStart && !isAtBlockTextStart($from)) return false;

    return increaseTccIndentOnBlock(state, dispatch);
  };
}

function decreaseIndent(forceLineStart: boolean): Command {
  return (state, dispatch, view) => {
    if (view?.composing) return false;
    const { selection, schema } = state;
    if (!(selection instanceof TextSelection)) return false;

    if (!selection.empty) {
      return decreaseIndentOnAllBlocks(state, dispatch, schema);
    }

    const $from = selection.$from;

    if (isInListContext($from)) {
      if (!forceLineStart && !isAtBlockTextStart($from)) return false;
      return liftListItem(schema.nodes.listItem)(state, dispatch);
    }

    if (isInTableContext($from)) return false;
    if (!forceLineStart && !isAtBlockTextStart($from)) return false;

    if (isInBlockQuote($from)) {
      return lift(state, dispatch);
    }

    return decreaseTccIndentOnBlock(state, dispatch);
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
  const { selection, schema, doc } = state;
  if (!(selection instanceof TextSelection)) return false;

  if (!selection.empty) {
    const targets = collectBlockTargets(doc, selection.from, selection.to);
    return targets.some((target) => canOutdentTarget(doc, schema, target));
  }

  const $from = selection.$from;
  if (isInListContext($from)) {
    return liftListItem(schema.nodes.listItem)(state, undefined);
  }
  if (isInTableContext($from)) return false;
  if (isInBlockQuote($from)) {
    return lift(state, undefined);
  }
  return decreaseTccIndentOnBlock(state, undefined);
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
  const handleBackspace = keydownHandler({
    Backspace: tccListBackspace,
  });
  return new Plugin({
    props: {
      handleKeyDown(view, event) {
        return handleBackspace(view as unknown as Parameters<typeof handleBackspace>[0], event);
      },
    },
  });
}

/** Run list-aware Backspace handling (used by editor capture-phase keydown as well). */
export function runTccListBackspace(
  state: EditorState,
  dispatch: TccEditorViewDispatch,
  view: TccEditorView
): boolean {
  return tccListBackspace(state, dispatch, view as unknown as NonNullable<Parameters<Command>[2]>);
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
        dispatch: TccEditorViewDispatch,
        view: TccEditorView
      ) => increaseIndent(true)(state, dispatch, view as unknown as NonNullable<Parameters<Command>[2]>),
      tccDecreaseIndent: (
        _payload: unknown,
        state: EditorState,
        dispatch: TccEditorViewDispatch,
        view: TccEditorView
      ) => decreaseIndent(true)(state, dispatch, view as unknown as NonNullable<Parameters<Command>[2]>),
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

    const inlineNodes = buildInlineNodesFromHTML(
      schema,
      repairMarkdownLinksInHtmlContent(parsed.innerHtml)
    );
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
  writeWysiwygInlineAsHtml(state, nodeInfo.node);
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
