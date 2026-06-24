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
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/consistent-type-imports': 'warn',
    'import/order': ['warn', { 'newlines-between': 'always' }],
  },
  settings: {
    'import/resolver': {
      typescript: true,
    },
  },
};
