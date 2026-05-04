import { defineConfig } from 'tsup';
import { chmod } from 'node:fs/promises';

export default defineConfig({
  entry: ['apps/cli/src/index.ts'],
  outDir: 'dist',
  format: ['esm'],
  target: 'node18',
  platform: 'node',
  // Inject createRequire so bundled CJS packages (commander, express, etc.)
  // can call require('events') and other Node built-ins when running as ESM.
  // The source shebang (#!/usr/bin/env node) is preserved by tsup automatically.
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
  // Inline ALL @puffer/* workspace packages plus their npm runtime deps.
  // The bundle must be self-contained: `node dist/index.js --version` must
  // work with no node_modules present (bare tarball, `npm install -g` prefix).
  //
  // React and its ecosystem are the only exceptions — they are never imported
  // by the CLI/daemon at startup and would bloat the bundle unnecessarily.
  noExternal: [
    /^@puffer\//,
    // Core runtime deps (statically imported at module load via @puffer/core)
    'chalk',
    'commander',
    'cors',
    'express',
    'http-proxy',
    'minimatch',
    'uuid',
    'ws',
    'yaml',
    'zod',
    'zod-validation-error',
    // Observability (statically imported via @puffer/observability → @puffer/engine, @puffer/score, @puffer/discovery)
    'prom-client',
    '@opentelemetry/api',
    '@opentelemetry/exporter-trace-otlp-http',
    '@opentelemetry/resources',
    '@opentelemetry/sdk-node',
    '@opentelemetry/sdk-trace-base',
    '@opentelemetry/semantic-conventions',
  ],
  external: [
    // React / dashboard UI — never imported by the CLI or daemon at startup
    'react',
    'react-dom',
    'react-router-dom',
    'recharts',
    'framer-motion',
    'lucide-react',
    'class-variance-authority',
    'clsx',
    'tailwind-merge',
    'tailwindcss-animate',
    '@radix-ui/react-select',
    '@radix-ui/react-separator',
    '@radix-ui/react-slot',
    '@radix-ui/react-switch',
    '@radix-ui/react-tabs',
    '@radix-ui/react-tooltip',
    'react-countup',
  ],
  clean: true,
  splitting: false,
  sourcemap: false,
  dts: false,
  minify: false,
  onSuccess: async () => {
    await chmod('dist/index.js', 0o755);
    console.log('dist/index.js chmod +x done');
  },
});
