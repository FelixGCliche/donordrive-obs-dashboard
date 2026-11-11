import { defineConfig } from 'oxfmt'

export default defineConfig({
  ignorePatterns: ['.claude/skills', '.agents/skills', '**/*.gen.ts'],
  semi: false,
  singleQuote: true,
  trailingComma: 'es5',
  printWidth: 100,
  tabWidth: 2,
  useTabs: false,
  sortImports: { internalPattern: ['@assets/', '@components', '@features/', '@hooks', '@routes/'] },
  sortTailwindcss: true,
})
