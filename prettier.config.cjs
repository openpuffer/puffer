/** @type {import('prettier').Config} */
module.exports = {
  printWidth: 100,
  tabWidth: 2,
  useTabs: false,
  semi: true,
  singleQuote: true,
  quoteProps: 'as-needed',
  trailingComma: 'all',
  bracketSpacing: true,
  arrowParens: 'always',
  endOfLine: 'lf',
  overrides: [
    {
      files: ['*.yaml', '*.yml'],
      options: { singleQuote: false, tabWidth: 2 },
    },
    {
      files: ['*.md'],
      options: { proseWrap: 'preserve' },
    },
  ],
};
