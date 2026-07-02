import { Plugin } from 'prosemirror-state';

/** Structural view type — avoids duplicate `prosemirror-view` installs across PM packages. */
type TccEditorView = {
  composing?: boolean;
  pasteText: (text: string, event?: ClipboardEvent) => boolean;
};

const plainTextPasteViews = new WeakSet<TccEditorView>();

function getClipboardPlainText(clipboardData: DataTransfer): string {
  const plain = clipboardData.getData('text/plain') || clipboardData.getData('Text');
  if (plain) return plain;

  const uriList = clipboardData.getData('text/uri-list');
  if (uriList) return uriList.replace(/\r?\n/g, ' ');

  const html = clipboardData.getData('text/html');
  if (!html) return '';

  const container = document.createElement('div');
  container.innerHTML = html;
  return container.textContent ?? '';
}

function clipboardHasImageFile(clipboardData: DataTransfer): boolean {
  const items = clipboardData.items;
  if (!items?.length) return false;
  return Array.from(items).some((item) => item.kind === 'file' && item.type.startsWith('image/'));
}

function createPlainTextPastePlugin(): Plugin {
  return new Plugin({
    props: {
      handlePaste(view, event) {
        const editorView = view as unknown as TccEditorView;
        if (plainTextPasteViews.has(editorView) || editorView.composing) return false;

        const clipboardData = event.clipboardData;
        if (!clipboardData) return false;

        // Image paste is handled separately by Toast UI's addImageBlobHook.
        if (clipboardHasImageFile(clipboardData)) return false;

        const text = getClipboardPlainText(clipboardData);
        const hasHtml = Boolean(clipboardData.getData('text/html'));
        if (!text && !hasHtml) return false;

        plainTextPasteViews.add(editorView);
        try {
          return editorView.pasteText(text, event);
        } finally {
          plainTextPasteViews.delete(editorView);
        }
      },
    },
  });
}

export function createTccPlainTextPastePlugin() {
  return {
    wysiwygPlugins: [() => createPlainTextPastePlugin()],
  };
}
