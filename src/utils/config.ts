import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { PufferConfig } from '../types.js';
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

export function loadConfig(configPath?: string): PufferConfig {
  const filePath = configPath ?? CONFIG_PATH;

  // Try loading user config first
  if (fs.existsSync(filePath)) {
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const parsed = YAML.parse(raw);
      const config = camelCaseKeys(parsed) as PufferConfig;
      config.providers = config.providers ?? [];
      return config;
    } catch (err) {
      logger.error(`Failed to parse config at ${filePath}: ${(err as Error).message}`);
    }
  }

  // Fall back to default config
  if (fs.existsSync(DEFAULT_CONFIG_PATH)) {
    const raw = fs.readFileSync(DEFAULT_CONFIG_PATH, 'utf-8');
    const parsed = YAML.parse(raw);
    const config = camelCaseKeys(parsed) as PufferConfig;
    config.providers = config.providers ?? [];
    return config;
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
    mode: 'enforce',
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
          directInput: { block: 0.65, audit: 0.40 },
          externalContent: { block: 0.50, audit: 0.30 },
        },
        heuristics: [
          'role_switching', 'system_delimiters', 'imperative_override',
          'data_exfil_instruction', 'encoding_detection', 'hidden_text',
          'prompt_leaking', 'tool_abuse',
        ],
      },
      commands: {
        enabled: true,
        blockedPatterns: ['rm -rf /', 'rm -rf ~', 'curl * | bash', 'curl * | sh', 'wget * | bash', 'wget * | sh', 'chmod 777 *', ':(){ :|:& };:', '> /dev/sd*', 'mkfs *', 'dd * of=/dev/*'],
        requireApproval: ['sudo *', 'npm publish *', 'git push * main', 'git push * master', 'docker run * --privileged *'],
        maxCommandsPerMinute: 60,
        consecutiveBlockThreshold: 3,
      },
      network: {
        enabled: true,
        mode: 'blacklist',
        allowedDomains: [],
        blockedDomains: [],
        blockPrivateIPs: true,
        maxPayloadSizeMb: 50,
        scanPayloadForPII: true,
      },
      filesystem: {
        enabled: true,
        forbidden: ['~/.ssh/', '~/.aws/', '~/.gnupg/', '~/.env', '~/.config/gcloud/', '~/.kube/config', '~/.docker/config.json', '~/.npmrc', '~/.pypirc', '~/.netrc', '/etc/shadow'],
        restricted: ['~/.gitconfig', '~/.bashrc', '~/.zshrc', '.github/workflows/'],
        workspace: ['~/workspace/', '~/projects/', '~/code/', '/tmp/'],
        secretPatterns: ['sk-[a-zA-Z0-9]{20,}', 'ghp_[a-zA-Z0-9]{36}', 'AKIA[A-Z0-9]{16}', '-----BEGIN.*PRIVATE KEY', 'sk-ant-[a-zA-Z0-9-]{20,}'],
      },
      behavior: {
        enabled: true,
        maxCostPerSessionUsd: 10.00,
        maxCostPerHourUsd: 20.00,
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
