import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { HookHandler } from './index.js';
import { logger } from '../utils/logger.js';
import { backupConfigValue, restoreConfigValue, clearBackupsForFile } from './config-backup.js';
import { DEFAULT_PROXY_PORT } from '../utils/constants.js';

const CONTINUE_CONFIG_PATH = path.join(os.homedir(), '.continue', 'config.json');
const PROXY_BASE = `http://127.0.0.1:${DEFAULT_PROXY_PORT}`;
const PUFFER_AGENT_HEADER = 'continue-dev';

/**
 * Continue Dev hook integration.
 * Modifies ~/.continue/config.json to route model API calls through Puffer proxy.
 */
export class ContinueDevHook implements HookHandler {
  name = 'continue-dev';
  private installed = false;

  async install(): Promise<void> {
    try {
      if (!fs.existsSync(CONTINUE_CONFIG_PATH)) {
        logger.debug('Continue Dev config not found, skipping hook installation');
        return;
      }

      const raw = fs.readFileSync(CONTINUE_CONFIG_PATH, 'utf-8');
      const config = JSON.parse(raw) as Record<string, unknown>;
      const models = config.models as Record<string, unknown>[] | undefined;

      if (!Array.isArray(models) || models.length === 0) {
        logger.debug('Continue Dev: no models configured, skipping');
        return;
      }

      for (let i = 0; i < models.length; i++) {
        const model = models[i];
        const dotPath = `models.${i}.apiBase`;

        // Backup original apiBase
        backupConfigValue(CONTINUE_CONFIG_PATH, dotPath, model.apiBase ?? null);

        // Determine proxy URL based on provider
        const provider = String(model.provider ?? 'openai');
        if (provider === 'anthropic') {
          model.apiBase = PROXY_BASE;
        } else {
          model.apiBase = `${PROXY_BASE}/v1`;
        }

        // Inject Puffer agent header for identification
        if (!model.requestOptions || typeof model.requestOptions !== 'object') {
          model.requestOptions = {};
        }
        const reqOpts = model.requestOptions as Record<string, unknown>;
        if (!reqOpts.headers || typeof reqOpts.headers !== 'object') {
          reqOpts.headers = {};
        }

        // Backup original headers
        backupConfigValue(CONTINUE_CONFIG_PATH, `models.${i}.requestOptions.headers`, {
          ...(reqOpts.headers as object),
        });

        const headers = reqOpts.headers as Record<string, string>;
        headers['x-puffer-agent'] = PUFFER_AGENT_HEADER;
        if (
          typeof model.apiBase === 'string' &&
          model.apiBase !== PROXY_BASE &&
          !model.apiBase.startsWith(PROXY_BASE)
        ) {
          headers['x-puffer-original-host'] = String(model.apiBase);
        }
      }

      // Also handle tabAutocompleteModel if present
      if (config.tabAutocompleteModel && typeof config.tabAutocompleteModel === 'object') {
        const tabModel = config.tabAutocompleteModel as Record<string, unknown>;
        backupConfigValue(
          CONTINUE_CONFIG_PATH,
          'tabAutocompleteModel.apiBase',
          tabModel.apiBase ?? null,
        );
        tabModel.apiBase = `${PROXY_BASE}/v1`;
      }

      fs.writeFileSync(CONTINUE_CONFIG_PATH, JSON.stringify(config, null, 2));

      this.installed = true;
      logger.info('Continue Dev hook installed (model API bases → Puffer proxy)');
    } catch (err) {
      logger.error(`Failed to install Continue Dev hook: ${(err as Error).message}`);
    }
  }

  async uninstall(): Promise<void> {
    try {
      if (!fs.existsSync(CONTINUE_CONFIG_PATH)) {
        this.installed = false;
        return;
      }

      const raw = fs.readFileSync(CONTINUE_CONFIG_PATH, 'utf-8');
      const config = JSON.parse(raw) as Record<string, unknown>;
      const models = config.models as Record<string, unknown>[] | undefined;

      if (Array.isArray(models)) {
        for (let i = 0; i < models.length; i++) {
          const model = models[i];

          // Restore apiBase
          const originalBase = restoreConfigValue(CONTINUE_CONFIG_PATH, `models.${i}.apiBase`);
          if (originalBase.exists) {
            if (originalBase.value === null) {
              delete model.apiBase;
            } else {
              model.apiBase = originalBase.value;
            }
          }

          // Restore headers
          const originalHeaders = restoreConfigValue(
            CONTINUE_CONFIG_PATH,
            `models.${i}.requestOptions.headers`,
          );
          if (
            originalHeaders.exists &&
            model.requestOptions &&
            typeof model.requestOptions === 'object'
          ) {
            const reqOpts = model.requestOptions as Record<string, unknown>;
            if (
              originalHeaders.value === null ||
              Object.keys(originalHeaders.value as object).length === 0
            ) {
              delete reqOpts.headers;
            } else {
              reqOpts.headers = originalHeaders.value;
            }
            // Clean up empty requestOptions
            if (Object.keys(reqOpts).length === 0) {
              delete model.requestOptions;
            }
          }
        }
      }

      // Restore tabAutocompleteModel
      const originalTab = restoreConfigValue(CONTINUE_CONFIG_PATH, 'tabAutocompleteModel.apiBase');
      if (
        originalTab.exists &&
        config.tabAutocompleteModel &&
        typeof config.tabAutocompleteModel === 'object'
      ) {
        const tabModel = config.tabAutocompleteModel as Record<string, unknown>;
        if (originalTab.value === null) {
          delete tabModel.apiBase;
        } else {
          tabModel.apiBase = originalTab.value;
        }
      }

      fs.writeFileSync(CONTINUE_CONFIG_PATH, JSON.stringify(config, null, 2));

      clearBackupsForFile(CONTINUE_CONFIG_PATH);
      this.installed = false;
      logger.info('Continue Dev hook uninstalled');
    } catch (err) {
      logger.error(`Failed to uninstall Continue Dev hook: ${(err as Error).message}`);
    }
  }

  isInstalled(): boolean {
    return this.installed;
  }
}
