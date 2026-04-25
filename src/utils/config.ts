import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { fromZodError } from 'zod-validation-error';
import type { PufferConfig } from '@puffer/core';
import { PufferConfigSchema } from '@puffer/core';
import { CONFIG_PATH, PUFFER_DIR } from './constants.js';
import { logger } from './logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CONFIG_PATH = path.resolve(__dirname, '../../config/default-policy.yaml');

function camelCaseKeys(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(camelCaseKeys);
  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      const camelKey = key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
      result[camelKey] = camelCaseKeys(value);
    }
    return result;
  }
  return obj;
}

/**
 * Strip explicit `null` values so YAML `field: null` is treated as
 * "field absent" by the schema. Preserves arrays and nested objects.
 */
function stripNulls(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(stripNulls);
  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (value === null) continue;
      result[key] = stripNulls(value);
    }
    return result;
  }
  return obj;
}

/**
 * Parse + validate a YAML config file. Throws if the schema doesn't match —
 * this is intentional. Silent fallback to defaults on a malformed user
 * config would let a misconfigured layer pass traffic without inspection.
 */
function parseAndValidate(raw: string, sourcePath: string): PufferConfig {
  const parsed = YAML.parse(raw);
  const normalized = stripNulls(camelCaseKeys(parsed));

  // Backwards-compat: older configs may not have `providers`.
  if (normalized && typeof normalized === 'object' && !Array.isArray(normalized)) {
    const obj = normalized as Record<string, unknown>;
    if (obj.providers === undefined) obj.providers = [];
  }

  const result = PufferConfigSchema.safeParse(normalized);
  if (!result.success) {
    const formatted = fromZodError(result.error, {
      prefix: `Invalid config at ${sourcePath}`,
      issueSeparator: '\n  - ',
    });
    throw new Error(formatted.toString());
  }
  return result.data;
}

export function loadConfig(configPath?: string): PufferConfig {
  const filePath = configPath ?? CONFIG_PATH;

  // Try loading user config first
  if (fs.existsSync(filePath)) {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return parseAndValidate(raw, filePath);
  }

  // Fall back to bundled default config
  if (fs.existsSync(DEFAULT_CONFIG_PATH)) {
    const raw = fs.readFileSync(DEFAULT_CONFIG_PATH, 'utf-8');
    return parseAndValidate(raw, DEFAULT_CONFIG_PATH);
  }

  logger.warn('No config found, using built-in defaults');
  return getBuiltinDefaults();
}

export function saveConfig(config: PufferConfig, configPath?: string): void {
  const filePath = configPath ?? CONFIG_PATH;
  const dir = path.dirname(filePath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const yamlStr = YAML.stringify(snakeCaseKeys(config), { indent: 2 });
  fs.writeFileSync(filePath, yamlStr, 'utf-8');
}

function snakeCaseKeys(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(snakeCaseKeys);
  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      const snakeKey = key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
      result[snakeKey] = snakeCaseKeys(value);
    }
    return result;
  }
  return obj;
}

export function ensurePufferDir(): void {
  if (!fs.existsSync(PUFFER_DIR)) {
    fs.mkdirSync(PUFFER_DIR, { recursive: true });
  }
}

function getBuiltinDefaults(): PufferConfig {
  return {
    version: '0.1.0',
    mode: 'monitor',
    providers: [],
    autoDiscovery: {
      enabled: true,
      scanIntervalMs: 30_000,
      processScanner: true,
      portScanner: true,
      networkScanner: true,
    },
    layers: {
      pii: {
        enabled: true,
        regions: ['us', 'eu', 'global'],
        actionBySeverity: { critical: 'block', high: 'block', medium: 'audit', low: 'allow' },
        customPatterns: [],
        excludeContexts: [],
      },
      injection: {
        enabled: true,
        mode: 'heuristic',
        thresholds: {
          directInput: { block: 0.65, audit: 0.4 },
          externalContent: { block: 0.5, audit: 0.3 },
        },
        heuristics: [
          'role_switching',
          'system_delimiters',
          'imperative_override',
          'data_exfil_instruction',
          'encoding_detection',
          'hidden_text',
          'prompt_leaking',
          'tool_abuse',
        ],
      },
      commands: {
        enabled: true,
        blockedPatterns: [
          'rm -rf /',
          'rm -rf ~',
          'curl * | bash',
          'curl * | sh',
          'wget * | bash',
          'wget * | sh',
          'chmod 777 *',
          ':(){ :|:& };:',
          '> /dev/sd*',
          'mkfs *',
          'dd * of=/dev/*',
        ],
        requireApproval: [
          'sudo *',
          'npm publish *',
          'git push * main',
          'git push * master',
          'docker run * --privileged *',
        ],
        maxCommandsPerMinute: 60,
        consecutiveBlockThreshold: 3,
      },
      network: {
        enabled: true,
        mode: 'blacklist',
        allowedDomains: [],
        blockedDomains: [],
        blockPrivateIps: true,
        maxPayloadSizeMb: 50,
        scanPayloadForPii: true,
      },
      filesystem: {
        enabled: true,
        forbidden: [
          '~/.ssh/',
          '~/.aws/',
          '~/.gnupg/',
          '~/.env',
          '~/.config/gcloud/',
          '~/.kube/config',
          '~/.docker/config.json',
          '~/.npmrc',
          '~/.pypirc',
          '~/.netrc',
          '/etc/shadow',
        ],
        restricted: ['~/.gitconfig', '~/.bashrc', '~/.zshrc', '.github/workflows/'],
        workspace: ['~/workspace/', '~/projects/', '~/code/', '/tmp/'],
        secretPatterns: [
          'sk-[a-zA-Z0-9]{20,}',
          'ghp_[a-zA-Z0-9]{36}',
          'AKIA[A-Z0-9]{16}',
          '-----BEGIN.*PRIVATE KEY',
          'sk-ant-[a-zA-Z0-9-]{20,}',
        ],
      },
      behavior: {
        enabled: true,
        maxCostPerSessionUsd: 10.0,
        maxCostPerHourUsd: 20.0,
        loopDetection: { windowSize: 20, similarityThreshold: 0.85, consecutiveMatches: 5 },
        sensitivity: 'medium',
      },
      mcp: {
        enabled: true,
        authorizedServers: [],
        blockUnauthorized: false,
        scanToolResults: true,
      },
    },
    dashboard: { enabled: true, port: 8788 },
    audit: { logPath: '~/.puffer/audit.jsonl', retentionDays: 30 },
    alerts: { desktop: true },
  };
}
