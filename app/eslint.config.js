// Lint rules: TypeScript is held to the strict, type-aware set; the JavaScript still to be converted to the recommended one.
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'node_modules/',
      'dist/',
      'dist.next/',
      'dist.previous/',
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
  ...tseslint.configs.strictTypeChecked.map(config => ({ ...config, files: ['**/*.{ts,mts}'] })),
  {
    files: ['**/*.{ts,mts}'],
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    // `({ dropped, ...kept }) => kept` is how a property is left out.
    rules: { '@typescript-eslint/no-unused-vars': ['error', { ignoreRestSiblings: true }] },
  },
);
