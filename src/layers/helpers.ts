import { LayerResult, Verdict, PufferEvent, Finding } from '../types.js';

export function allowResult(layer: number, name: string): LayerResult {
  return {
    layer,
    name,
    verdict: 'allow',
    confidence: 1.0,
    details: 'Not applicable to this event type',
    findings: [],
    durationMs: 0,
  };
}

export function blockResult(layer: number, name: string, details: string, findings: Finding[]): LayerResult {
  return {
    layer,
    name,
    verdict: 'block',
    confidence: 1.0,
    details,
    findings,
    durationMs: 0,
  };
}

export function extractTextFromEvent(event: PufferEvent): string {
  const parts: string[] = [];

  if (event.action.type === 'llm_request') {
    parts.push(JSON.stringify(event.action.body));
  } else if (event.action.type === 'llm_response') {
    parts.push(JSON.stringify(event.action.body));
  } else if (event.action.type === 'command_execute') {
    parts.push(event.action.command);
    parts.push(event.action.args.join(' '));
  } else if (event.action.type === 'file_write' && event.action.content) {
    parts.push(event.action.content);
  } else if (event.action.type === 'mcp_tool_call') {
    parts.push(JSON.stringify(event.action.params));
  } else if (event.action.type === 'mcp_tool_result') {
    parts.push(JSON.stringify(event.action.result));
  } else if (event.action.type === 'network_request') {
    parts.push(event.action.url);
    if (event.action.body) parts.push(JSON.stringify(event.action.body));
  }

  return parts.join(' ');
}

/**
 * Extract only user-authored message content from LLM request/response bodies.
 * Unlike extractTextFromEvent, this skips JSON structural overhead, system prompts,
 * tool definitions, and metadata — reducing false positives for PII scanning.
 */
export function extractUserContentFromEvent(event: PufferEvent): string {
  if (event.action.type === 'llm_request' || event.action.type === 'llm_response') {
    const body = event.action.body;
    if (!body || typeof body !== 'object') return '';

    const b = body as Record<string, unknown>;
    const parts: string[] = [];

    // Extract message content only (skip system prompt, tool defs, metadata)
    const messages = b.messages;
    if (Array.isArray(messages)) {
      for (const msg of messages) {
        if (!msg || typeof msg !== 'object') continue;
        const content = (msg as Record<string, unknown>).content;
        if (typeof content === 'string') {
          parts.push(content);
        } else if (Array.isArray(content)) {
          // Anthropic multi-part content blocks
          for (const block of content) {
            if (!block || typeof block !== 'object') continue;
            const bl = block as Record<string, unknown>;
            if (bl.type === 'text' && typeof bl.text === 'string') {
              parts.push(bl.text);
            } else if (bl.type === 'tool_result' && typeof bl.content === 'string') {
              parts.push(bl.content);
            }
          }
        }
      }
    }

    // OpenAI: choices[].message.content (for responses)
    const choices = b.choices;
    if (Array.isArray(choices)) {
      for (const choice of choices) {
        if (!choice || typeof choice !== 'object') continue;
        const message = (choice as Record<string, unknown>).message;
        if (message && typeof message === 'object') {
          const content = (message as Record<string, unknown>).content;
          if (typeof content === 'string') parts.push(content);
        }
      }
    }

    // Anthropic response: content[] blocks at top level
    const topContent = b.content;
    if (Array.isArray(topContent)) {
      for (const block of topContent) {
        if (!block || typeof block !== 'object') continue;
        const bl = block as Record<string, unknown>;
        if (bl.type === 'text' && typeof bl.text === 'string') {
          parts.push(bl.text);
        }
      }
    }

    return parts.join(' ');
  }

  // For non-LLM events, fall back to the full extraction
  return extractTextFromEvent(event);
}

export function getMaxSeverity(findings: Finding[]): string | null {
  const order = ['critical', 'high', 'medium', 'low'];
  for (const severity of order) {
    if (findings.some((f) => f.severity === severity)) return severity;
  }
  return null;
}

export function calculateEntropy(text: string): number {
  if (text.length === 0) return 0;
  const freq: Record<string, number> = {};
  for (const char of text) freq[char] = (freq[char] || 0) + 1;
  const len = text.length;
  return -Object.values(freq).reduce((sum, count) => {
    const p = count / len;
    return sum + p * Math.log2(p);
  }, 0);
}
