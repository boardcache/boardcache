import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  {
    // Built output: public/viewer is the offline-viewer bundle (build:viewer).
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      '**/node_modules/**',
      'apps/client/public/viewer/**',
      'apps/desktop/release/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{js,cjs,ts,tsx}'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // Plain browser scripts (the boot shim).
    files: ['apps/client/public/*.js'],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    // The version sync the desktop build runs is plain Node ESM.
    files: ['scripts/*.mjs'],
    languageOptions: { globals: globals.node },
  },
  {
    // The Electron shell runs in Node (main) and a CommonJS preload; the
    // build-config helper the desktop build reads is CommonJS too.
    files: ['apps/desktop/*.{js,cjs}', 'apps/desktop/scripts/*.cjs', 'scripts/*.cjs'],
    languageOptions: { sourceType: 'commonjs', globals: { ...globals.node, ...globals.browser } },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Media components write to DOM elements they hold in props and state
      // (currentTime, volume); the rule reads those as mutations of React data.
      'react-hooks/immutability': 'off',
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    // Plugin boundary: core never imports plugin internals — only the
    // registry, the settings store, and the loader.
    files: ['apps/client/src/**/*.{ts,tsx}'],
    ignores: ['apps/client/src/plugins/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '**/plugins/**',
                '!**/plugins/registry',
                '!**/plugins/settingsStore',
                '!**/plugins/index',
              ],
              message:
                'Core must not import plugin internals — only plugins/registry, plugins/settingsStore and the plugins/index loader are public.',
            },
          ],
        },
      ],
    },
  },
  prettier,
);
