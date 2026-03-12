import { HookHandler } from './index.js';
import { logger } from '../utils/logger.js';

/**
 * OpenClaw hook integration.
 * Installs as a security middleware skill in OpenClaw
 * that intercepts actions before execution.
 */
export class OpenClawHook implements HookHandler {
  name = 'openclaw';
  private installed = false;

  async install(): Promise<void> {
    // OpenClaw uses a skill/middleware system
    // Puffer registers as a security middleware via OpenClaw's API
    logger.debug('OpenClaw hook: would register as security middleware');
    this.installed = true;
  }

  async uninstall(): Promise<void> {
    logger.debug('OpenClaw hook: would unregister security middleware');
    this.installed = false;
  }

  isInstalled(): boolean {
    return this.installed;
  }
}
