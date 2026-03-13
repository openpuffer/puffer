import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { HookHandler } from './index.js';
import { logger } from '../utils/logger.js';
import { backupConfigValue, restoreConfigValue } from './config-backup.js';
import { DEFAULT_PROXY_PORT } from '../utils/constants.js';

const PROXY_BASE = `http://127.0.0.1:${DEFAULT_PROXY_PORT}`;

function parseLenientJSON(raw: string): Record<string, unknown> {
  const cleaned = raw.replace(/,\s*([\]}])/g, '$1');
  return JSON.parse(cleaned);
}

// Cursor settings keys for custom API endpoints
const CURSOR_SETTINGS: Record<string, string> = {
  'openai.apiBase': `${PROXY_BASE}/v1`,
  'anthropic.apiBase': PROXY_BASE,
  'cursor.general.openAiApiBase': `${PROXY_BASE}/v1`,
};

function getCursorSettingsPaths(): string[] {
  const home = os.homedir();
  const platform = process.platform;
  const paths: string[] = [];

  if (platform === 'linux') {
    paths.push(
      path.join(home, '.config', 'Cursor', 'User', 'settings.json'),
      path.join(home, '.cursor', 'User', 'settings.json'),
    );
  } else if (platform === 'darwin') {
    paths.push(
      path.join(home, 'Library', 'Application Support', 'Cursor', 'User', 'settings.json'),
      path.join(home, '.cursor', 'User', 'settings.json'),
    );
  } else if (platform === 'win32') {
    const appData = process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming');
    paths.push(
      path.join(appData, 'Cursor', 'User', 'settings.json'),
      path.join(home, '.cursor', 'User', 'settings.json'),
    );
  }

  return paths;
}

/**
 * Cursor editor hook integration.
 * Modifies Cursor's settings.json to route API calls through Puffer proxy.
 * Note: Only affects user-configured models (bring-your-own-key).
 * Cursor's built-in Copilot++ uses proprietary servers and cannot be intercepted.
 */
export class CursorHook implements HookHandler {
  name = 'cursor';
  private installed = false;

  async install(): Promise<void> {
    try {
      const settingsPaths = getCursorSettingsPaths();
      let anyInstalled = false;

      for (const settingsPath of settingsPaths) {
        if (!fs.existsSync(settingsPath)) continue;

        const raw = fs.readFileSync(settingsPath, 'utf-8');
        let settings: Record<string, unknown>;
        try {
          settings = parseLenientJSON(raw);
        } catch {
          logger.warn(`Cursor hook: failed to parse ${settingsPath}, skipping`);
          continue;
        }

        for (const [key, proxyUrl] of Object.entries(CURSOR_SETTINGS)) {
          backupConfigValue(settingsPath, key, settings[key] ?? null);
          settings[key] = proxyUrl;
        }

        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 4));
        anyInstalled = true;
        logger.debug(`Cursor hook: modified ${settingsPath}`);
      }

      if (anyInstalled) {
        this.installed = true;
        logger.info('Cursor hook installed (API base URLs → Puffer proxy)');
      } else {
        logger.debug('Cursor hook: no Cursor settings.json found, skipping');
      }
    } catch (err) {
      logger.error(`Failed to install Cursor hook: ${(err as Error).message}`);
    }
  }

  async uninstall(): Promise<void> {
    try {
      const settingsPaths = getCursorSettingsPaths();

      for (const settingsPath of settingsPaths) {
        if (!fs.existsSync(settingsPath)) continue;

        const raw = fs.readFileSync(settingsPath, 'utf-8');
        let settings: Record<string, unknown>;
        try {
          settings = parseLenientJSON(raw);
        } catch {
          continue;
        }

        let modified = false;
        for (const key of Object.keys(CURSOR_SETTINGS)) {
          const original = restoreConfigValue(settingsPath, key);
          if (original.exists) {
            if (original.value === null) {
              delete settings[key];
            } else {
              settings[key] = original.value;
            }
            modified = true;
          }
        }

        if (modified) {
          fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 4));
          logger.debug(`Cursor hook: restored ${settingsPath}`);
        }
      }

      this.installed = false;
      logger.info('Cursor hook uninstalled');
    } catch (err) {
      logger.error(`Failed to uninstall Cursor hook: ${(err as Error).message}`);
    }
  }

  isInstalled(): boolean {
    return this.installed;
  }
}
