import { HookHandler } from './index.js';
import { logger } from '../utils/logger.js';
import { DEFAULT_DASHBOARD_PORT } from '../utils/constants.js';

const OPENCLAW_GATEWAY = 'http://127.0.0.1:18789';

/**
 * OpenClaw hook integration.
 * Registers as a security middleware skill on the OpenClaw gateway,
 * intercepting all actions before and after execution.
 */
export class OpenClawHook implements HookHandler {
  name = 'openclaw';
  private installed = false;
  private dashboardPort: number;

  constructor(dashboardPort: number = DEFAULT_DASHBOARD_PORT) {
    this.dashboardPort = dashboardPort;
  }

  async install(): Promise<void> {
    try {
      // Check if OpenClaw gateway is reachable
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);

      let health: Response;
      try {
        health = await fetch(`${OPENCLAW_GATEWAY}/health`, { signal: controller.signal });
      } catch {
        logger.warn('OpenClaw gateway not reachable at port 18789, skipping skill registration');
        return;
      } finally {
        clearTimeout(timeout);
      }

      if (!health.ok) {
        logger.warn(`OpenClaw gateway returned ${health.status}, skipping skill registration`);
        return;
      }

      // Register as security middleware skill
      const registration = await fetch(`${OPENCLAW_GATEWAY}/api/skills/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'puffer-security',
          type: 'middleware',
          priority: 0, // Run before other skills
          hooks: {
            preAction: `http://127.0.0.1:${this.dashboardPort}/hooks/openclaw`,
            postAction: `http://127.0.0.1:${this.dashboardPort}/hooks/openclaw-response`,
          },
          description: 'Puffer AI security middleware - monitors and blocks dangerous agent actions',
          version: '0.1.0',
        }),
      });

      if (registration.ok) {
        this.installed = true;
        logger.info('OpenClaw skill registered as security middleware');
      } else {
        const body = await registration.text().catch(() => '');
        logger.warn(`OpenClaw skill registration failed: ${registration.status} ${body}`);
      }
    } catch (err) {
      logger.error(`Failed to install OpenClaw hook: ${(err as Error).message}`);
    }
  }

  async uninstall(): Promise<void> {
    if (!this.installed) return;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);

      await fetch(`${OPENCLAW_GATEWAY}/api/skills/unregister`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'puffer-security' }),
        signal: controller.signal,
      }).catch(() => {});

      clearTimeout(timeout);
      this.installed = false;
      logger.info('OpenClaw skill unregistered');
    } catch {
      // Ignore errors during uninstall — gateway may be down
    }
  }

  isInstalled(): boolean {
    return this.installed;
  }
}
