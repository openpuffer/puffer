// Server-Sent Event (SSE) parsing for Puffer's response audit path.
//
// Puffer doesn't buffer SSE chunks before delivering them to the
// client — http-proxy auto-pipes the upstream response through, so
// the streaming UX is preserved. This module exists so the post-hoc
// pipeline evaluation gets a clean text stream to scan instead of the
// raw `data: { ... }\n\n` envelope, which would dilute injection /
// PII signal with framing noise.
//
// We support the two SSE flavors Puffer sees in the wild:
// - Anthropic Messages: `event: content_block_delta` + JSON with
//   `delta.text` or `delta.type === 'text_delta'`.
// - OpenAI Chat Completions: `data: { choices: [{ delta: { content }}] }`
//   with a `[DONE]` sentinel.
// Other providers tend to mirror one of these shapes; the unified
// extractor below is provider-agnostic and just looks for any `text`,
// `content`, or `delta` field on each parsed event payload.

export interface ParsedSSE {
  /** Concatenated text content extracted from delta events. */
  text: string;
  /** Number of well-formed `data:` events parsed. */
  eventCount: number;
  /** Whether the stream emitted a `[DONE]` (or `event: error`) sentinel. */
  completed: boolean;
}

/**
 * Parse a buffered SSE response into clean content. Tolerant: malformed
 * events are skipped, never throw — the audit pipeline must keep
 * running even if the upstream sent corrupt frames.
 */
export function parseSSEStream(raw: string): ParsedSSE {
  const lines = raw.split('\n');
  const parts: string[] = [];
  let eventCount = 0;
  let completed = false;
  let pendingEvent: string | null = null;

  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, '');

    if (line.startsWith('event:')) {
      pendingEvent = line.slice(6).trim();
      continue;
    }

    if (!line.startsWith('data:')) {
      // Blank line = end of event in SSE; reset the event tag.
      if (line === '') pendingEvent = null;
      continue;
    }

    const payload = line.slice(5).trim();
    if (payload === '[DONE]') {
      completed = true;
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      // Non-JSON SSE payload (rare). Treat the raw payload as text so
      // the pipeline still gets a chance to scan it.
      parts.push(payload);
      eventCount++;
      continue;
    }

    eventCount++;
    const extracted = extractTextFromEventPayload(parsed, pendingEvent);
    if (extracted) parts.push(extracted);
  }

  return { text: parts.join(''), eventCount, completed };
}

/**
 * Walk a parsed event JSON and return any text content we can find.
 * Conservative: empty string for events that carry no user-visible
 * text (ping, message_start, etc.).
 */
function extractTextFromEventPayload(payload: unknown, eventTag: string | null): string {
  if (!payload || typeof payload !== 'object') return '';
  const p = payload as Record<string, unknown>;

  // Anthropic content_block_delta { delta: { type: 'text_delta', text } }
  if (eventTag === 'content_block_delta' || p.type === 'content_block_delta') {
    const delta = p.delta as Record<string, unknown> | undefined;
    if (delta && typeof delta.text === 'string') return delta.text;
  }

  // OpenAI Chat Completions: choices[].delta.content
  if (Array.isArray(p.choices)) {
    const out: string[] = [];
    for (const choice of p.choices) {
      if (!choice || typeof choice !== 'object') continue;
      const delta = (choice as Record<string, unknown>).delta;
      if (delta && typeof delta === 'object') {
        const content = (delta as Record<string, unknown>).content;
        if (typeof content === 'string') out.push(content);
      }
    }
    if (out.length > 0) return out.join('');
  }

  // Generic fallbacks for less-formal providers
  if (typeof p.text === 'string') return p.text;
  if (typeof p.content === 'string') return p.content;

  return '';
}

/**
 * Quick check on response headers — true if the upstream is streaming.
 * Accepts both `text/event-stream` and `application/x-ndjson` since
 * some Anthropic transports use the latter for tool-use streams.
 */
export function isStreamingContentType(
  headers: Record<string, string | string[] | undefined> | undefined,
): boolean {
  if (!headers) return false;
  const ct = headers['content-type'];
  const value = Array.isArray(ct) ? ct.join(' ') : (ct ?? '');
  return /text\/event-stream|application\/x-ndjson/i.test(value);
}
