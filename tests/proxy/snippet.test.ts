import { describe, it, expect } from 'vitest';
import { extractRequestSnippet, extractResponseSnippet, SNIPPET_MAX_CHARS } from '@puffer/proxy';

// ── Happy-path shapes ─────────────────────────────────────────────────────────

describe('extractRequestSnippet', () => {
  it('extracts last user message from OpenAI-style messages (string content)', () => {
    const body = {
      messages: [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'What is the capital of France?' },
      ],
    };
    const result = extractRequestSnippet(body);
    expect(result.text).toBe('What is the capital of France?');
    expect(result.originalLength).toBe('What is the capital of France?'.length);
  });

  it('takes LAST user message when there are multiple turns', () => {
    const body = {
      messages: [
        { role: 'user', content: 'First question' },
        { role: 'assistant', content: 'First answer' },
        { role: 'user', content: 'Follow-up question' },
      ],
    };
    const result = extractRequestSnippet(body);
    expect(result.text).toBe('Follow-up question');
  });

  it('joins text parts from multi-modal content array', () => {
    const body = {
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Describe this image: ' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,abc' } },
            { type: 'text', text: 'Be concise.' },
          ],
        },
      ],
    };
    const result = extractRequestSnippet(body);
    expect(result.text).toBe('Describe this image: Be concise.');
  });

  it('extracts from Anthropic-style body with user message', () => {
    const body = {
      model: 'claude-3-5-sonnet-20241022',
      messages: [{ role: 'user', content: 'Translate hello to Spanish.' }],
      system: 'You are a translator.',
    };
    const result = extractRequestSnippet(body);
    expect(result.text).toBe('Translate hello to Spanish.');
  });

  it('falls back to system string when no user message in Anthropic body', () => {
    const body = {
      model: 'claude-3-haiku-20240307',
      messages: [{ role: 'assistant', content: 'I can help you.' }],
      system: 'You are a code reviewer.',
    };
    const result = extractRequestSnippet(body);
    expect(result.text).toBe('You are a code reviewer.');
  });

  it('returns empty when messages array is present but has no user message and no system', () => {
    const result = extractRequestSnippet({ messages: [{ role: 'system', content: '' }] });
    expect(result.text).toBe('');
    expect(result.originalLength).toBe(0);
  });
});

describe('extractResponseSnippet', () => {
  it('extracts content from OpenAI Chat Completions response', () => {
    const body = {
      choices: [
        {
          message: { role: 'assistant', content: 'The capital of France is Paris.' },
          finish_reason: 'stop',
        },
      ],
    };
    const result = extractResponseSnippet(body);
    expect(result.text).toBe('The capital of France is Paris.');
    expect(result.originalLength).toBe('The capital of France is Paris.'.length);
  });

  it('extracts and joins text blocks from Anthropic Messages response', () => {
    const body = {
      content: [
        { type: 'text', text: 'Paris is the capital.' },
        { type: 'tool_use', id: 'x', name: 'lookup', input: {} },
        { type: 'text', text: ' It is also the largest city.' },
      ],
    };
    const result = extractResponseSnippet(body);
    expect(result.text).toBe('Paris is the capital. It is also the largest city.');
  });

  it('extracts from puffer streaming parsed shape { _puffer_streaming: true, text }', () => {
    const body = { _puffer_streaming: true, text: 'Streaming answer here.' };
    const result = extractResponseSnippet(body);
    expect(result.text).toBe('Streaming answer here.');
  });
});

// ── Truncation & normalization ────────────────────────────────────────────────

describe('truncation', () => {
  it(`truncates at exactly ${SNIPPET_MAX_CHARS} chars: 151-char input → 149 chars + ellipsis`, () => {
    const longText = 'a'.repeat(151);
    const body = { choices: [{ message: { content: longText } }] };
    const result = extractResponseSnippet(body);
    // 149 + 1 (U+2026) = 150 chars total
    expect(result.text).toHaveLength(SNIPPET_MAX_CHARS);
    expect(result.text.endsWith('…')).toBe(true);
    expect(result.text.slice(0, 149)).toBe('a'.repeat(149));
    expect(result.originalLength).toBe(151);
  });

  it('does NOT truncate when text is exactly 150 chars', () => {
    const exactText = 'b'.repeat(150);
    const body = { choices: [{ message: { content: exactText } }] };
    const result = extractResponseSnippet(body);
    expect(result.text).toBe(exactText);
    expect(result.text.endsWith('…')).toBe(false);
    expect(result.originalLength).toBe(150);
  });

  it('does NOT truncate when text is 149 chars', () => {
    const shortText = 'c'.repeat(149);
    const body = { choices: [{ message: { content: shortText } }] };
    const result = extractResponseSnippet(body);
    expect(result.text).toBe(shortText);
  });
});

describe('newline normalization', () => {
  it('replaces \\n with a single space', () => {
    const body = { messages: [{ role: 'user', content: 'hi\nthere' }] };
    const result = extractRequestSnippet(body);
    expect(result.text).toBe('hi there');
  });

  it('replaces multiple \\n with spaces', () => {
    const body = { messages: [{ role: 'user', content: 'line1\nline2\nline3' }] };
    const result = extractRequestSnippet(body);
    expect(result.text).toBe('line1 line2 line3');
  });
});

describe('whitespace trimming', () => {
  it('trims leading and trailing whitespace before truncating', () => {
    const body = { messages: [{ role: 'user', content: '   hello world   ' }] };
    const result = extractRequestSnippet(body);
    expect(result.text).toBe('hello world');
    expect(result.originalLength).toBe('hello world'.length);
  });
});

// ── Negative / edge cases ─────────────────────────────────────────────────────

describe('negative cases — never throw, always return empty', () => {
  it('handles null', () => {
    expect(extractRequestSnippet(null)).toEqual({ text: '', originalLength: 0 });
    expect(extractResponseSnippet(null)).toEqual({ text: '', originalLength: 0 });
  });

  it('handles undefined', () => {
    expect(extractRequestSnippet(undefined)).toEqual({ text: '', originalLength: 0 });
    expect(extractResponseSnippet(undefined)).toEqual({ text: '', originalLength: 0 });
  });

  it('handles empty object {}', () => {
    expect(extractRequestSnippet({})).toEqual({ text: '', originalLength: 0 });
    expect(extractResponseSnippet({})).toEqual({ text: '', originalLength: 0 });
  });

  it('handles { messages: [] } — empty array', () => {
    expect(extractRequestSnippet({ messages: [] })).toEqual({ text: '', originalLength: 0 });
  });

  it('handles messages with only system role (no user message, no system field)', () => {
    const body = { messages: [{ role: 'system', content: 'Be helpful.' }] };
    const result = extractRequestSnippet(body);
    expect(result.text).toBe('');
    expect(result.originalLength).toBe(0);
  });

  it('handles Buffer input gracefully', () => {
    const buf = Buffer.from('hello');
    expect(extractRequestSnippet(buf as unknown)).toEqual({ text: '', originalLength: 0 });
    expect(extractResponseSnippet(buf as unknown)).toEqual({ text: '', originalLength: 0 });
  });

  it('handles string input gracefully', () => {
    expect(extractRequestSnippet('raw string')).toEqual({ text: '', originalLength: 0 });
    expect(extractResponseSnippet('raw string')).toEqual({ text: '', originalLength: 0 });
  });

  it('handles malformed body — messages not an array', () => {
    expect(extractRequestSnippet({ messages: 'not-an-array' })).toEqual({
      text: '',
      originalLength: 0,
    });
  });

  it('handles malformed body — choices not an array', () => {
    expect(extractResponseSnippet({ choices: 'not-an-array' })).toEqual({
      text: '',
      originalLength: 0,
    });
  });

  it('handles OpenAI response with null content in message', () => {
    const body = { choices: [{ message: { content: null } }] };
    expect(extractResponseSnippet(body)).toEqual({ text: '', originalLength: 0 });
  });

  it('handles Anthropic content with no text blocks', () => {
    const body = { content: [{ type: 'tool_use', id: 'x', name: 'fn', input: {} }] };
    expect(extractResponseSnippet(body)).toEqual({ text: '', originalLength: 0 });
  });
});
