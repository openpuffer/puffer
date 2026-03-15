import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { HookHandler } from './index.js';
import { logger } from '../utils/logger.js';
import { DEFAULT_PROXY_PORT } from '../utils/constants.js';

const PUFFER_EXT_ID = 'puffer.puffer-security';

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
    return path.join(process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming'), 'Code', 'User', 'settings.json');
  }
  return path.join(home, '.config', 'Code', 'User', 'settings.json');
}

/**
 * Check if VS Code CLI is available.
 */
function isVSCodeAvailable(): boolean {
  try {
    execSync('code --version', { stdio: 'ignore', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
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

      // Configure HTTP proxy for VS Code
      // This routes extension HTTP traffic through Puffer
      const proxyUrl = `http://127.0.0.1:${this.proxyPort}`;
      settings['http.proxy'] = proxyUrl;
      settings['http.proxyStrictSSL'] = false;

      // Mark that Puffer configured this
      settings['puffer.installed'] = true;
      settings['puffer.proxyPort'] = this.proxyPort;

      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

      this.installed = true;
      logger.info(`VS Code HTTP proxy configured to ${proxyUrl}`);
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
        delete settings['http.proxy'];
        delete settings['http.proxyStrictSSL'];
        delete settings['puffer.installed'];
        delete settings['puffer.proxyPort'];

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
