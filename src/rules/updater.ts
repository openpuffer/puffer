import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import type { RuleManifest } from '@puffer/core';
import { loadRules } from './loader.js';
import { logger } from '../utils/logger.js';

const USER_RULES_DIR = path.join(process.env.HOME ?? '~', '.puffer', 'rules');
const LAST_CHECK_FILE = path.join(USER_RULES_DIR, '.last-check');
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface UpdateCheckResult {
  available: number;
  upToDate: number;
  rules: RuleManifest['rules'];
}

export interface UpdateApplyResult {
  updated: number;
  added: number;
  errors: string[];
}

/**
 * Check if updates are available from a remote rule registry.
 */
export async function checkForUpdates(
  registryUrl: string,
  force = false,
): Promise<UpdateCheckResult> {
  // Rate limit checks (unless forced)
  if (!force && fs.existsSync(LAST_CHECK_FILE)) {
    const lastCheck = parseInt(fs.readFileSync(LAST_CHECK_FILE, 'utf-8'), 10);
    if (Date.now() - lastCheck < CHECK_INTERVAL_MS) {
      logger.info('Rule update check skipped (checked within last 24h). Use --force to override.');
      return { available: 0, upToDate: 0, rules: [] };
    }
  }

  // Fetch remote manifest
  const manifestUrl = registryUrl.endsWith('/')
    ? `${registryUrl}manifest.json`
    : `${registryUrl}/manifest.json`;
  let manifest: RuleManifest;

  try {
    const res = await fetch(manifestUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    manifest = (await res.json()) as RuleManifest;
  } catch (err) {
    logger.error(`Failed to fetch rule manifest from ${manifestUrl}: ${(err as Error).message}`);
    return { available: 0, upToDate: 0, rules: [] };
  }

  // Compare with local rules
  const localRules = loadRules([USER_RULES_DIR]);
  const localVersions = new Map(localRules.map((r) => [r.id, r.version ?? '0.0.0']));

  let available = 0;
  let upToDate = 0;
  const updatable: RuleManifest['rules'] = [];

  for (const remote of manifest.rules) {
    const localVersion = localVersions.get(remote.id);
    if (!localVersion) {
      available++;
      updatable.push(remote);
    } else if (localVersion !== remote.version) {
      available++;
      updatable.push(remote);
    } else {
      upToDate++;
    }
  }

  // Save check timestamp
  fs.mkdirSync(USER_RULES_DIR, { recursive: true });
  fs.writeFileSync(LAST_CHECK_FILE, String(Date.now()));

  return { available, upToDate, rules: updatable };
}

/**
 * Download and apply rule updates from a remote registry.
 */
export async function applyUpdates(registryUrl: string, force = false): Promise<UpdateApplyResult> {
  const check = await checkForUpdates(registryUrl, force);

  if (check.available === 0) {
    return { updated: 0, added: 0, errors: [] };
  }

  fs.mkdirSync(USER_RULES_DIR, { recursive: true });

  let updated = 0;
  let added = 0;
  const errors: string[] = [];

  const baseUrl = registryUrl.endsWith('/') ? registryUrl : `${registryUrl}/`;

  for (const rule of check.rules) {
    const ruleUrl = `${baseUrl}${rule.file}`;
    try {
      const res = await fetch(ruleUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const content = await res.text();

      // Validate it's valid YAML with required fields
      const parsed = YAML.parse(content);
      if (!parsed || !parsed.id) {
        throw new Error('Invalid rule format');
      }

      const filename = path.basename(rule.file);
      const localPath = path.join(USER_RULES_DIR, filename);

      if (fs.existsSync(localPath)) {
        updated++;
      } else {
        added++;
      }

      fs.writeFileSync(localPath, content);
      logger.info(`Rule ${rule.id} → ${filename}`);
    } catch (err) {
      errors.push(`${rule.id}: ${(err as Error).message}`);
    }
  }

  return { updated, added, errors };
}

/**
 * List all loaded rules from both bundled and user directories.
 */
export function listLoadedRules(): Array<{
  id: string;
  name: string;
  layer: string;
  severity: string;
  version: string;
  source: string;
}> {
  const RULES_DIR = path.join(process.cwd(), 'rules');
  const bundled = loadRules([RULES_DIR]).map((r) => ({
    id: r.id,
    name: r.name,
    layer: r.layer,
    severity: r.severity,
    version: r.version ?? '-',
    source: 'bundled',
  }));
  const user = loadRules([USER_RULES_DIR]).map((r) => ({
    id: r.id,
    name: r.name,
    layer: r.layer,
    severity: r.severity,
    version: r.version ?? '-',
    source: 'user',
  }));

  return [...bundled, ...user];
}
