import { describe, it, expect } from 'vitest';
import { parseSSEStream, isStreamingContentType } from '@puffer/proxy';

describe('SSE parser', () => {
  it('extracts text from Anthropic content_block_delta events', () => {
    const stream = [
      'event: message_start',
      'data: {"type":"message_start","message":{"id":"x"}}',
      '',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello "}}',
      '',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"world"}}',
      '',
      'event: message_stop',
      'data: {"type":"message_stop"}',
      '',
    ].join('\n');

    const parsed = parseSSEStream(stream);
    expect(parsed.text).toBe('Hello world');
    expect(parsed.eventCount).toBe(4);
  });

  it('extracts text from OpenAI Chat Completions deltas with [DONE] sentinel', () => {
    const stream = [
      'data: {"choices":[{"delta":{"content":"Hello"}}]}',
      '',
      'data: {"choices":[{"delta":{"content":" world"}}]}',
      '',
      'data: [DONE]',
      '',
    ].join('\n');

    const parsed = parseSSEStream(stream);
    expect(parsed.text).toBe('Hello world');
    expect(parsed.completed).toBe(true);
  });

  it('skips malformed JSON payloads without throwing', () => {
    const stream = [
      'data: {valid json fail}',
      '',
      'data: {"choices":[{"delta":{"content":"OK"}}]}',
      '',
    ].join('\n');

    const parsed = parseSSEStream(stream);
    expect(parsed.text).toContain('OK');
    expect(parsed.eventCount).toBe(2);
  });

  it('still accumulates content for the audit pipeline when SSE carries PII', () => {
    const stream = [
      'data: {"choices":[{"delta":{"content":"My SSN is "}}]}',
      '',
      'data: {"choices":[{"delta":{"content":"123-45-6789"}}]}',
      '',
      'data: [DONE]',
      '',
    ].join('\n');

    // The post-hoc pipeline runs against parsed.text — the PII scanner
    // can match on this concatenated content even though no single
    // event contained the whole pattern.
    const parsed = parseSSEStream(stream);
    expect(parsed.text).toBe('My SSN is 123-45-6789');
  });

  it('detects streaming content types', () => {
    expect(isStreamingContentType({ 'content-type': 'text/event-stream' })).toBe(true);
    expect(isStreamingContentType({ 'content-type': 'text/event-stream; charset=utf-8' })).toBe(
      true,
    );
    expect(isStreamingContentType({ 'content-type': 'application/x-ndjson' })).toBe(true);
    expect(isStreamingContentType({ 'content-type': 'application/json' })).toBe(false);
    expect(isStreamingContentType(undefined)).toBe(false);
  });

  it('handles arrays of content-type headers (some upstreams duplicate)', () => {
    expect(
      isStreamingContentType({
        'content-type': ['text/event-stream', 'charset=utf-8'],
      }),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Bug B — tool-use streams (Anthropic input_json_delta)
// ---------------------------------------------------------------------------
describe('SSE parser – tool-use streams (Bug B fix)', () => {
  it('emits [tool:Edit] marker for a pure tool-use stream', () => {
    // Use JSON.stringify to build valid SSE data lines with nested JSON values.
    const mkDelta = (idx: number, partial: string) =>
      `data: ${JSON.stringify({ type: 'content_block_delta', index: idx, delta: { type: 'input_json_delta', partial_json: partial } })}`;
    const mkStart = (idx: number, name: string) =>
      `data: ${JSON.stringify({ type: 'content_block_start', index: idx, content_block: { type: 'tool_use', id: `tu_${idx}`, name } })}`;

    const stream = [
      'event: content_block_start',
      mkStart(0, 'Edit'),
      '',
      'event: content_block_delta',
      mkDelta(0, '{"path":'),
      '',
      'event: content_block_delta',
      mkDelta(0, '"foo.ts"}'),
      '',
      'event: message_delta',
      `data: ${JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'tool_use' } })}`,
      '',
    ].join('\n');

    const parsed = parseSSEStream(stream);
    expect(parsed.text).toBe('[tool:Edit] ');
  });

  it('emits multiple markers for multiple tool calls in one stream', () => {
    const mkDelta = (idx: number, partial: string) =>
      `data: ${JSON.stringify({ type: 'content_block_delta', index: idx, delta: { type: 'input_json_delta', partial_json: partial } })}`;
    const mkStart = (idx: number, name: string) =>
      `data: ${JSON.stringify({ type: 'content_block_start', index: idx, content_block: { type: 'tool_use', id: `tu_${idx}`, name } })}`;

    const stream = [
      'event: content_block_start',
      mkStart(0, 'Edit'),
      '',
      'event: content_block_delta',
      mkDelta(0, '{"x":1}'),
      '',
      'event: content_block_start',
      mkStart(1, 'Bash'),
      '',
      'event: content_block_delta',
      mkDelta(1, '{"cmd":"ls"}'),
      '',
      'event: content_block_start',
      mkStart(2, 'Write'),
      '',
      'event: content_block_delta',
      mkDelta(2, '{}'),
      '',
    ].join('\n');

    const parsed = parseSSEStream(stream);
    expect(parsed.text).toBe('[tool:Edit] [tool:Bash] [tool:Write] ');
  });

  it('handles mixed text + tool-use: both appear in order', () => {
    const stream = [
      'event: content_block_start',
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","id":"tb_1"}}',
      '',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Some prefix text "}}',
      '',
      'event: content_block_start',
      'data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"tu_1","name":"Edit"}}',
      '',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{}"}}',
      '',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"more text"}}',
      '',
    ].join('\n');

    const parsed = parseSSEStream(stream);
    expect(parsed.text).toBe('Some prefix text [tool:Edit] more text');
  });

  it('does NOT include raw partial_json fragments in the parsed text', () => {
    const mkDelta = (idx: number, partial: string) =>
      `data: ${JSON.stringify({ type: 'content_block_delta', index: idx, delta: { type: 'input_json_delta', partial_json: partial } })}`;

    const stream = [
      'event: content_block_start',
      `data: ${JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tu_1', name: 'Read' } })}`,
      '',
      'event: content_block_delta',
      mkDelta(0, '{"file_path":"/etc/passwd"}'),
      '',
    ].join('\n');

    const parsed = parseSSEStream(stream);
    expect(parsed.text).not.toContain('/etc/passwd');
    expect(parsed.text).toBe('[tool:Read] ');
  });

  it('ignores content_block_start for non-tool-use types (no extra marker)', () => {
    const stream = [
      'event: content_block_start',
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"text"}}',
      '',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hello"}}',
      '',
    ].join('\n');

    const parsed = parseSSEStream(stream);
    expect(parsed.text).toBe('hello');
  });

  it('returns empty text and eventCount 0 for an empty stream', () => {
    const parsed = parseSSEStream('');
    expect(parsed.text).toBe('');
    expect(parsed.eventCount).toBe(0);
    expect(parsed.completed).toBe(false);
  });

  it('[DONE] sentinel still marks completed: true', () => {
    const stream = ['data: [DONE]', ''].join('\n');
    const parsed = parseSSEStream(stream);
    expect(parsed.completed).toBe(true);
  });

  it('malformed content_block_start (no content_block field) does not throw', () => {
    const stream = [
      'event: content_block_start',
      'data: {"type":"content_block_start","index":0}',
      '',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"ok"}}',
      '',
    ].join('\n');

    let parsed: ReturnType<typeof parseSSEStream> | undefined;
    expect(() => {
      parsed = parseSSEStream(stream);
    }).not.toThrow();
    expect(parsed?.text).toBe('ok');
  });
});
