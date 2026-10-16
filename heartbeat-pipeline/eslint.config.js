import js from '@eslint/js';

export default [
  { ignores: ['node_modules/**', 'coverage/**', 'data/**'] },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: { Buffer: 'readonly', console: 'readonly', fetch: 'readonly', process: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly', performance: 'readonly', URL: 'readonly' } },
    rules: { 'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }] },
  },
];
