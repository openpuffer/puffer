import { describe, it, expect } from 'vitest';
import { findDraw, drawPuffer, type DrawFn } from '../../apps/dashboard/src/lib/agentIcons.js';

describe('agentIcons.findDraw', () => {
  it('resolves a known agent keyword to a DrawFn', () => {
    const fn = findDraw('claude-code');
    expect(typeof fn).toBe('function');
  });

  it('resolves different keywords to different DrawFns', () => {
    const claude = findDraw('claude-code');
    const openai = findDraw('openai');
    expect(claude).not.toBe(openai);
  });

  it('routes both subagent aliases to the same DrawFn', () => {
    expect(findDraw('subagent')).toBe(findDraw('claude-code-agent'));
  });

  it('does not route subagent alias to the plain claude DrawFn', () => {
    // ICON_DB ordering must match subagent entries before the generic claude entry
    // so 'claude-code-agent' resolves to drawSubagent, not drawClaude.
    expect(findDraw('claude-code-agent')).not.toBe(findDraw('claude-code'));
  });

  it('falls back to a generic DrawFn for unknown names', () => {
    const unknown = findDraw('unknown-name-xyz');
    const claude = findDraw('claude-code');
    const openai = findDraw('openai');
    expect(typeof unknown).toBe('function');
    expect(unknown).not.toBe(claude);
    expect(unknown).not.toBe(openai);
  });

  it('is case-insensitive', () => {
    expect(findDraw('OPENAI')).toBe(findDraw('openai'));
  });
});

describe('agentIcons.drawPuffer', () => {
  it('exports a DrawFn', () => {
    const fn: DrawFn = drawPuffer;
    expect(typeof fn).toBe('function');
  });
});
