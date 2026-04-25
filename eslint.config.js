// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';

export default tseslint.config(
  {
    // dashboard/ is a separate sub-project with its own toolchain (Vite + React).
    // It will get its own ESLint config in a later PR.
    ignores: [
      'dist/**',
      'node_modules/**',
      'coverage/**',
      'dashboard/**',
      '*.config.{js,cjs,mjs}',
      'prettier.config.cjs',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts', 'packages/**/src/**/*.ts', 'apps/**/src/**/*.ts'],
    languageOptions: {
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    rules: {
      // Style consistency — surface intent, not noise.
      '@typescript-eslint/consistent-type-imports': ['warn', { prefer: 'type-imports' }],
      '@typescript-eslint/no-import-type-side-effects': 'warn',

      // Safety — these are the gates we actually care about for a security daemon.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-floating-promises': 'off', // requires type-aware linting; enable in Phase 1
      // After QW10 swept the existing call sites, this rule now blocks
      // any new ones from sneaking in. Empty catches and `.catch(() => {})`
      // hide failures in a security-critical product — never accept them.
      'no-restricted-syntax': [
        'error',
        {
          selector: "CatchClause[param.type='Identifier'] > BlockStatement[body.length=0]",
          message: 'Empty catch blocks swallow errors. Log or rethrow instead.',
        },
        {
          selector:
            "CallExpression[callee.property.name='catch'] > ArrowFunctionExpression[body.type='BlockStatement'][body.body.length=0]",
          message: '`.catch(() => {})` swallows promise rejections. Log or retry instead.',
        },
      ],

      // Unused vars: allow underscore prefix as deliberate ignore.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],

      // Project conventions.
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': 'off', // logger.ts is the central wrapper; raw console is allowed there.
    },
  },
  {
    files: ['tests/**/*.ts', 'scripts/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-restricted-syntax': 'off',
    },
  },
  prettierConfig,
);
