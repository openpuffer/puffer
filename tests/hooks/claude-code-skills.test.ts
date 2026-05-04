import { describe, it, expect } from 'vitest';
import type { SkillInventory } from '@puffer/core';

/**
 * Tests for the Skill-tool detection path inside the dashboard's hook endpoint.
 *
 * The server-side hook logic lives in packages/dashboard/src/server.ts in the
 * `toolNameToAction` function. These tests exercise the pure mapping function
 * that converts a `Skill` tool call into a `skill_invoke` action.
 */
import { skillToolToAction } from '@puffer/dashboard';

const emptyInventory: SkillInventory = {
  scannedAt: new Date().toISOString(),
  skills: [],
  roots: [],
};

const filledInventory: SkillInventory = {
  scannedAt: new Date().toISOString(),
  skills: [
    {
      id: 'claude-code-global/simplify',
      name: 'simplify',
      source: 'claude-code-global',
      rootPath: '/home/user/.claude/skills/simplify',
      manifestPath: null,
      description: 'Simplify code',
      contentHash: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
      lastModified: new Date().toISOString(),
      sizeBytes: 100,
      fileCount: 1,
    },
  ],
  roots: [],
};

describe('skillToolToAction', () => {
  it('should emit skill_invoke action for Skill tool', () => {
    const action = skillToolToAction(
      'Skill',
      { skill: 'simplify', args: 'some args' },
      () => emptyInventory,
    );
    expect(action.type).toBe('skill_invoke');
    if (action.type === 'skill_invoke') {
      expect(action.skill.name).toBe('simplify');
      expect(action.skill.id).toBe('claude-code-global/simplify');
    }
  });

  it('should NOT emit skill_invoke for non-Skill tools', () => {
    const action = skillToolToAction('Bash', { command: 'ls' }, () => emptyInventory);
    expect(action.type).not.toBe('skill_invoke');
  });

  it('should preserve special characters in skill name and id', () => {
    const action = skillToolToAction('Skill', { skill: 'my_skill-v2.0' }, () => emptyInventory);
    expect(action.type).toBe('skill_invoke');
    if (action.type === 'skill_invoke') {
      expect(action.skill.name).toBe('my_skill-v2.0');
    }
  });

  it('should populate contentHash when inventory has matching skill', () => {
    const action = skillToolToAction('Skill', { skill: 'simplify' }, () => filledInventory);
    expect(action.type).toBe('skill_invoke');
    if (action.type === 'skill_invoke') {
      expect(action.skill.contentHash).toBe(
        'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
      );
    }
  });

  it('should omit contentHash when inventory has no matching skill', () => {
    const action = skillToolToAction('Skill', { skill: 'unknown-skill' }, () => filledInventory);
    expect(action.type).toBe('skill_invoke');
    if (action.type === 'skill_invoke') {
      expect(action.skill.contentHash).toBeUndefined();
    }
  });

  it('should handle plugin-namespaced skills (plugin:skill-name) literally', () => {
    const action = skillToolToAction('Skill', { skill: 'plugin:skill-name' }, () => emptyInventory);
    expect(action.type).toBe('skill_invoke');
    if (action.type === 'skill_invoke') {
      expect(action.skill.name).toBe('plugin:skill-name');
      expect(action.skill.id).toBe('claude-code-global/plugin:skill-name');
    }
  });
});
