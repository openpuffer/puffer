import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { HookHandler } from './index.js';
import { logger } from '../utils/logger.js';
import { backupConfigValue, restoreConfigValue } from './config-backup.js';
import { DEFAULT_PROXY_PORT } from '../utils/constants.js';

const PROXY_BASE = `http://127.0.0.1:${DEFAULT_PROXY_PORT}`;

/**
 * Parse JSON that may contain trailing commas (VS Code JSONC format).
 * Strips trailing commas before } and ] then parses.
 */
function parseLenientJSON(raw: string): Record<string, unknown> {
  // Remove trailing commas before closing braces/brackets
  const cleaned = raw.replace(/,\s*([\]}])/g, '$1');
  return JSON.parse(cleaned);
}

// Cline stores settings in VS Code's settings.json
// These are the known setting keys for Cline/Roo-Cline API base URLs
const CLINE_SETTINGS: Record<string, string> = {
  'cline.openAiBaseUrl': `${PROXY_BASE}/v1`,
  'cline.ollamaBaseUrl': PROXY_BASE,
  'roo-cline.openAiBaseUrl': `${PROXY_BASE}/v1`,
  'roo-cline.ollamaBaseUrl': PROXY_BASE,
};

function getVSCodeSettingsPaths(): string[] {
  const home = os.homedir();
  const platform = process.platform;

  const paths: string[] = [];

  if (platform === 'linux') {
    paths.push(
      path.join(home, '.config', 'Code', 'User', 'settings.json'),
      path.join(home, '.config', 'Code - Insiders', 'User', 'settings.json'),
    );
  } else if (platform === 'darwin') {
    paths.push(
      path.join(home, 'Library', 'Application Support', 'Code', 'User', 'settings.json'),
      path.join(home, 'Library', 'Application Support', 'Code - Insiders', 'User', 'settings.json'),
    );
  } else if (platform === 'win32') {
    const appData = process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming');
    paths.push(
      path.join(appData, 'Code', 'User', 'settings.json'),
      path.join(appData, 'Code - Insiders', 'User', 'settings.json'),
    );
  }

  return paths;
}

/**
 * Cline (and Roo-Cline) hook integration.
 * Modifies VS Code settings.json to route Cline API calls through Puffer proxy.
 */
export class ClineHook implements HookHandler {
  name = 'cline';
  private installed = false;

  async install(): Promise<void> {
    try {
      const settingsPaths = getVSCodeSettingsPaths();
      let anyInstalled = false;

      for (const settingsPath of settingsPaths) {
        if (!fs.existsSync(settingsPath)) continue;

        const raw = fs.readFileSync(settingsPath, 'utf-8');
        let settings: Record<string, unknown>;
        try {
          settings = parseLenientJSON(raw);
        } catch {
          logger.warn(`Cline hook: failed to parse ${settingsPath}, skipping`);
          continue;
        }

        for (const [key, proxyUrl] of Object.entries(CLINE_SETTINGS)) {
          backupConfigValue(settingsPath, key, settings[key] ?? null);
          settings[key] = proxyUrl;
        }

        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 4));
        anyInstalled = true;
        logger.debug(`Cline hook: modified ${settingsPath}`);
      }

      if (anyInstalled) {
        this.installed = true;
        logger.info('Cline hook installed (API base URLs → Puffer proxy)');
      } else {
        logger.debug('Cline hook: no VS Code settings.json found, skipping');
      }
    } catch (err) {
      logger.error(`Failed to install Cline hook: ${(err as Error).message}`);
    }
  }

  async uninstall(): Promise<void> {
    try {
      const settingsPaths = getVSCodeSettingsPaths();

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
        for (const key of Object.keys(CLINE_SETTINGS)) {
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
          logger.debug(`Cline hook: restored ${settingsPath}`);
        }
      }

      this.installed = false;
      logger.info('Cline hook uninstalled');
    } catch (err) {
      logger.error(`Failed to uninstall Cline hook: ${(err as Error).message}`);
    }
  }

  isInstalled(): boolean {
    return this.installed;
  }
}
