import { describe, it, expect } from 'vitest';
import { skillGovernanceLayer } from '@puffer/layer-skills';
import type { PufferEvent, SkillsConfig } from '@puffer/core';

function makeSkillEvent(
  skill: { id: string; name: string; contentHash?: string },
  args?: Record<string, unknown>,
): PufferEvent {
  return {
    id: 'test-skill',
    timestamp: new Date().toISOString(),
    source: { type: 'hook', agent: 'claude-code', provider: 'claude-code' },
    action: { type: 'skill_invoke', skill, args },
    metadata: { sessionId: 'sess-1', sequenceNumber: 1 },
    layers: [],
    decision: null,
  };
}

function makeNonSkillEvent(): PufferEvent {
  return {
    id: 'test-other',
    timestamp: new Date().toISOString(),
    source: { type: 'hook', agent: 'claude-code', provider: 'claude-code' },
    action: { type: 'command_execute', command: 'ls', args: [] },
    metadata: { sessionId: 'sess-1', sequenceNumber: 1 },
    layers: [],
    decision: null,
  };
}

const emptyConfig: SkillsConfig = {
  enabled: true,
  policy: 'monitor',
  allowlist: [],
  denylist: [],
  scan_interval_ms: 30000,
};

describe('skillGovernanceLayer', () => {
  it('should block skill in denylist (exact name match)', async () => {
    const config: SkillsConfig = { ...emptyConfig, denylist: ['evil-skill'] };
    const event = makeSkillEvent({ id: 'claude-code-global/evil-skill', name: 'evil-skill' });
    const result = await skillGovernanceLayer(event, config);
    expect(result.verdict).toBe('block');
    expect(result.details).toContain('denylist');
    expect(result.confidence).toBe(1);
  });

  it('should block skill matching denylist glob "*-bad"', async () => {
    const config: SkillsConfig = { ...emptyConfig, denylist: ['*-bad'] };
    const event = makeSkillEvent({ id: 'claude-code-global/very-bad', name: 'very-bad' });
    const result = await skillGovernanceLayer(event, config);
    expect(result.verdict).toBe('block');
    expect(result.details).toContain('denylist');
  });

  it('should block skill matching denylist sha256 prefix', async () => {
    const hash = 'abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234';
    const config: SkillsConfig = { ...emptyConfig, denylist: [`sha256:${hash}`] };
    const event = makeSkillEvent({
      id: 'claude-code-global/some-skill',
      name: 'some-skill',
      contentHash: hash,
    });
    const result = await skillGovernanceLayer(event, config);
    expect(result.verdict).toBe('block');
    expect(result.details).toContain('denylist');
  });

  it('should allow skill in allowlist (exact name match)', async () => {
    const config: SkillsConfig = { ...emptyConfig, allowlist: ['good-skill'] };
    const event = makeSkillEvent({ id: 'claude-code-global/good-skill', name: 'good-skill' });
    const result = await skillGovernanceLayer(event, config);
    expect(result.verdict).toBe('allow');
    expect(result.confidence).toBe(1);
  });

  it('should block skill NOT in allowlist when allowlist is non-empty', async () => {
    const config: SkillsConfig = { ...emptyConfig, allowlist: ['good-skill'] };
    const event = makeSkillEvent({ id: 'claude-code-global/unknown-skill', name: 'unknown-skill' });
    const result = await skillGovernanceLayer(event, config);
    expect(result.verdict).toBe('block');
    expect(result.details).toContain('not in allowlist');
    expect(result.confidence).toBe(1);
  });

  it('should allow by default when allowlist and denylist are both empty', async () => {
    const event = makeSkillEvent({ id: 'claude-code-global/any-skill', name: 'any-skill' });
    const result = await skillGovernanceLayer(event, emptyConfig);
    expect(result.verdict).toBe('allow');
  });

  it('should block when skill is in BOTH allowlist and denylist (denylist wins)', async () => {
    const config: SkillsConfig = {
      ...emptyConfig,
      allowlist: ['shared-skill'],
      denylist: ['shared-skill'],
    };
    const event = makeSkillEvent({ id: 'claude-code-global/shared-skill', name: 'shared-skill' });
    const result = await skillGovernanceLayer(event, config);
    expect(result.verdict).toBe('block');
    expect(result.details).toContain('denylist');
  });

  it('should return allow with "Not applicable" for non-skill_invoke events', async () => {
    const event = makeNonSkillEvent();
    const result = await skillGovernanceLayer(event, emptyConfig);
    expect(result.verdict).toBe('allow');
    expect(result.details).toBe('Not applicable to this event type');
  });

  it('should allow skill matching allowlist glob pattern', async () => {
    const config: SkillsConfig = { ...emptyConfig, allowlist: ['openclaw-*'] };
    const event = makeSkillEvent({
      id: 'openclaw-bundled/openclaw-summarize',
      name: 'openclaw-summarize',
    });
    const result = await skillGovernanceLayer(event, config);
    expect(result.verdict).toBe('allow');
  });

  it('should always return confidence of 1 for skills layer verdicts', async () => {
    const blockConfig: SkillsConfig = { ...emptyConfig, denylist: ['bad-skill'] };
    const blockEvent = makeSkillEvent({ id: 'x/bad-skill', name: 'bad-skill' });
    const blockResult = await skillGovernanceLayer(blockEvent, blockConfig);
    expect(blockResult.confidence).toBe(1);

    const allowResult = await skillGovernanceLayer(
      makeSkillEvent({ id: 'x/ok', name: 'ok' }),
      emptyConfig,
    );
    expect(allowResult.confidence).toBe(1);
  });
});
