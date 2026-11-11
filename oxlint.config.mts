import { defineConfig } from 'oxlint'

export default defineConfig({
  plugins: ['react', 'typescript', 'unicorn', 'oxc', 'import'],
  ignorePatterns: ['**/*.gen.ts', 'dist'],
  rules: {
    'react/rules-of-hooks': 'error',
    'func-style': ['error', 'expression'],
  },
})
