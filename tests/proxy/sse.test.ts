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
