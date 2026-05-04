/**
 * Snippet extractor — pulls a short, human-readable preview from raw LLM
 * request / response bodies. Never throws; returns empty on any failure.
 */

export const SNIPPET_MAX_CHARS = 150;

export interface SnippetExtraction {
  /** Truncated text snippet (max 150 chars + optional "…"). Empty string if nothing extractable. */
  text: string;
  /** Original length before truncation, for UI to show "…" indicator. */
  originalLength: number;
}

const EMPTY: SnippetExtraction = { text: '', originalLength: 0 };

/**
 * Normalise raw text: trim whitespace, collapse newlines to spaces, then
 * truncate to SNIPPET_MAX_CHARS.
 */
function normalise(raw: string): SnippetExtraction {
  const trimmed = raw.replace(/\n/g, ' ').trim();
  const originalLength = trimmed.length;
  if (originalLength === 0) return EMPTY;
  if (originalLength <= SNIPPET_MAX_CHARS) {
    return { text: trimmed, originalLength };
  }
  // 149 printable chars + 1 ellipsis = 150 total
  const text = trimmed.slice(0, SNIPPET_MAX_CHARS - 1) + '…';
  return { text, originalLength };
}

/**
 * Pull text from a single message content value.
 * Supports plain string or array-of-parts (multi-modal).
 */
function extractContentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const part of content) {
      if (part && typeof part === 'object') {
        const p = part as Record<string, unknown>;
        if (typeof p.text === 'string') parts.push(p.text);
      }
    }
    return parts.join('');
  }
  return '';
}

/**
 * Extract a human-readable snippet from an LLM request body.
 * Pulls the LAST user message text (most recent turn).
 * Supports OpenAI-style and Anthropic-style bodies.
 */
export function extractRequestSnippet(body: unknown): SnippetExtraction {
  try {
    if (!body || typeof body !== 'object' || Array.isArray(body) || Buffer.isBuffer(body)) {
      return EMPTY;
    }
    const b = body as Record<string, unknown>;

    // Messages array (OpenAI and Anthropic both use this shape)
    if (Array.isArray(b.messages)) {
      // Walk backwards to find the last user message
      const messages = b.messages as unknown[];
      for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        if (!msg || typeof msg !== 'object') continue;
        const m = msg as Record<string, unknown>;
        if (m.role !== 'user') continue;
        const text = extractContentText(m.content);
        if (text.length > 0) return normalise(text);
      }

      // Anthropic: fall back to system field if present and a string
      if (typeof b.system === 'string' && b.system.length > 0) {
        return normalise(b.system);
      }

      return EMPTY;
    }

    return EMPTY;
  } catch {
    return EMPTY;
  }
}

/**
 * Extract a snippet from an LLM response body. Pulls assistant text content.
 * Supports OpenAI Chat Completions, Anthropic Messages, and parsed-SSE shape
 * `{ _puffer_streaming: true, text: "..." }` (already produced upstream).
 */
export function extractResponseSnippet(body: unknown): SnippetExtraction {
  try {
    if (!body || typeof body !== 'object' || Array.isArray(body) || Buffer.isBuffer(body)) {
      return EMPTY;
    }
    const b = body as Record<string, unknown>;

    // Puffer streaming parsed shape
    if (b._puffer_streaming === true && typeof b.text === 'string') {
      return normalise(b.text);
    }

    // OpenAI Chat Completions: { choices: [{ message: { content: string } }] }
    if (Array.isArray(b.choices)) {
      const choices = b.choices as unknown[];
      if (choices.length > 0) {
        const first = choices[0];
        if (first && typeof first === 'object') {
          const c = first as Record<string, unknown>;
          const message = c.message;
          if (message && typeof message === 'object') {
            const m = message as Record<string, unknown>;
            if (typeof m.content === 'string') {
              return normalise(m.content);
            }
          }
        }
      }
      return EMPTY;
    }

    // Anthropic Messages: { content: [{ type: 'text', text: string }, ...] }
    if (Array.isArray(b.content)) {
      const parts: string[] = [];
      for (const block of b.content as unknown[]) {
        if (!block || typeof block !== 'object') continue;
        const bl = block as Record<string, unknown>;
        if (bl.type === 'text' && typeof bl.text === 'string') {
          parts.push(bl.text);
        }
      }
      if (parts.length > 0) return normalise(parts.join(''));
      return EMPTY;
    }

    return EMPTY;
  } catch {
    return EMPTY;
  }
}
