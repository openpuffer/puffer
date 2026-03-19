import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import { HookHandler } from './index.js';
import { logger } from '../utils/logger.js';
import { DEFAULT_DASHBOARD_PORT, DEFAULT_PROXY_PORT } from '../utils/constants.js';

const CLAUDE_SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json');

/** Match string present in Puffer hook commands */
const PUFFER_MARKER = `/hooks/claude-code`;

/**
 * Check if a PreToolUse entry contains a Puffer hook (old flat format or new nested format).
 */
function isPufferEntry(entry: Record<string, unknown>): boolean {
  // Old flat format: { type, command: "curl ... /hooks/claude-code ..." }
  if (typeof entry.command === 'string' && entry.command.includes(PUFFER_MARKER)) {
    return true;
  }
  // Also match if description says puffer
  if (typeof entry.description === 'string' && entry.description.toLowerCase().includes('puffer')) {
    return true;
  }
  // New nested format: { matcher, hooks: [{ command: "curl ... /hooks/claude-code ..." }] }
  if (Array.isArray(entry.hooks)) {
    return (entry.hooks as Record<string, unknown>[]).some(
      (h) => typeof h.command === 'string' && h.command.includes(PUFFER_MARKER)
    );
  }
  return false;
}

/**
 * Claude Code hook integration.
 * Registers PreToolUse, PostToolUse, and Notification hooks in ~/.claude/settings.json
 * using the nested format: { matcher, hooks: [{ type, command, timeout }] }
 *
 * Also configures proxy auto-routing via ANTHROPIC_BASE_URL env in settings.
 */
export class ClaudeCodeHook implements HookHandler {
  name = 'claude-code';
  private installed = false;
  private dashboardPort: number;
  private proxyPort: number;

  constructor(dashboardPort: number = DEFAULT_DASHBOARD_PORT, proxyPort: number = DEFAULT_PROXY_PORT) {
    this.dashboardPort = dashboardPort;
    this.proxyPort = proxyPort;
  }

  private getPreCommand(): string {
    return `curl -s -X POST http://127.0.0.1:${this.dashboardPort}/hooks/claude-code -H "Content-Type: application/json" -d @-`;
  }

  private getPostCommand(): string {
    return `curl -s -X POST http://127.0.0.1:${this.dashboardPort}/hooks/claude-code-response -H "Content-Type: application/json" -d @-`;
  }

  private getNotificationCommand(): string {
    return `curl -s -X POST http://127.0.0.1:${this.dashboardPort}/hooks/claude-code-notification -H "Content-Type: application/json" -d @-`;
  }

  /**
   * Quick check if a Puffer proxy is alive at the given port.
   */
  private async isProxyAlive(port: number): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const req = http.get(`http://127.0.0.1:${port}/__puffer/health`, (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      });
      req.on('error', () => resolve(false));
      req.setTimeout(1000, () => { req.destroy(); resolve(false); });
    });
  }

  async install(): Promise<void> {
    try {
      const settingsDir = path.dirname(CLAUDE_SETTINGS_PATH);
      if (!fs.existsSync(settingsDir)) {
        fs.mkdirSync(settingsDir, { recursive: true });
      }

      let settings: Record<string, unknown> = {};
      if (fs.existsSync(CLAUDE_SETTINGS_PATH)) {
        settings = JSON.parse(fs.readFileSync(CLAUDE_SETTINGS_PATH, 'utf-8'));
      }

      // Guard: if a stale ANTHROPIC_BASE_URL exists from a dead Puffer instance, clean it up
      const existingEnv = settings.env as Record<string, string> | undefined;
      if (existingEnv?.ANTHROPIC_BASE_URL?.includes('127.0.0.1')) {
        const existingPortMatch = existingEnv.ANTHROPIC_BASE_URL.match(/:(\d+)/);
        const existingPort = existingPortMatch ? parseInt(existingPortMatch[1], 10) : 0;
        if (existingPort > 0 && existingPort !== this.proxyPort) {
          // Different port — old instance. Check if alive.
          const alive = await this.isProxyAlive(existingPort);
          if (!alive) {
            logger.warn(`Removing stale ANTHROPIC_BASE_URL pointing to dead port ${existingPort}`);
            delete existingEnv.ANTHROPIC_BASE_URL;
            if (Object.keys(existingEnv).length === 0) delete settings.env;
          }
        }
      }

      const hooks = (settings.hooks ?? {}) as Record<string, unknown[]>;

      // --- PreToolUse hook ---
      let preToolUse = (hooks.PreToolUse ?? []) as Record<string, unknown>[];
      preToolUse = preToolUse.filter((entry) => !isPufferEntry(entry));
      preToolUse.push({
        matcher: '.*',
        hooks: [{ type: 'command', command: this.getPreCommand(), timeout: 30 }],
      });
      hooks.PreToolUse = preToolUse;

      // --- PostToolUse hook ---
      let postToolUse = (hooks.PostToolUse ?? []) as Record<string, unknown>[];
      postToolUse = postToolUse.filter((entry) => !isPufferEntry(entry));
      postToolUse.push({
        matcher: '.*',
        hooks: [{ type: 'command', command: this.getPostCommand(), timeout: 30 }],
      });
      hooks.PostToolUse = postToolUse;

      // --- Notification hook (session events, model changes, errors) ---
      let notification = (hooks.Notification ?? []) as Record<string, unknown>[];
      notification = notification.filter((entry) => !isPufferEntry(entry));
      notification.push({
        matcher: '.*',
        hooks: [{ type: 'command', command: this.getNotificationCommand(), timeout: 10 }],
      });
      hooks.Notification = notification;

      settings.hooks = hooks;

      // --- Proxy auto-configuration ---
      // Set env so Claude Code CLI routes API calls through Puffer proxy
      const env = (settings.env ?? {}) as Record<string, string>;
      env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${this.proxyPort}`;
      settings.env = env;

      fs.writeFileSync(CLAUDE_SETTINGS_PATH, JSON.stringify(settings, null, 2));
      logger.info('Claude Code hooks installed (PreToolUse + PostToolUse + Notification, proxy auto-config)');

      this.installed = true;
    } catch (err) {
      logger.error(`Failed to install Claude Code hook: ${(err as Error).message}`);
    }
  }

  async uninstall(): Promise<void> {
    try {
      if (!fs.existsSync(CLAUDE_SETTINGS_PATH)) return;

      const settings = JSON.parse(fs.readFileSync(CLAUDE_SETTINGS_PATH, 'utf-8'));
      const hooks = settings.hooks as Record<string, unknown[]> | undefined;
      if (hooks) {
        for (const hookType of ['PreToolUse', 'PostToolUse', 'Notification']) {
          if (hooks[hookType]) {
            hooks[hookType] = (hooks[hookType] as Record<string, unknown>[]).filter(
              (entry) => !isPufferEntry(entry)
            );
          }
        }
        fs.writeFileSync(CLAUDE_SETTINGS_PATH, JSON.stringify(settings, null, 2));
      }

      // Remove proxy env
      if (settings.env) {
        const env = settings.env as Record<string, string>;
        if (env.ANTHROPIC_BASE_URL?.includes('127.0.0.1')) {
          delete env.ANTHROPIC_BASE_URL;
          settings.env = Object.keys(env).length > 0 ? env : undefined;
          fs.writeFileSync(CLAUDE_SETTINGS_PATH, JSON.stringify(settings, null, 2));
        }
      }

      this.installed = false;
      logger.info('Claude Code hooks uninstalled');
    } catch (err) {
      logger.error(`Failed to uninstall Claude Code hook: ${(err as Error).message}`);
    }
  }

  isInstalled(): boolean {
    return this.installed;
  }
}
