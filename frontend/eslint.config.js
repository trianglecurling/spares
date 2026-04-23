import js from '@eslint/js';
import typescript from '@typescript-eslint/eslint-plugin';
import typescriptParser from '@typescript-eslint/parser';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';

export default [
  {
    ignores: ['dist/**', 'storybook-static/**'],
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: typescriptParser,
      parserOptions: {
        ecmaVersion: 2020,
        sourceType: 'module',
      },
      globals: {
        ...globals.browser,
        ...globals.es2020,
        React: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': typescript,
      react,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
    rules: {
      ...js.configs.recommended.rules,
      ...typescript.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      ...react.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off',
      'react/jsx-uses-react': 'off',
      // Many effects intentionally omit stable callbacks or use mount-only patterns; enable locally when tightening a flow.
      'react-hooks/exhaustive-deps': 'off',
      // Context and route modules often export hooks alongside providers; splitting only for this rule is low value.
      'react-refresh/only-export-components': 'off',
      // Allow straight quotes and apostrophes in JSX text; still flag `>` and `}`.
      'react/no-unescaped-entities': ['error', { forbid: ['>', '}'] }],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/NotificationModal', '**/NotificationModal.*'],
              message: 'Use useAlert() for routine success and error feedback.',
            },
          ],
        },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'window',
          property: 'confirm',
          message: 'Use useConfirm() from ConfirmContext instead of window.confirm().',
        },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_' },
      ],
    },
  },
];

