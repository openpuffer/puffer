import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadConfig } from '@puffer/core';

describe('loadConfig (YAML + zod)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'puffer-config-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeConfig(name: string, contents: string): string {
    const p = path.join(tmpDir, name);
    fs.writeFileSync(p, contents);
    return p;
  }

  it('loads the bundled default-policy.yaml without errors', () => {
    // Calling loadConfig() with no args makes it fall back to the bundled
    // config when no user config exists. We pass a missing path to force the
    // bundled default branch.
    const config = loadConfig(path.join(tmpDir, 'does-not-exist.yaml'));
    expect(config.mode).toBe('monitor');
    expect(config.layers.pii.enabled).toBe(true);
    expect(config.layers.injection.thresholds.directInput.block).toBe(0.65);
  });

  it('treats `webhook: null` in YAML as absent (does not fail validation)', () => {
    const cfg = writeConfig(
      'with-null-webhook.yaml',
      `
version: "0.1.0"
mode: monitor
auto_discovery:
  enabled: true
  scan_interval_ms: 30000
  process_scanner: true
  port_scanner: true
  network_scanner: true
layers:
  pii: { enabled: true, regions: [], action_by_severity: { critical: block }, custom_patterns: [], exclude_contexts: [] }
  injection: { enabled: true, mode: heuristic, thresholds: { direct_input: { block: 0.65, audit: 0.4 }, external_content: { block: 0.5, audit: 0.3 } }, heuristics: [] }
  commands: { enabled: true, blocked_patterns: [], require_approval: [], max_commands_per_minute: 60, consecutive_block_threshold: 3 }
  network: { enabled: true, mode: blacklist, allowed_domains: [], blocked_domains: [], block_private_ips: true, max_payload_size_mb: 50, scan_payload_for_pii: true }
  filesystem: { enabled: true, forbidden: [], restricted: [], workspace: [], secret_patterns: [] }
  behavior: { enabled: true, max_cost_per_session_usd: 10, max_cost_per_hour_usd: 20, loop_detection: { window_size: 20, similarity_threshold: 0.85, consecutive_matches: 5 }, sensitivity: medium }
  mcp: { enabled: true, authorized_servers: [], block_unauthorized: false, scan_tool_results: true }
dashboard: { enabled: true, port: 8788 }
audit: { log_path: "~/.puffer/audit.jsonl", retention_days: 30 }
alerts:
  desktop: true
  webhook: null
`,
    );
    const config = loadConfig(cfg);
    expect(config.alerts.webhook).toBeUndefined();
  });

  it('throws a readable error when a required field has the wrong type', () => {
    const cfg = writeConfig(
      'bad-mode.yaml',
      `
version: "0.1.0"
mode: not-a-real-mode
auto_discovery: { enabled: true, scan_interval_ms: 30000, process_scanner: true, port_scanner: true, network_scanner: true }
layers:
  pii: { enabled: true, regions: [], action_by_severity: {}, custom_patterns: [], exclude_contexts: [] }
  injection: { enabled: true, mode: heuristic, thresholds: { direct_input: { block: 0.65, audit: 0.4 }, external_content: { block: 0.5, audit: 0.3 } }, heuristics: [] }
  commands: { enabled: true, blocked_patterns: [], require_approval: [], max_commands_per_minute: 60, consecutive_block_threshold: 3 }
  network: { enabled: true, mode: blacklist, allowed_domains: [], blocked_domains: [], block_private_ips: true, max_payload_size_mb: 50, scan_payload_for_pii: true }
  filesystem: { enabled: true, forbidden: [], restricted: [], workspace: [], secret_patterns: [] }
  behavior: { enabled: true, max_cost_per_session_usd: 10, max_cost_per_hour_usd: 20, loop_detection: { window_size: 20, similarity_threshold: 0.85, consecutive_matches: 5 }, sensitivity: medium }
  mcp: { enabled: true, authorized_servers: [], block_unauthorized: false, scan_tool_results: true }
dashboard: { enabled: true, port: 8788 }
audit: { log_path: "x", retention_days: 30 }
alerts: { desktop: true }
`,
    );
    expect(() => loadConfig(cfg)).toThrow(/Invalid config/);
    expect(() => loadConfig(cfg)).toThrow(/mode/);
  });

  it('throws when a numeric threshold is out of [0, 1] range', () => {
    const cfg = writeConfig(
      'bad-threshold.yaml',
      `
version: "0.1.0"
mode: monitor
auto_discovery: { enabled: true, scan_interval_ms: 30000, process_scanner: true, port_scanner: true, network_scanner: true }
layers:
  pii: { enabled: true, regions: [], action_by_severity: {}, custom_patterns: [], exclude_contexts: [] }
  injection: { enabled: true, mode: heuristic, thresholds: { direct_input: { block: 99, audit: 0.4 }, external_content: { block: 0.5, audit: 0.3 } }, heuristics: [] }
  commands: { enabled: true, blocked_patterns: [], require_approval: [], max_commands_per_minute: 60, consecutive_block_threshold: 3 }
  network: { enabled: true, mode: blacklist, allowed_domains: [], blocked_domains: [], block_private_ips: true, max_payload_size_mb: 50, scan_payload_for_pii: true }
  filesystem: { enabled: true, forbidden: [], restricted: [], workspace: [], secret_patterns: [] }
  behavior: { enabled: true, max_cost_per_session_usd: 10, max_cost_per_hour_usd: 20, loop_detection: { window_size: 20, similarity_threshold: 0.85, consecutive_matches: 5 }, sensitivity: medium }
  mcp: { enabled: true, authorized_servers: [], block_unauthorized: false, scan_tool_results: true }
dashboard: { enabled: true, port: 8788 }
audit: { log_path: "x", retention_days: 30 }
alerts: { desktop: true }
`,
    );
    expect(() => loadConfig(cfg)).toThrow(/block/i);
  });
});
