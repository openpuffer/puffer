import path from 'node:path';
import os from 'node:os';

export const VERSION = '0.1.0';
export const APP_NAME = 'puffer';
export const DISPLAY_NAME = 'PUFFER';

// Default ports
export const DEFAULT_PROXY_PORT = 8787;
export const DEFAULT_DASHBOARD_PORT = 8788;

// Paths
export const HOME_DIR = os.homedir();
export const PUFFER_DIR = path.join(HOME_DIR, '.puffer');
export const CONFIG_PATH = path.join(PUFFER_DIR, 'config.yaml');
export const AUDIT_LOG_PATH = path.join(PUFFER_DIR, 'audit.jsonl');
export const PID_FILE_PATH = path.join(PUFFER_DIR, 'puffer.pid');

// Discovery scan interval (30 seconds)
export const DEFAULT_SCAN_INTERVAL_MS = 30_000;

// Cost table (USD per 1M tokens, input/output)
export const COST_TABLE: Record<string, { input: number; output: number }> = {
  'gpt-4o': { input: 2.50, output: 10.00 },
  'gpt-4o-mini': { input: 0.15, output: 0.60 },
  'gpt-4-turbo': { input: 10.00, output: 30.00 },
  'claude-sonnet-4-20250514': { input: 3.00, output: 15.00 },
  'claude-haiku-4-5-20251001': { input: 0.80, output: 4.00 },
  'claude-opus-4-6': { input: 15.00, output: 75.00 },
  'deepseek-r1': { input: 0.55, output: 2.19 },
  'llama3': { input: 0, output: 0 },
  'deepseek-r1:local': { input: 0, output: 0 },
  'default_local': { input: 0, output: 0 },
  'default_cloud': { input: 1.00, output: 5.00 },
};

// ASCII banner
export const BANNER = `
    \u{1F421} P U F F E R  v${VERSION}
    The autonomous immune system for AI agents.
    \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
`;
