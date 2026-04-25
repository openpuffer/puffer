import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { HookHandler } from './index.js';
import { logger } from '@puffer/core';
import { DEFAULT_PROXY_PORT } from '@puffer/core';

/**
 * Resolve VS Code settings.json path by platform.
 */
function getVSCodeSettingsPath(): string {
  const platform = os.platform();
  const home = os.homedir();

  if (platform === 'linux') {
    return path.join(home, '.config', 'Code', 'User', 'settings.json');
  } else if (platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'Code', 'User', 'settings.json');
  } else if (platform === 'win32') {
    return path.join(
      process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming'),
      'Code',
      'User',
      'settings.json',
    );
  }
  return path.join(home, '.config', 'Code', 'User', 'settings.json');
}

/**
 * VS Code Extension hook integration.
 * Configures VS Code's HTTP proxy to route through Puffer,
 * giving visibility into extensions like GitHub Copilot, Claude Code, etc.
 */
export class VSCodeExtensionHook implements HookHandler {
  name = 'vscode-extension';
  private installed = false;
  private proxyPort: number;

  constructor(proxyPort: number = DEFAULT_PROXY_PORT) {
    this.proxyPort = proxyPort;
  }

  async install(): Promise<void> {
    try {
      const settingsPath = getVSCodeSettingsPath();
      const settingsDir = path.dirname(settingsPath);

      // Ensure settings directory exists
      if (!fs.existsSync(settingsDir)) {
        logger.warn('VS Code settings directory not found, skipping VS Code extension hook');
        return;
      }

      // Read existing settings
      let settings: Record<string, unknown> = {};
      if (fs.existsSync(settingsPath)) {
        try {
          settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
        } catch {
          logger.warn('Could not parse VS Code settings.json, skipping');
          return;
        }
      }

      // Mark that Puffer is active — do NOT set http.proxy globally because
      // Puffer is a reverse proxy (not a forward/CONNECT proxy) and setting
      // http.proxy breaks extensions like GitHub Copilot that need direct
      // HTTPS connections to their own endpoints.
      // AI extensions are already covered by:
      //  - Generic hook: OPENAI_BASE_URL, ANTHROPIC_BASE_URL env vars
      //  - Claude Code hook: ANTHROPIC_BASE_URL in Claude settings
      //  - Network discovery: passive monitoring of Copilot connections
      settings['puffer.installed'] = true;
      settings['puffer.proxyPort'] = this.proxyPort;

      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

      this.installed = true;
      logger.info('VS Code Puffer markers configured (no http.proxy — passive monitoring only)');
    } catch (err) {
      logger.error(`Failed to install VS Code extension hook: ${(err as Error).message}`);
    }
  }

  async uninstall(): Promise<void> {
    try {
      const settingsPath = getVSCodeSettingsPath();
      if (!fs.existsSync(settingsPath)) return;

      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));

      // Only remove if Puffer set it
      if (settings['puffer.installed']) {
        // Clean up current markers
        delete settings['puffer.installed'];
        delete settings['puffer.proxyPort'];
        // Also clean up legacy http.proxy if a previous Puffer version set it
        if (
          typeof settings['http.proxy'] === 'string' &&
          (settings['http.proxy'] as string).includes('127.0.0.1')
        ) {
          delete settings['http.proxy'];
          delete settings['http.proxyStrictSSL'];
        }

        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
        logger.info('VS Code proxy configuration removed');
      }

      this.installed = false;
    } catch (err) {
      logger.error(`Failed to uninstall VS Code extension hook: ${(err as Error).message}`);
    }
  }

  isInstalled(): boolean {
    return this.installed;
  }

  /**
   * VS Code extension provides partial protection for Copilot
   * (can capture some traffic but not proprietary completions).
   */
  getProtectionLevel(): 'partial' | 'protected' {
    return 'partial';
  }
}
