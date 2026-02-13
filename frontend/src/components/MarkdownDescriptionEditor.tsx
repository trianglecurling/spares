/**
 * Markdown description editor using ToastUI Editor.
 * WYSIWYG-only (no Markdown tab). Content is stored as Markdown on the backend.
 * Respects light/dark theme.
 */

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import '@toast-ui/editor/dist/toastui-editor.css';
import '@toast-ui/editor/dist/theme/toastui-editor-dark.css';
import { Editor } from '@toast-ui/react-editor';

export interface MarkdownDescriptionEditorRef {
  getMarkdown: () => string;
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
}

/** Workaround for ToastUI bug: empty initialValue shows "Write\nPreview". Pass a space when empty. */
const EMPTY_INITIAL = ' ';

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
    }));

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
      const ro = new ResizeObserver((entries) => {
        const { height } = entries[0]?.contentRect ?? { height: 300 };
        setFillHeight(Math.max(200, height));
      });
      ro.observe(el);
      setFillHeight(el.clientHeight || 300);
      return () => ro.disconnect();
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
          hideModeSwitch
          height={editorHeight}
          useCommandShortcut
          usageStatistics={false}
          toolbarItems={[['bold', 'italic', 'strike'], ['quote'], ['ul'], ['link']]}
        />
      </div>
    );
  }
);

MarkdownDescriptionEditor.displayName = 'MarkdownDescriptionEditor';

export default MarkdownDescriptionEditor;
