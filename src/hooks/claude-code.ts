import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { HookHandler } from './index.js';
import { logger } from '../utils/logger.js';
import { DEFAULT_DASHBOARD_PORT } from '../utils/constants.js';

const CLAUDE_SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json');

const PUFFER_PRE_COMMAND = `curl -s -X POST http://127.0.0.1:${DEFAULT_DASHBOARD_PORT}/hooks/claude-code -H "Content-Type: application/json" -d @-`;
const PUFFER_POST_COMMAND = `curl -s -X POST http://127.0.0.1:${DEFAULT_DASHBOARD_PORT}/hooks/claude-code-response -H "Content-Type: application/json" -d @-`;

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
 * Registers a PreToolUse hook in ~/.claude/settings.json using the correct
 * nested format: { matcher, hooks: [{ type, command, timeout }] }
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

      const hooks = (settings.hooks ?? {}) as Record<string, unknown[]>;
      let preToolUse = (hooks.PreToolUse ?? []) as Record<string, unknown>[];

      // Remove ALL existing Puffer entries (old format, duplicates, etc.)
      preToolUse = preToolUse.filter((entry) => !isPufferEntry(entry));

      // Add Puffer PreToolUse hook
      preToolUse.push({
        matcher: '.*',
        hooks: [
          {
            type: 'command',
            command: PUFFER_PRE_COMMAND,
            timeout: 30,
          },
        ],
      });
      hooks.PreToolUse = preToolUse;

      // Add Puffer PostToolUse hook (captures response path)
      let postToolUse = (hooks.PostToolUse ?? []) as Record<string, unknown>[];
      postToolUse = postToolUse.filter((entry) => !isPufferEntry(entry));
      postToolUse.push({
        matcher: '.*',
        hooks: [
          {
            type: 'command',
            command: PUFFER_POST_COMMAND,
            timeout: 30,
          },
        ],
      });
      hooks.PostToolUse = postToolUse;

      settings.hooks = hooks;

      fs.writeFileSync(CLAUDE_SETTINGS_PATH, JSON.stringify(settings, null, 2));
      logger.info('Claude Code hooks installed (PreToolUse + PostToolUse, matcher: .*)');

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
        if (hooks.PreToolUse) {
          hooks.PreToolUse = (hooks.PreToolUse as Record<string, unknown>[]).filter(
            (entry) => !isPufferEntry(entry)
          );
        }
        if (hooks.PostToolUse) {
          hooks.PostToolUse = (hooks.PostToolUse as Record<string, unknown>[]).filter(
            (entry) => !isPufferEntry(entry)
          );
        }
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
