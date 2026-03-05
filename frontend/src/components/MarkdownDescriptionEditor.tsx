/**
 * Markdown description editor using ToastUI Editor.
 * WYSIWYG-only (no Markdown tab). Content is stored as Markdown on the backend.
 * Respects light/dark theme.
 */

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import '@toast-ui/editor/dist/toastui-editor.css';
import '@toast-ui/editor/dist/theme/toastui-editor-dark.css';
import { Editor } from '@toast-ui/react-editor';

/** Read-more marker: asterism (⁂) for snippet cutoff. */
export const READ_MORE_MARKER = '⁂';

export interface MarkdownDescriptionEditorRef {
  getMarkdown: () => string;
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
}

/** Workaround for ToastUI bug: empty initialValue shows "Write\nPreview". Pass a space when empty. */
const EMPTY_INITIAL = ' ';

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
    },
    ref
  ) => {
    const editorRef = useRef<Editor>(null);
    const wrapperRef = useRef<HTMLDivElement>(null);
    const [fillHeight, setFillHeight] = useState<number>(300);

    useImperativeHandle(ref, () => ({
      getMarkdown: () => {
        const instance = editorRef.current?.getInstance?.();
        const md = instance?.getMarkdown?.() ?? '';
        return md.trim();
      },
      insertText: (text: string) => {
        const instance = editorRef.current?.getInstance?.();
        instance?.insertText?.(text);
      },
    }));

    const handleEditorLoad = () => {
      setTimeout(() => {
        const instance = editorRef.current?.getInstance?.();
        if (!instance?.insertToolbarItem) return;

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

        const unlinkBtn = document.createElement('button');
        unlinkBtn.type = 'button';
        unlinkBtn.className = 'toastui-editor-toolbar-icons';
        unlinkBtn.style.cssText = 'width:28px;height:28px;font-size:11px;line-height:1;';
        unlinkBtn.title = 'Remove link';
        unlinkBtn.textContent = 'Unlink';
        unlinkBtn.addEventListener('click', () => {
          try {
            if (!instance.isWysiwygMode?.()) return;
            const ww = instance.wwEditor;
            const view = ww?.view;
            if (!view?.state?.schema?.marks?.link) return;
            const { doc, selection, schema } = view.state;
            const linkMark = schema.marks.link;
            const { from, to } = selection;

            const hasLinkAt = (pos: number) =>
              doc.resolve(pos).marks().some((m: { type: { name: string } }) => m.type === linkMark);

            const hasLink =
              hasLinkAt(from) ||
              (to > from && hasLinkAt(to - 1)) ||
              doc.rangeHasMark(from, to, linkMark);

            if (!hasLink) return;

            let linkFrom = from;
            let linkTo = to;
            for (let pos = from - 1; pos >= 0; pos--) {
              if (!hasLinkAt(pos)) {
                linkFrom = pos + 1;
                break;
              }
              linkFrom = pos;
            }
            for (let pos = to; pos < doc.content.size; pos++) {
              if (!hasLinkAt(pos)) {
                linkTo = pos;
                break;
              }
              linkTo = pos + 1;
            }

            instance.setSelection?.(linkFrom, linkTo);
            instance.exec?.('toggleLink');
          } catch {
            /* ignore */
          }
        });
        try {
          instance.insertToolbarItem({ groupIndex: 3, itemIndex: 2 }, {
            name: 'unlink',
            tooltip: 'Remove link',
            el: unlinkBtn,
          });
        } catch {
          /* ignore */
        }
      }, 0);
    };

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
        className={`markdown-description-editor ${fill ? 'flex-1 min-h-0 flex flex-col' : ''} ${className}`}
      >
        <style>{`
          .markdown-description-editor .toastui-editor-defaultUI .ProseMirror {
            height: 100% !important;
            overflow-y: auto;
            scrollbar-gutter: stable;
          }
          .markdown-description-editor .toastui-editor-dark .ProseMirror,
          .markdown-description-editor .toastui-editor-dark .toastui-editor-ww-container {
            background-color: #374151 !important;
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
        `}</style>
        <Editor
          ref={editorRef}
          initialValue={initialValue.trim() === '' ? EMPTY_INITIAL : initialValue}
          placeholder={placeholder}
          initialEditType="wysiwyg"
          height={editorHeight}
          useCommandShortcut
          usageStatistics={false}
          onLoad={handleEditorLoad}
          plugins={[linkEditPlugin]}
          toolbarItems={[
            ['heading', 'bold', 'italic', 'strike'],
            ['hr', 'quote'],
            ['ul', 'ol'],
            ['link'],
          ]}
        />
      </div>
    );
  }
);

MarkdownDescriptionEditor.displayName = 'MarkdownDescriptionEditor';

export default MarkdownDescriptionEditor;
