import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { logEvent, withTraceContext } from '@puffer/observability';
import type { PufferEvent } from '@puffer/core';

function captureStdout(): { calls: string[]; restore: () => void } {
  const calls: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  // process.stdout.write has multiple overloads; the cast keeps the spy
  // honest about the only signature we use.
  process.stdout.write = ((chunk: string | Uint8Array) => {
    calls.push(typeof chunk === 'string' ? chunk : chunk.toString());
    return true;
  }) as typeof process.stdout.write;
  return { calls, restore: () => void (process.stdout.write = original) };
}

function captureStderr(): { calls: string[]; restore: () => void } {
  const calls: string[] = [];
  const original = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: string | Uint8Array) => {
    calls.push(typeof chunk === 'string' ? chunk : chunk.toString());
    return true;
  }) as typeof process.stderr.write;
  return { calls, restore: () => void (process.stderr.write = original) };
}

const sampleEvent: PufferEvent = {
  id: 'evt-abc-123',
  timestamp: '2026-04-25T19:00:00Z',
  source: {
    type: 'proxy',
    agent: 'claude-code',
    provider: 'anthropic',
    model: 'claude-sonnet-4-5',
  },
  action: { type: 'llm_request', method: 'POST', endpoint: '/v1/messages', body: {} },
  metadata: { sessionId: 's1', sequenceNumber: 1 },
  layers: [],
  decision: null,
};

describe('structured logEvent', () => {
  let stdout: ReturnType<typeof captureStdout>;
  let stderr: ReturnType<typeof captureStderr>;

  beforeEach(() => {
    stdout = captureStdout();
    stderr = captureStderr();
  });

  afterEach(() => {
    stdout.restore();
    stderr.restore();
    vi.restoreAllMocks();
  });

  it('emits a JSON line with trace_id, agent, provider, model', () => {
    logEvent(sampleEvent, 'info', 'request received');
    expect(stdout.calls).toHaveLength(1);
    const line = JSON.parse(stdout.calls[0] ?? '{}');
    expect(line.trace_id).toBe('evt-abc-123');
    expect(line.agent).toBe('claude-code');
    expect(line.provider).toBe('anthropic');
    expect(line.model).toBe('claude-sonnet-4-5');
    expect(line.level).toBe('info');
    expect(line.msg).toBe('request received');
  });

  it('omits model when the event source has no model', () => {
    const noModel: PufferEvent = {
      ...sampleEvent,
      source: { ...sampleEvent.source, model: undefined },
    };
    logEvent(noModel, 'info', 'no model here');
    const line = JSON.parse(stdout.calls[0] ?? '{}');
    expect('model' in line).toBe(false);
  });

  it('routes error level to stderr', () => {
    logEvent(sampleEvent, 'error', 'something broke');
    expect(stdout.calls).toHaveLength(0);
    expect(stderr.calls).toHaveLength(1);
    const line = JSON.parse(stderr.calls[0] ?? '{}');
    expect(line.level).toBe('error');
  });

  it('merges arbitrary extra fields into the line', () => {
    logEvent(sampleEvent, 'warn', 'rate limit close', {
      remaining_tokens: 1200,
      reset_in_seconds: 45,
    });
    expect(stderr.calls).toHaveLength(1);
    const line = JSON.parse(stderr.calls[0] ?? '{}');
    expect(line.remaining_tokens).toBe(1200);
    expect(line.reset_in_seconds).toBe(45);
  });

  it('withTraceContext returns a logger bound to one event', () => {
    const log = withTraceContext(sampleEvent);
    log.info('phase-1 done');
    log.info('phase-2 done', { layer: 'pii-scanner' });
    expect(stdout.calls).toHaveLength(2);
    const a = JSON.parse(stdout.calls[0] ?? '{}');
    const b = JSON.parse(stdout.calls[1] ?? '{}');
    expect(a.trace_id).toBe(b.trace_id);
    expect(a.trace_id).toBe('evt-abc-123');
    expect(b.layer).toBe('pii-scanner');
  });
});
