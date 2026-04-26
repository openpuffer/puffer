import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  // Resolve `@puffer/*` imports through the workspace's tsconfig.json
  // `paths` map so tests run against TypeScript source — independent of
  // whether each package's `dist/` has been built. Production runtime
  // uses the compiled `main` from each package.json.
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['packages/**/src/**/*.ts', 'apps/**/src/**/*.ts'],
    },
  },
});
