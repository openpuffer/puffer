import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import YAML from 'yaml';
import { HookHandler } from './index.js';
import { logger } from '../utils/logger.js';
import { backupConfigValue, restoreConfigValue } from './config-backup.js';
import { DEFAULT_PROXY_PORT } from '../utils/constants.js';

const AIDER_CONFIG_PATH = path.join(os.homedir(), '.aider.conf.yml');
const PROXY_BASE = `http://127.0.0.1:${DEFAULT_PROXY_PORT}`;
const PUFFER_MARKER = '# managed by puffer';

const KEYS_TO_SET: Record<string, string> = {
  'openai-api-base': `${PROXY_BASE}/v1`,
  'anthropic-api-base': PROXY_BASE,
};

/**
 * Aider hook integration.
 * Modifies ~/.aider.conf.yml to route API calls through Puffer proxy.
 */
export class AiderHook implements HookHandler {
  name = 'aider';
  private installed = false;

  async install(): Promise<void> {
    try {
      let config: Record<string, unknown> = {};
      let fileExisted = false;

      if (fs.existsSync(AIDER_CONFIG_PATH)) {
        fileExisted = true;
        const raw = fs.readFileSync(AIDER_CONFIG_PATH, 'utf-8');
        config = (YAML.parse(raw) as Record<string, unknown>) ?? {};
      }

      // Backup whether the file existed
      backupConfigValue(AIDER_CONFIG_PATH, '__file_existed__', fileExisted);

      for (const [key, proxyUrl] of Object.entries(KEYS_TO_SET)) {
        backupConfigValue(AIDER_CONFIG_PATH, key, config[key] ?? null);
        config[key] = proxyUrl;
      }

      const yamlContent = PUFFER_MARKER + '\n' + YAML.stringify(config);
      fs.writeFileSync(AIDER_CONFIG_PATH, yamlContent);

      this.installed = true;
      logger.info('Aider hook installed (API base URLs → Puffer proxy)');
    } catch (err) {
      logger.error(`Failed to install Aider hook: ${(err as Error).message}`);
    }
  }

  async uninstall(): Promise<void> {
    try {
      if (!fs.existsSync(AIDER_CONFIG_PATH)) {
        this.installed = false;
        return;
      }

      const raw = fs.readFileSync(AIDER_CONFIG_PATH, 'utf-8');
      const config = (YAML.parse(raw) as Record<string, unknown>) ?? {};

      // Check if file existed before Puffer
      const fileExisted = restoreConfigValue(AIDER_CONFIG_PATH, '__file_existed__');

      if (fileExisted.exists && fileExisted.value === false) {
        // File was created by Puffer — delete it
        fs.unlinkSync(AIDER_CONFIG_PATH);
      } else {
        // Restore original values
        for (const key of Object.keys(KEYS_TO_SET)) {
          const original = restoreConfigValue(AIDER_CONFIG_PATH, key);
          if (original.exists) {
            if (original.value === null) {
              delete config[key];
            } else {
              config[key] = original.value;
            }
          }
        }

        // Remove puffer marker and write
        const yamlContent = YAML.stringify(config);
        fs.writeFileSync(AIDER_CONFIG_PATH, yamlContent);
      }

      this.installed = false;
      logger.info('Aider hook uninstalled');
    } catch (err) {
      logger.error(`Failed to uninstall Aider hook: ${(err as Error).message}`);
    }
  }

  isInstalled(): boolean {
    return this.installed;
  }
}
