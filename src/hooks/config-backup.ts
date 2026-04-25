import fs from 'node:fs';
import path from 'node:path';
import { PUFFER_DIR } from '../utils/constants.js';
import { logger } from '../utils/logger.js';

const BACKUPS_PATH = path.join(PUFFER_DIR, 'config-backups.json');

interface BackupStore {
  [key: string]: unknown; // "filepath::dotPath" → original value (null = key didn't exist)
}

function loadBackups(): BackupStore {
  try {
    if (fs.existsSync(BACKUPS_PATH)) {
      return JSON.parse(fs.readFileSync(BACKUPS_PATH, 'utf-8'));
    }
  } catch {
    logger.warn('Failed to read config backups, starting fresh');
  }
  return {};
}

function saveBackups(store: BackupStore): void {
  const tmp = BACKUPS_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2));
  fs.renameSync(tmp, BACKUPS_PATH);
}

function makeKey(filePath: string, dotPath: string): string {
  return `${filePath}::${dotPath}`;
}

/**
 * Save the original value of a config key before Puffer modifies it.
 * Pass `null` if the key did not exist (so we know to delete on restore).
 */
export function backupConfigValue(filePath: string, dotPath: string, originalValue: unknown): void {
  const store = loadBackups();
  const key = makeKey(filePath, dotPath);
  // Only save the first time — don't overwrite with Puffer's own value
  if (!(key in store)) {
    store[key] = originalValue ?? null;
    saveBackups(store);
  }
}

/**
 * Restore a config value to its original state.
 * Returns the original value, or `undefined` if no backup exists.
 * `null` means the key should be deleted (it didn't exist before).
 */
export function restoreConfigValue(
  filePath: string,
  dotPath: string,
): { exists: boolean; value: unknown } {
  const store = loadBackups();
  const key = makeKey(filePath, dotPath);
  if (key in store) {
    const value = store[key];
    delete store[key];
    saveBackups(store);
    return { exists: true, value };
  }
  return { exists: false, value: undefined };
}

/**
 * Check if we have any backups for a given file.
 */
export function hasBackupsForFile(filePath: string): boolean {
  const store = loadBackups();
  return Object.keys(store).some((k) => k.startsWith(filePath + '::'));
}

/**
 * Clear all backups for a given file.
 */
export function clearBackupsForFile(filePath: string): void {
  const store = loadBackups();
  for (const key of Object.keys(store)) {
    if (key.startsWith(filePath + '::')) {
      delete store[key];
    }
  }
  saveBackups(store);
}
