import type { Message, ProviderAdapter, ToolCall } from '../types.js';
import { COST_TABLE } from '../utils/constants.js';

const FALLBACK_COST = { input: 0, output: 0 };

function estimateTokensFromText(text: string): number {
  return Math.ceil(text.length / 4);
}

function estimateCostForModel(model: string, tokens: number): number {
  const entry = COST_TABLE[model] ?? COST_TABLE['default_cloud'] ?? FALLBACK_COST;
  return (tokens / 1_000_000) * entry.input;
}

/**
 * Compute accurate cost using real input + output token counts and per-million pricing.
 */
export function estimateCostWithOutput(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const entry = COST_TABLE[model] ?? COST_TABLE['default_cloud'] ?? FALLBACK_COST;
  return (inputTokens / 1_000_000) * entry.input + (outputTokens / 1_000_000) * entry.output;
}

function safeBody(body: unknown): Record<string, unknown> {
  if (body && typeof body === 'object') return body as Record<string, unknown>;
  return {};
}

// === OpenAI Adapter ===
const openaiAdapter: ProviderAdapter = {
  name: 'openai',

  extractMessages(body: unknown): Message[] {
    const b = safeBody(body);
    if (Array.isArray(b.messages)) {
      return b.messages.map((m: Record<string, unknown>) => ({
        role: String(m.role ?? 'user'),
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
      }));
    }
    return [];
  },

  extractModel(body: unknown): string {
    return String(safeBody(body).model ?? 'unknown');
  },

  extractSystemPrompt(body: unknown): string | null {
    const messages = this.extractMessages(body);
    const systemMsg = messages.find((m) => m.role === 'system');
    return systemMsg ? String(systemMsg.content) : null;
  },

  extractToolCalls(body: unknown): ToolCall[] {
    const b = safeBody(body);
    if (Array.isArray(b.tools)) {
      return b.tools.map((t: Record<string, unknown>) => {
        const fn = t.function as Record<string, unknown> | undefined;
        return { name: String(fn?.name ?? 'unknown'), arguments: fn?.parameters ?? {} };
      });
    }
    return [];
  },

  estimateTokens(body: unknown): number {
    return estimateTokensFromText(JSON.stringify(body));
  },

  estimateCost(body: unknown): number {
    const model = this.extractModel(body, '');
    return estimateCostForModel(model, this.estimateTokens(body));
  },

  formatBlockResponse(reason: string): unknown {
    return {
      error: { message: reason, type: 'puffer_blocked', code: 'blocked_by_puffer' },
    };
  },
};

// === Anthropic Adapter ===
const anthropicAdapter: ProviderAdapter = {
  name: 'anthropic',

  extractMessages(body: unknown): Message[] {
    const b = safeBody(body);
    const messages: Message[] = [];
    if (typeof b.system === 'string') {
      messages.push({ role: 'system', content: b.system });
    }
    if (Array.isArray(b.messages)) {
      for (const m of b.messages) {
        const msg = m as Record<string, unknown>;
        messages.push({
          role: String(msg.role ?? 'user'),
          content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
        });
      }
    }
    return messages;
  },

  extractModel(body: unknown): string {
    return String(safeBody(body).model ?? 'unknown');
  },

  extractSystemPrompt(body: unknown): string | null {
    const b = safeBody(body);
    return typeof b.system === 'string' ? b.system : null;
  },

  extractToolCalls(body: unknown): ToolCall[] {
    const b = safeBody(body);
    if (Array.isArray(b.tools)) {
      return b.tools.map((t: Record<string, unknown>) => ({
        name: String(t.name ?? 'unknown'),
        arguments: t.input_schema ?? {},
      }));
    }
    return [];
  },

  estimateTokens(body: unknown): number {
    return estimateTokensFromText(JSON.stringify(body));
  },

  estimateCost(body: unknown): number {
    const model = this.extractModel(body, '');
    return estimateCostForModel(model, this.estimateTokens(body));
  },

  formatBlockResponse(reason: string): unknown {
    return {
      type: 'error',
      error: { type: 'puffer_blocked', message: reason },
    };
  },
};

// === Ollama Adapter ===
const ollamaAdapter: ProviderAdapter = {
  name: 'ollama',

  extractMessages(body: unknown): Message[] {
    const b = safeBody(body);
    if (Array.isArray(b.messages)) {
      return b.messages.map((m: Record<string, unknown>) => ({
        role: String(m.role ?? 'user'),
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
      }));
    }
    if (typeof b.prompt === 'string') {
      return [{ role: 'user', content: b.prompt }];
    }
    return [];
  },

  extractModel(body: unknown): string {
    return String(safeBody(body).model ?? 'unknown');
  },

  extractSystemPrompt(body: unknown): string | null {
    const b = safeBody(body);
    if (typeof b.system === 'string') return b.system;
    const messages = this.extractMessages(body);
    const systemMsg = messages.find((m) => m.role === 'system');
    return systemMsg ? String(systemMsg.content) : null;
  },

  extractToolCalls(_body: unknown): ToolCall[] {
    return [];
  },

  estimateTokens(body: unknown): number {
    return estimateTokensFromText(JSON.stringify(body));
  },

  estimateCost(): number {
    return 0; // Local models are free
  },

  formatBlockResponse(reason: string): unknown {
    return { error: reason };
  },
};

// === Generic (OpenAI-compatible) Adapter ===
const genericAdapter: ProviderAdapter = {
  ...openaiAdapter,
  name: 'generic',
};

// === Provider Registry ===
const adapters: Record<string, ProviderAdapter> = {
  openai: openaiAdapter,
  anthropic: anthropicAdapter,
  ollama: ollamaAdapter,
  generic: genericAdapter,
  'openai-compatible': genericAdapter,
  deepseek: genericAdapter,
  together: genericAdapter,
  groq: genericAdapter,
  openrouter: genericAdapter,
  'lm-studio': genericAdapter,
  localai: genericAdapter,
  vllm: genericAdapter,
};

export function getAdapter(provider: string): ProviderAdapter {
  return adapters[provider] ?? genericAdapter;
}

export function detectProvider(
  url: string,
  headers: Record<string, string | string[] | undefined>,
  body: unknown,
): string {
  // 1. Explicit header
  const target = headers['x-puffer-target'];
  if (typeof target === 'string' && target) return target;

  // 2. URL path patterns
  if (url.includes('/v1/messages')) return 'anthropic';
  if (url.includes('/api/generate') || url.includes('/api/chat') || url.includes('/api/tags'))
    return 'ollama';

  if (url.includes('/v1/chat/completions') || url.includes('/v1/embeddings')) {
    const originalHost = headers['x-puffer-original-host'];
    if (typeof originalHost === 'string') {
      if (originalHost.includes('anthropic')) return 'anthropic';
      if (originalHost.includes('openai')) return 'openai';
      if (originalHost.includes('deepseek')) return 'deepseek';
      if (originalHost.includes('groq')) return 'groq';
      if (originalHost.includes('together')) return 'together';
      if (originalHost.includes('openrouter')) return 'openrouter';
      if (originalHost.includes('mistral')) return 'mistral';
      if (originalHost.includes('cohere')) return 'cohere';
    }
    return 'openai-compatible';
  }

  // 3. Body heuristics
  const b = safeBody(body);
  if (b.system !== undefined && b.messages !== undefined && !b.tools) return 'anthropic';

  return 'unknown';
}
