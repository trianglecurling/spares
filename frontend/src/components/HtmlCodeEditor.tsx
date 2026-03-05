/**
 * HTML/CSS/JavaScript code editor using Monaco.
 * Tabbed interface with syntax highlighting, indentation, and full editor features.
 */

import { forwardRef, useCallback, useImperativeHandle, useRef, useState } from 'react';
import Editor from '@monaco-editor/react';
import type { editor } from 'monaco-editor';

export interface HtmlCodeEditorValue {
  html: string;
  css: string;
  js: string;
}

export interface HtmlCodeEditorRef {
  getValue: () => HtmlCodeEditorValue;
}

interface HtmlCodeEditorProps {
  initialValue?: HtmlCodeEditorValue | string;
  dark?: boolean;
  fill?: boolean;
  className?: string;
}

const DEFAULT_VALUE: HtmlCodeEditorValue = {
  html: '<div class="content">\n  <h2>Your content here</h2>\n  <p>Edit HTML, CSS, and JavaScript in the tabs above.</p>\n</div>',
  css: '.content {\n  max-width: 42rem;\n  margin: 0 auto;\n}\n',
  js: '// Optional JavaScript\n',
};

function parseInitial(initialValue?: HtmlCodeEditorValue | string): HtmlCodeEditorValue {
  if (!initialValue) return { ...DEFAULT_VALUE };
  if (typeof initialValue === 'object') return { ...DEFAULT_VALUE, ...initialValue };
  try {
    const parsed = JSON.parse(initialValue) as Partial<HtmlCodeEditorValue>;
    return { ...DEFAULT_VALUE, ...parsed };
  } catch {
    return { ...DEFAULT_VALUE, html: initialValue };
  }
}

const HtmlCodeEditor = forwardRef<HtmlCodeEditorRef, HtmlCodeEditorProps>(
  ({ initialValue, dark = false, fill = false, className = '' }, ref) => {
    const parsed = parseInitial(initialValue);
    const [activeTab, setActiveTab] = useState<'html' | 'css' | 'js'>('html');
    const [values, setValues] = useState<HtmlCodeEditorValue>(parsed);
    const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);

    const handleEditorDidMount = useCallback((editor: editor.IStandaloneCodeEditor) => {
      editorRef.current = editor;
    }, []);

    const handleChange = useCallback(
      (tab: 'html' | 'css' | 'js') => (value: string | undefined) => {
        setValues((prev) => ({ ...prev, [tab]: value ?? '' }));
      },
      []
    );

    useImperativeHandle(
      ref,
      () => ({
        getValue: () => ({ ...values }),
      }),
      [values]
    );

    const theme = dark ? 'vs-dark' : 'light';

    return (
      <div
        className={`flex flex-col overflow-hidden ${fill ? 'flex-1 min-h-0' : ''} ${className}`}
      >
        <div className="flex border-b border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-800/50">
          {(['html', 'css', 'js'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 text-sm font-medium uppercase tracking-wide transition-colors ${
                activeTab === tab
                  ? 'border-b-2 border-primary-teal text-primary-teal bg-white dark:bg-gray-800'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
        <div className={`flex-1 min-h-[300px] ${fill ? 'min-h-0' : ''}`}>
          <Editor
            height="100%"
            language={activeTab}
            value={values[activeTab]}
            onChange={handleChange(activeTab)}
            onMount={handleEditorDidMount}
            theme={theme}
            options={{
              minimap: { enabled: false },
              fontSize: 13,
              lineNumbers: 'on',
              scrollBeyondLastLine: false,
              wordWrap: 'on',
              tabSize: 2,
              insertSpaces: true,
              automaticLayout: true,
              padding: { top: 8 },
            }}
            loading={
              <div className="flex items-center justify-center h-full text-gray-500">
                Loading editor...
              </div>
            }
          />
        </div>
      </div>
    );
  }
);

HtmlCodeEditor.displayName = 'HtmlCodeEditor';

export default HtmlCodeEditor;
