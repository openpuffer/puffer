import { describe, it, expect } from 'vitest';
import type { SkillManifest } from '@puffer/core';
import {
  filterAndSortSkills,
  agentSourceFilter,
} from '../../apps/dashboard/src/lib/skillHelpers.js';

const makeSkill = (overrides: Partial<SkillManifest>): SkillManifest => ({
  id: `claude-code-global/${overrides.name ?? 'skill'}`,
  name: overrides.name ?? 'skill',
  source: 'claude-code-global',
  rootPath: '/home/user/.claude/skills/skill',
  manifestPath: null,
  description: overrides.description ?? 'A skill',
  contentHash: 'abc123abc123abc123abc123abc123abc123abc123abc123abc123abc123abc1',
  lastModified: overrides.lastModified ?? '2026-01-01T00:00:00.000Z',
  sizeBytes: overrides.sizeBytes ?? 1024,
  fileCount: 2,
  ...overrides,
});

const ALPHA_SKILL = makeSkill({
  name: 'alpha',
  description: 'alpha desc',
  source: 'claude-code-global',
});
const BETA_SKILL = makeSkill({
  name: 'beta',
  description: 'beta desc',
  source: 'claude-code-project',
  id: 'claude-code-project/beta',
});
const GAMMA_SKILL = makeSkill({
  name: 'gamma',
  description: 'gamma desc',
  source: 'openclaw-bundled',
  id: 'openclaw-bundled/gamma',
  sizeBytes: 4096,
});
const NEWEST_SKILL = makeSkill({
  name: 'newest',
  source: 'claude-code-global',
  lastModified: '2026-05-01T00:00:00.000Z',
  sizeBytes: 512,
});

const ALL_SKILLS = [ALPHA_SKILL, BETA_SKILL, GAMMA_SKILL, NEWEST_SKILL];

// ── filterAndSortSkills ──────────────────────────────────────────────────────

describe('filterAndSortSkills', () => {
  it('returns all skills when query is empty and no source filter', () => {
    const result = filterAndSortSkills(ALL_SKILLS, '', new Set(), 'alpha');
    expect(result).toHaveLength(4);
  });

  it('filters by name case-insensitively', () => {
    const result = filterAndSortSkills(ALL_SKILLS, 'ALPHA', new Set(), 'alpha');
    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe('alpha');
  });

  it('filters by description case-insensitively', () => {
    const result = filterAndSortSkills(ALL_SKILLS, 'gamma desc', new Set(), 'alpha');
    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe('gamma');
  });

  it('filters by source when activeSources is non-empty', () => {
    const result = filterAndSortSkills(ALL_SKILLS, '', new Set(['openclaw-bundled']), 'alpha');
    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe('gamma');
  });

  it('sorts alphabetically when sortKey is alpha', () => {
    const result = filterAndSortSkills(ALL_SKILLS, '', new Set(), 'alpha');
    const names = result.map((s: SkillManifest) => s.name);
    expect(names).toEqual(['alpha', 'beta', 'gamma', 'newest']);
  });

  it('sorts by size descending when sortKey is size', () => {
    const result = filterAndSortSkills(ALL_SKILLS, '', new Set(), 'size');
    expect(result[0]?.name).toBe('gamma'); // 4096 bytes is largest
  });

  it('sorts by lastModified descending when sortKey is modified', () => {
    const result = filterAndSortSkills(ALL_SKILLS, '', new Set(), 'modified');
    expect(result[0]?.name).toBe('newest'); // most recently modified
  });

  it('returns empty array when query matches nothing', () => {
    const result = filterAndSortSkills(ALL_SKILLS, 'does-not-exist-xyz', new Set(), 'alpha');
    expect(result).toHaveLength(0);
  });
});

// ── agentSourceFilter ────────────────────────────────────────────────────────

describe('agentSourceFilter', () => {
  it('returns claude-code sources for claude-code agent', () => {
    const sources = agentSourceFilter('claude-code');
    expect(sources).toContain('claude-code-global');
    expect(sources).toContain('claude-code-project');
  });

  it('returns claude-code sources for case variations', () => {
    const sources = agentSourceFilter('CLAUDE-CODE');
    expect(sources).toContain('claude-code-global');
    expect(sources).toContain('claude-code-project');
  });

  it('returns openclaw sources for openclaw agent', () => {
    const sources = agentSourceFilter('openclaw');
    expect(sources).toContain('openclaw-bundled');
    expect(sources).toContain('openclaw-user');
  });

  it('returns empty array for unknown agent types', () => {
    const sources = agentSourceFilter('vscode-copilot');
    expect(sources).toHaveLength(0);
  });

  it('returns claude-code sources for sub-agent with claude in name', () => {
    const sources = agentSourceFilter('claude-code-subagent');
    expect(sources).toContain('claude-code-global');
  });
});
