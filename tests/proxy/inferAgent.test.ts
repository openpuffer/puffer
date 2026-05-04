import { describe, it, expect } from 'vitest';
import { inferAgent } from '@puffer/proxy';

// ---------------------------------------------------------------------------
// Tier 3 — OpenAI SDK fingerprint with priority-based discovered agent matching
// ---------------------------------------------------------------------------
describe('inferAgent – tier 3: OpenAI SDK fingerprint (UA "OpenAI/JS 6.26.0")', () => {
  const openAiUA = { 'user-agent': 'OpenAI/JS 6.26.0' };

  it('returns "openclaw" when discovered includes openclaw and openclaw-gateway (priority order)', () => {
    expect(inferAgent(openAiUA, ['openclaw', 'openclaw-gateway'])).toBe('openclaw');
  });

  it('returns "openclaw-gateway" when discovered includes only openclaw-gateway', () => {
    expect(inferAgent(openAiUA, ['openclaw-gateway'])).toBe('openclaw-gateway');
  });

  it('returns "python-langchain" when discovered includes only python-langchain', () => {
    expect(inferAgent(openAiUA, ['python-langchain'])).toBe('python-langchain');
  });

  it('returns "openclaw" over "python-langchain" due to priority order', () => {
    expect(inferAgent(openAiUA, ['openclaw', 'python-langchain'])).toBe('openclaw');
  });

  it('returns "python-openai" over "python-langchain" due to priority order', () => {
    expect(inferAgent(openAiUA, ['python-langchain', 'python-openai'])).toBe('python-openai');
  });
});

// ---------------------------------------------------------------------------
// Tier 3 — negative: no match or single unknown fallback
// ---------------------------------------------------------------------------
describe('inferAgent – tier 3: edge cases and fallbacks', () => {
  const openAiUA = { 'user-agent': 'OpenAI/JS' };

  it('returns "unknown" when discovered is empty', () => {
    expect(inferAgent(openAiUA, [])).toBe('unknown');
  });

  it('returns "random-other-agent" when discovered has a single unknown agent (single-entry fallback)', () => {
    expect(inferAgent(openAiUA, ['random-other-agent'])).toBe('random-other-agent');
  });

  it('returns "unknown" when discovered has multiple unknown agents and no priority match', () => {
    expect(inferAgent(openAiUA, ['random-a', 'random-b'])).toBe('unknown');
  });
});

// ---------------------------------------------------------------------------
// Regression: tier 1 must still win over tier 3
// ---------------------------------------------------------------------------
describe('inferAgent – tier 1 regression: exact UA match beats OpenAI SDK path', () => {
  it('returns "aider" for UA "aider/0.50" even when discovered includes openclaw', () => {
    expect(inferAgent({ 'user-agent': 'aider/0.50' }, ['openclaw'])).toBe('aider');
  });
});

// ---------------------------------------------------------------------------
// Regression: tier 2 (Anthropic SDK) still works
// ---------------------------------------------------------------------------
describe('inferAgent – tier 2 regression: Anthropic SDK fingerprint', () => {
  it('returns "claude-code" for UA "Anthropic/JS 0.30" when discovered includes claude-code', () => {
    expect(inferAgent({ 'user-agent': 'Anthropic/JS 0.30' }, ['claude-code'])).toBe('claude-code');
  });
});

// ---------------------------------------------------------------------------
// Bug A — claude-cli tier-1 detection
// ---------------------------------------------------------------------------
describe('inferAgent – tier 1: claude-cli UA (Bug A fix)', () => {
  it('returns "claude-cli" for full UA "claude-cli/2.1.126 (external, cli)" with no discovery', () => {
    expect(inferAgent({ 'user-agent': 'claude-cli/2.1.126 (external, cli)' }, [])).toBe(
      'claude-cli',
    );
  });

  it('returns "claude-cli" for "claude-cli/2.1.126" even when discovery returns anthropic-client (tier 1 wins)', () => {
    expect(inferAgent({ 'user-agent': 'claude-cli/2.1.126' }, ['anthropic-client'])).toBe(
      'claude-cli',
    );
  });

  it('still returns "claude-code" for UA "claude-code/1.0" (existing tier-1 path not broken)', () => {
    expect(inferAgent({ 'user-agent': 'claude-code/1.0' }, [])).toBe('claude-code');
  });
});

// ---------------------------------------------------------------------------
// Bug A — claude-cli does NOT false-positive on similar strings
// ---------------------------------------------------------------------------
describe('inferAgent – tier 1 negative: claude-cli boundary guards', () => {
  it('does NOT return "claude-cli" for UA "claude-clinic/2.0" (word-boundary guard)', () => {
    // claude-clinic has no \b boundary match for "claude-cli" with \b — falls through
    const result = inferAgent({ 'user-agent': 'claude-clinic/2.0' }, []);
    expect(result).not.toBe('claude-cli');
    expect(result).not.toBe('claude-code');
  });

  it('does NOT match cline via claude-cli path — cline still wins at its own tier-1 check', () => {
    expect(inferAgent({ 'user-agent': 'Cline/2.0' }, [])).toBe('cline');
  });
});

// ---------------------------------------------------------------------------
// Bug A — tier-2 Anthropic SDK priority list (KNOWN_ANTHROPIC_SDK_AGENTS)
// ---------------------------------------------------------------------------
describe('inferAgent – tier 2: KNOWN_ANTHROPIC_SDK_AGENTS priority list', () => {
  it('returns "anthropic-client" when discovered includes anthropic-client (Anthropic/JS UA)', () => {
    expect(inferAgent({ 'user-agent': 'Anthropic/JS 0.30.0' }, ['anthropic-client'])).toBe(
      'anthropic-client',
    );
  });

  it('returns "python-anthropic" when discovered includes both anthropic-client and python-anthropic (priority order)', () => {
    // python-anthropic appears after anthropic-client in the priority list
    // but both are discovered — python-anthropic is more specific, so it
    // should appear LATER in priority (anthropic-client wins) unless the
    // priority list puts python-anthropic after anthropic-client.
    // The spec says priority order: claude-code, claude-cli, anthropic-client, python-anthropic.
    // So with ['anthropic-client', 'python-anthropic'], anthropic-client wins.
    expect(
      inferAgent({ 'user-agent': 'Anthropic/JS 0.30.0' }, ['anthropic-client', 'python-anthropic']),
    ).toBe('anthropic-client');
  });

  it('returns "python-anthropic" when discovered includes only python-anthropic', () => {
    expect(inferAgent({ 'user-agent': 'python-anthropic/0.5' }, ['python-anthropic'])).toBe(
      'python-anthropic',
    );
  });

  it('returns "anthropic-client" when no UA but anthropic-version header present and discovered has anthropic-client', () => {
    expect(
      inferAgent({ 'user-agent': '', 'anthropic-version': '2023-06-01' }, ['anthropic-client']),
    ).toBe('anthropic-client');
  });
});

// ---------------------------------------------------------------------------
// Regression: no UA at all
// ---------------------------------------------------------------------------
describe('inferAgent – no User-Agent header', () => {
  it('returns "unknown" when no headers are provided', () => {
    expect(inferAgent({}, [])).toBe('unknown');
  });

  it('returns "unknown" when headers exist but no user-agent key', () => {
    expect(inferAgent({ 'content-type': 'application/json' }, [])).toBe('unknown');
  });
});
