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
export const DAEMON_LOG_PATH = path.join(PUFFER_DIR, 'daemon.log');

// Discovery scan interval (30 seconds)
export const DEFAULT_SCAN_INTERVAL_MS = 30_000;

// Maximum request body size for proxy (50 MB)
export const MAX_REQUEST_BODY_BYTES = 50 * 1024 * 1024;

// Pipeline defaults — used by DefensePipeline and createDefaultPipeline.
export const DEFAULT_LAYER_TIMEOUT_MS = 5_000;

// Daemon-fork readiness timeout (CLI waits this long for the IPC `ready`).
export const DAEMON_READY_TIMEOUT_MS = 10_000;

// Severity ordering — single source of truth used by alerts (ranking),
// reports (sorting), scoring, and the metrics layer label.
//
// `SEVERITY_ASC` indexes ascending so `indexOf(sev)` returns higher
// numbers for higher severities (use for comparisons / max).
// `SEVERITY_DESC` mirrors it for code that scans "find first match
// starting from the most severe" (e.g. layer-helpers.getMaxSeverity).
export const SEVERITY_ASC = ['low', 'medium', 'high', 'critical'] as const;
export const SEVERITY_DESC = ['critical', 'high', 'medium', 'low'] as const;
export type Severity = (typeof SEVERITY_ASC)[number];

// Audit log size guards.
export const AUDIT_TRUNCATE_VALUE_LENGTH = 200;
export const AUDIT_DEFAULT_RETENTION_DAYS = 30;

// Cloud reporter knobs (overridable via config.cloud).
export const CLOUD_DEFAULT_BATCH_SIZE = 50;
export const CLOUD_DEFAULT_FLUSH_INTERVAL_MS = 60_000;
export const CLOUD_HEARTBEAT_TIMEOUT_MS = 5_000;
export const CLOUD_INGEST_TIMEOUT_MS = 10_000;
export const CLOUD_MAX_OFFLINE_QUEUE = 10_000;

// Cost table (USD per 1M tokens, input/output)
export const COST_TABLE: Record<string, { input: number; output: number }> = {
  'gpt-4o': { input: 2.5, output: 10.0 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4-turbo': { input: 10.0, output: 30.0 },
  'claude-sonnet-4-20250514': { input: 3.0, output: 15.0 },
  'claude-haiku-4-5-20251001': { input: 0.8, output: 4.0 },
  'claude-opus-4-6': { input: 15.0, output: 75.0 },
  'deepseek-r1': { input: 0.55, output: 2.19 },
  llama3: { input: 0, output: 0 },
  'deepseek-r1:local': { input: 0, output: 0 },
  default_local: { input: 0, output: 0 },
  default_cloud: { input: 1.0, output: 5.0 },
};

// ASCII banner
export const BANNER = `
    \u{1F421} P U F F E R  v${VERSION}
    The autonomous immune system for AI agents.
    \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
`;
