import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { HookHandler } from './index.js';
import { logger } from '@puffer/core';
import { DEFAULT_PROXY_PORT } from '@puffer/core';

const OPENCLAW_GATEWAY = 'http://127.0.0.1:18789';
const OPENCLAW_CONFIG_PATH = path.join(os.homedir(), '.openclaw', 'openclaw.json');

/**
 * OpenClaw integration.
 *
 * OpenClaw does NOT support outbound webhooks or pre-action interceptors via
 * HTTP — verified against the upstream gateway and docs at openclaw/openclaw.
 * Plugins exist but only load in-process via filesystem (not via HTTP register).
 *
 * The supported observability path is: configure OpenClaw's provider `baseUrl`
 * to point at Puffer's reverse-proxy (`http://127.0.0.1:<proxyPort>`). All LLM
 * traffic then flows through Puffer with full request / response / token / cost
 * capture and blocking capability — same path the proxy uses for any other
 * agent.
 *
 * On install we don't mutate OpenClaw's config (would clobber user settings).
 * Instead we detect the gateway, inspect its config, and surface a clear
 * actionable warning if the user has not yet routed through Puffer.
 */
export class OpenClawHook implements HookHandler {
  name = 'openclaw';
  private installed = false;
  private proxyPort: number;

  constructor(_dashboardPort?: number, proxyPort: number = DEFAULT_PROXY_PORT) {
    this.proxyPort = proxyPort;
  }

  private async isGatewayAlive(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);
      try {
        const res = await fetch(`${OPENCLAW_GATEWAY}/health`, { signal: controller.signal });
        return res.ok;
      } finally {
        clearTimeout(timeout);
      }
    } catch {
      return false;
    }
  }

  /**
   * Look at ~/.openclaw/openclaw.json and decide whether OpenClaw is already
   * routing LLM traffic through Puffer's proxy. We only check Anthropic and
   * OpenAI provider overrides — those are the two providers Puffer's proxy
   * resolves natively today.
   */
  private isRoutedThroughPuffer(): { routed: boolean; configExists: boolean } {
    if (!fs.existsSync(OPENCLAW_CONFIG_PATH)) {
      return { routed: false, configExists: false };
    }
    try {
      const raw = fs.readFileSync(OPENCLAW_CONFIG_PATH, 'utf-8');
      const cfg = JSON.parse(raw) as {
        models?: { providers?: Record<string, { baseUrl?: string }> };
      };
      const providers = cfg.models?.providers ?? {};
      const expectedHost = `127.0.0.1:${this.proxyPort}`;
      // Routed if at least one of anthropic/openai points at our proxy.
      const matches = (id: string): boolean => {
        const url = providers[id]?.baseUrl;
        return !!url && url.includes(expectedHost);
      };
      return { routed: matches('anthropic') || matches('openai'), configExists: true };
    } catch (err) {
      logger.warn(
        `OpenClaw config unreadable at ${OPENCLAW_CONFIG_PATH}: ${(err as Error).message}`,
      );
      return { routed: false, configExists: true };
    }
  }

  async install(): Promise<void> {
    const alive = await this.isGatewayAlive();
    if (!alive) {
      // Not a hard error — discovery may detect OpenClaw later. We'll re-check on next start.
      return;
    }

    const { routed, configExists } = this.isRoutedThroughPuffer();
    if (routed) {
      logger.info('OpenClaw is routed through Puffer proxy — full observability active');
      this.installed = true;
      return;
    }

    // Gateway is up but config does not point at Puffer. Emit a single,
    // actionable warning. We do NOT modify the user's config automatically.
    if (!configExists) {
      logger.warn(
        `OpenClaw gateway detected at ${OPENCLAW_GATEWAY} but no config found at ${OPENCLAW_CONFIG_PATH}. ` +
          'Run `openclaw onboard` first, then point its providers at Puffer (see docs/architecture/openclaw.md).',
      );
    } else {
      logger.warn(
        `OpenClaw is running but its providers are not routed through Puffer. ` +
          `Add to ${OPENCLAW_CONFIG_PATH}: models.providers.anthropic.baseUrl="http://127.0.0.1:${this.proxyPort}" ` +
          '(see docs/architecture/openclaw.md for full snippet).',
      );
    }

    this.installed = false;
  }

  async uninstall(): Promise<void> {
    // Nothing to undo — we never mutated OpenClaw's config.
    this.installed = false;
  }

  isInstalled(): boolean {
    return this.installed;
  }
}
