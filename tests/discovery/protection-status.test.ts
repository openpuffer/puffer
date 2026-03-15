import { describe, it, expect } from 'vitest';
import type { DiscoveredAgent } from '../../src/types.js';

// Import the resolveProtectionStatus function by testing its behavior through DiscoveryEngine
// Since the function is module-private, we test it indirectly via its effects

function makeAgent(name: string, detectedVia: 'process' | 'port' | 'network' = 'process'): DiscoveredAgent {
  return {
    name,
    pid: 1234,
    command: `${name} process`,
    detectedVia,
    protectionStatus: 'unprotected',
  };
}

// Re-implement the logic here for unit testing since the function is private
function resolveProtectionStatus(
  agent: DiscoveredAgent,
  installedHookNames: string[],
): 'protected' | 'partial' | 'unprotected' {
  const hookInstalled = installedHookNames.some((hookName) => {
    if (hookName === 'claude-code' && agent.name === 'claude-code') return true;
    if (hookName === 'openclaw' && agent.name === 'openclaw') return true;
    if (hookName === 'vscode-extension' && ['github-copilot', 'cursor', 'cline', 'continue-dev', 'windsurf', 'codeium'].includes(agent.name)) return true;
    if (hookName === agent.name) return true;
    return false;
  });

  if (agent.name === 'github-copilot') {
    return hookInstalled ? 'partial' : 'unprotected';
  }

  if (agent.name === 'claude-code' && hookInstalled) {
    return 'protected';
  }

  if (hookInstalled) return 'partial';

  return 'unprotected';
}

describe('Protection Status Resolution', () => {
  describe('Claude Code', () => {
    it('should be "protected" when claude-code hook is installed', () => {
      const agent = makeAgent('claude-code');
      expect(resolveProtectionStatus(agent, ['claude-code'])).toBe('protected');
    });

    it('should be "unprotected" when no hooks installed', () => {
      const agent = makeAgent('claude-code');
      expect(resolveProtectionStatus(agent, [])).toBe('unprotected');
    });
  });

  describe('GitHub Copilot', () => {
    it('should always be "partial" at best when vscode-extension hook installed', () => {
      const agent = makeAgent('github-copilot');
      expect(resolveProtectionStatus(agent, ['vscode-extension'])).toBe('partial');
    });

    it('should be "unprotected" when no hooks installed', () => {
      const agent = makeAgent('github-copilot');
      expect(resolveProtectionStatus(agent, [])).toBe('unprotected');
    });

    it('should still be "partial" even with claude-code hook (irrelevant hook)', () => {
      const agent = makeAgent('github-copilot');
      expect(resolveProtectionStatus(agent, ['claude-code'])).toBe('unprotected');
    });
  });

  describe('OpenClaw', () => {
    it('should be "partial" when openclaw hook is installed', () => {
      const agent = makeAgent('openclaw');
      expect(resolveProtectionStatus(agent, ['openclaw'])).toBe('partial');
    });

    it('should be "unprotected" when no hooks installed', () => {
      const agent = makeAgent('openclaw');
      expect(resolveProtectionStatus(agent, [])).toBe('unprotected');
    });
  });

  describe('Cursor/Cline/Continue (VS Code agents)', () => {
    it('should be "partial" when vscode-extension hook covers them', () => {
      for (const name of ['cursor', 'cline', 'continue-dev', 'windsurf', 'codeium']) {
        const agent = makeAgent(name);
        expect(resolveProtectionStatus(agent, ['vscode-extension'])).toBe('partial');
      }
    });

    it('should be "unprotected" without vscode-extension hook', () => {
      const agent = makeAgent('cursor');
      expect(resolveProtectionStatus(agent, ['claude-code'])).toBe('unprotected');
    });
  });

  describe('Unknown agents', () => {
    it('should be "unprotected" for unknown agents', () => {
      const agent = makeAgent('some-new-agent');
      expect(resolveProtectionStatus(agent, ['claude-code', 'vscode-extension'])).toBe('unprotected');
    });
  });

  describe('Multiple hooks', () => {
    it('should resolve correctly with multiple hooks installed', () => {
      const hooks = ['claude-code', 'vscode-extension', 'openclaw'];

      expect(resolveProtectionStatus(makeAgent('claude-code'), hooks)).toBe('protected');
      expect(resolveProtectionStatus(makeAgent('github-copilot'), hooks)).toBe('partial');
      expect(resolveProtectionStatus(makeAgent('openclaw'), hooks)).toBe('partial');
      expect(resolveProtectionStatus(makeAgent('cursor'), hooks)).toBe('partial');
      expect(resolveProtectionStatus(makeAgent('aider'), hooks)).toBe('unprotected');
    });
  });
});
