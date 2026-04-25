import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ClaudeCodeHook } from '@puffer/hooks';

const SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json');

describe('ClaudeCodeHook', () => {
  let originalContent: string | null = null;

  beforeEach(() => {
    // Backup existing settings
    if (fs.existsSync(SETTINGS_PATH)) {
      originalContent = fs.readFileSync(SETTINGS_PATH, 'utf-8');
    }
  });

  afterEach(() => {
    // Restore original settings
    if (originalContent !== null) {
      fs.writeFileSync(SETTINGS_PATH, originalContent);
    }
  });

  it('should install 3 hooks: PreToolUse, PostToolUse, Notification', async () => {
    const hook = new ClaudeCodeHook(8788, 8787);
    await hook.install();

    const settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
    expect(settings.hooks).toBeDefined();
    expect(settings.hooks.PreToolUse).toBeDefined();
    expect(settings.hooks.PostToolUse).toBeDefined();
    expect(settings.hooks.Notification).toBeDefined();

    // Check PreToolUse has the right command
    const pre = settings.hooks.PreToolUse.find(
      (e: Record<string, unknown>) =>
        Array.isArray(e.hooks) &&
        (e.hooks as Record<string, unknown>[]).some(
          (h) =>
            typeof h.command === 'string' && (h.command as string).includes('/hooks/claude-code'),
        ),
    );
    expect(pre).toBeDefined();
    expect(pre.matcher).toBe('.*');

    // Check Notification hook exists
    const notif = settings.hooks.Notification.find(
      (e: Record<string, unknown>) =>
        Array.isArray(e.hooks) &&
        (e.hooks as Record<string, unknown>[]).some(
          (h) =>
            typeof h.command === 'string' &&
            (h.command as string).includes('/hooks/claude-code-notification'),
        ),
    );
    expect(notif).toBeDefined();
  });

  it('should configure proxy auto-routing via ANTHROPIC_BASE_URL', async () => {
    const hook = new ClaudeCodeHook(8788, 8787);
    await hook.install();

    const settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
    expect(settings.env).toBeDefined();
    expect(settings.env.ANTHROPIC_BASE_URL).toBe('http://127.0.0.1:8787');
  });

  it('should use custom ports', async () => {
    const hook = new ClaudeCodeHook(9999, 9998);
    await hook.install();

    const settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
    expect(settings.env.ANTHROPIC_BASE_URL).toBe('http://127.0.0.1:9998');

    const pre = settings.hooks.PreToolUse[settings.hooks.PreToolUse.length - 1];
    const command = (pre.hooks as Record<string, unknown>[])[0].command as string;
    expect(command).toContain(':9999');
  });

  it('should uninstall all 3 hooks and proxy env', async () => {
    const hook = new ClaudeCodeHook(8788, 8787);
    await hook.install();
    expect(hook.isInstalled()).toBe(true);

    await hook.uninstall();
    expect(hook.isInstalled()).toBe(false);

    const settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));

    // No Puffer entries in any hook type
    for (const hookType of ['PreToolUse', 'PostToolUse', 'Notification']) {
      const entries = settings.hooks[hookType] ?? [];
      const hasPuffer = entries.some(
        (e: Record<string, unknown>) =>
          Array.isArray(e.hooks) &&
          (e.hooks as Record<string, unknown>[]).some(
            (h) =>
              typeof h.command === 'string' && (h.command as string).includes('/hooks/claude-code'),
          ),
      );
      expect(hasPuffer).toBe(false);
    }

    // Proxy env removed
    expect(settings.env?.ANTHROPIC_BASE_URL).toBeUndefined();
  });

  it('should not duplicate hooks on repeated installs', async () => {
    const hook = new ClaudeCodeHook(8788, 8787);
    await hook.install();
    await hook.install();
    await hook.install();

    const settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
    const pufferPre = settings.hooks.PreToolUse.filter(
      (e: Record<string, unknown>) =>
        Array.isArray(e.hooks) &&
        (e.hooks as Record<string, unknown>[]).some(
          (h) =>
            typeof h.command === 'string' && (h.command as string).includes('/hooks/claude-code'),
        ),
    );
    expect(pufferPre.length).toBe(1);
  });
});
