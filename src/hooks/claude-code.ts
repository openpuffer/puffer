import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { HookHandler } from './index.js';
import { logger } from '../utils/logger.js';
import { DEFAULT_PROXY_PORT } from '../utils/constants.js';

const CLAUDE_SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json');

/**
 * Claude Code hook integration.
 * Registers a pre-tool-use hook in ~/.claude/settings.json
 * that sends tool calls to the Puffer daemon for evaluation.
 */
export class ClaudeCodeHook implements HookHandler {
  name = 'claude-code';
  private installed = false;

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

      // Add Puffer hook configuration
      const hooks = (settings.hooks ?? {}) as Record<string, unknown[]>;
      const preToolUse = (hooks.PreToolUse ?? []) as Record<string, unknown>[];

      // Check if Puffer hook already exists
      const existing = preToolUse.find(
        (h) => typeof h.command === 'string' && h.command.includes('puffer')
      );

      if (!existing) {
        preToolUse.push({
          type: 'command',
          command: `curl -s -X POST http://127.0.0.1:${DEFAULT_PROXY_PORT}/hooks/claude-code -H "Content-Type: application/json" -d @-`,
          description: 'Puffer security check',
        });
        hooks.PreToolUse = preToolUse;
        settings.hooks = hooks;

        fs.writeFileSync(CLAUDE_SETTINGS_PATH, JSON.stringify(settings, null, 2));
        logger.info('Claude Code hook installed');
      }

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
      if (hooks?.PreToolUse) {
        hooks.PreToolUse = (hooks.PreToolUse as Record<string, unknown>[]).filter(
          (h) => !(typeof h.command === 'string' && h.command.includes('puffer'))
        );
        fs.writeFileSync(CLAUDE_SETTINGS_PATH, JSON.stringify(settings, null, 2));
      }

      this.installed = false;
      logger.info('Claude Code hook uninstalled');
    } catch (err) {
      logger.error(`Failed to uninstall Claude Code hook: ${(err as Error).message}`);
    }
  }

  isInstalled(): boolean {
    return this.installed;
  }
}
