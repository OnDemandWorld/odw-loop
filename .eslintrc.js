module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint', 'import'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'prettier',
  ],
  settings: {
    'import/resolver': {
      node: true,
    },
  },
  ignorePatterns: [
    'node_modules',
    'dist',
    'build',
    'reference',
    'coverage',
    '*.js',
    '*.cjs',
    '*.mjs',
    '*.config.ts',
    '*.config.js',
  ],
  rules: {
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
    ],
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/consistent-type-imports': 'warn',
    'import/order': ['warn', { 'newlines-between': 'always' }],
  },
  overrides: [
    {
      // Test files legitimately use `any` for partial mock stores, private-member
      // assertions and dynamic response bodies. Keep it visible as a warning
      // rather than a gate-blocking error; production src/ stays strict.
      files: ['tests/**/*.ts', 'tests/**/*.tsx'],
      rules: {
        '@typescript-eslint/no-explicit-any': 'warn',
      },
    },
  ],
  settings: {
    'import/resolver': {
      typescript: true,
    },
  },
};
