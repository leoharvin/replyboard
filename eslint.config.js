import eslintConfigPrettier from 'eslint-config-prettier';
import importX from 'eslint-plugin-import-x';
import tseslint from 'typescript-eslint';

const defaultExportAllowed = [
  'apps/ingest/src/index.ts',
  'apps/web/**/{page,layout,error,not-found,loading,template,default,route,global-error}.tsx',
  'apps/web/**/middleware.ts',
  '**/next.config.{js,ts,mjs,cjs}',
  '**/vitest.config.{js,ts,mjs,cjs}',
  '**/eslint.config.{js,cjs,mjs}',
  '**/tailwind.config.{js,ts,cjs,mjs}',
];

const styleRules = {
  '@typescript-eslint/no-explicit-any': 'error',
  '@typescript-eslint/consistent-type-imports': [
    'error',
    { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
  ],
  '@typescript-eslint/no-non-null-assertion': 'error',
  '@typescript-eslint/consistent-type-assertions': [
    'error',
    { assertionStyle: 'as', objectLiteralTypeAssertions: 'never' },
  ],
  '@typescript-eslint/consistent-type-definitions': ['error', 'interface'],
  '@typescript-eslint/array-type': ['error', { default: 'array-simple' }],
  '@typescript-eslint/naming-convention': [
    'error',
    {
      selector: 'typeLike',
      format: ['PascalCase'],
    },
    {
      selector: 'interface',
      format: ['PascalCase'],
      custom: {
        regex: '^I[A-Z]',
        match: false,
      },
    },
    {
      selector: 'variable',
      modifiers: ['const'],
      format: ['camelCase', 'UPPER_CASE'],
    },
    {
      selector: 'variable',
      format: ['camelCase'],
      leadingUnderscore: 'allow',
    },
    {
      selector: 'parameter',
      format: ['camelCase'],
      leadingUnderscore: 'allow',
    },
    {
      selector: 'function',
      format: ['camelCase'],
    },
    {
      selector: 'method',
      format: ['camelCase'],
    },
    {
      selector: 'property',
      format: ['camelCase'],
      leadingUnderscore: 'allow',
    },
  ],
  '@typescript-eslint/no-namespace': 'error',
  '@typescript-eslint/no-require-imports': 'error',
  '@typescript-eslint/no-unused-vars': [
    'error',
    {
      argsIgnorePattern: '^_',
      varsIgnorePattern: '^_',
    },
  ],
  '@typescript-eslint/only-throw-error': 'error',
  '@typescript-eslint/no-floating-promises': 'error',
  eqeqeq: ['error', 'always', { null: 'ignore' }],
  'no-var': 'error',
  'prefer-const': 'error',
  curly: ['error', 'all'],
  'default-case': 'error',
  'default-case-last': 'error',
  'no-fallthrough': 'error',
  'no-eval': 'error',
  'no-new-wrappers': 'error',
  'guard-for-in': 'error',
  'no-restricted-syntax': [
    'error',
    {
      selector: 'ForInStatement',
      message: 'Use for...of or Object.keys/entries instead of for...in.',
    },
  ],
  'import-x/no-default-export': 'error',
};

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.open-next/**',
      '**/coverage/**',
      'pnpm-lock.yaml',
      'eslint.config.js',
    ],
  },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      ...tseslint.configs.recommended,
      ...tseslint.configs.strictTypeChecked,
      ...tseslint.configs.stylisticTypeChecked,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.eslint.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      'import-x': importX,
    },
    rules: styleRules,
  },
  ...defaultExportAllowed.map((files) => ({
    files: [files],
    rules: {
      'import-x/no-default-export': 'off',
    },
  })),
  eslintConfigPrettier,
  // eslint-config-prettier disables `curly`; re-enable it so braces stay enforced (Section 4.1).
  // 'multi-line' matches the guide, which allows a single-line `if` without braces.
  {
    files: ['**/*.{ts,tsx}'],
    rules: { curly: ['error', 'multi-line'] },
  },
);
