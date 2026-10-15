// Lint rules: TypeScript is held to the strict, type-aware set; the JavaScript still to be converted to the recommended one.
import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'node_modules/',
      'dist/',
      'dist.next/',
      'dist.previous/',
      'dist.lock/',
      'test-results/',
      'playwright-report/',
      'src/fonts/',
    ],
  },
  { files: ['**/*.{mjs,cjs,js}'], ...js.configs.recommended, languageOptions: { globals: globals.node } },
  // An empty catch is this code's way of saying "absent or unreadable is fine"; control characters in a pattern strip terminal colours.
  {
    files: ['**/*.{mjs,cjs,js}'],
    rules: {
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-control-regex': 'off',
      'no-unused-vars': ['error', { ignoreRestSiblings: true, caughtErrors: 'none', argsIgnorePattern: '^_' }],
    },
  },
  ...tseslint.configs.strictTypeChecked.map(config => ({ ...config, files: ['**/*.{ts,mts,svelte}'] })),
  // The new canvas: Svelte components, held to the same TypeScript rules, and the page's own globals.
  ...svelte.configs.recommended,
  {
    files: ['canvas/**/*.svelte', 'canvas/**/*.svelte.ts'],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { parser: tseslint.parser, extraFileExtensions: ['.svelte'] },
    },
  },
  { files: ['canvas/**/*.ts'], languageOptions: { globals: globals.browser } },
  {
    files: ['**/*.{ts,mts,svelte}'],
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    // `({ dropped, ...kept }) => kept` is how a property is left out.
    rules: { '@typescript-eslint/no-unused-vars': ['error', { ignoreRestSiblings: true }] },
  },
  // A test feeds made-up and half-shaped data to the code and reads the result as it comes.
  {
    files: ['**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/restrict-template-expressions': 'off',
      // A stand-in is async because the real thing is, with nothing of its own to wait for.
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-confusing-void-expression': 'off',
    },
  },
);
