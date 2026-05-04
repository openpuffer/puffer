import { describe, it, expect } from 'vitest';
import { detectProvider } from '@puffer/proxy';

// ---------------------------------------------------------------------------
// Tier 1 — x-puffer-target header (highest precedence)
// ---------------------------------------------------------------------------
describe('detectProvider – tier 1: explicit x-puffer-target header', () => {
  it('returns the provider named in x-puffer-target regardless of path', () => {
    expect(detectProvider('/v1/chat/completions', { 'x-puffer-target': 'openai' }, {})).toBe(
      'openai',
    );
  });

  it('x-puffer-target wins over a deepseek body.model', () => {
    expect(
      detectProvider(
        '/v1/chat/completions',
        { 'x-puffer-target': 'openai' },
        { model: 'deepseek-chat', messages: [] },
      ),
    ).toBe('openai');
  });

  it('x-puffer-target wins over a /v1/messages path', () => {
    expect(
      detectProvider(
        '/v1/messages',
        { 'x-puffer-target': 'openai' },
        { model: 'claude-3-opus-20240229', messages: [] },
      ),
    ).toBe('openai');
  });
});

// ---------------------------------------------------------------------------
// Tier 2 — URL path patterns
// ---------------------------------------------------------------------------
describe('detectProvider – tier 2: URL path patterns', () => {
  it('returns anthropic for /v1/messages regardless of body model', () => {
    expect(detectProvider('/v1/messages', {}, { model: 'deepseek-chat', messages: [] })).toBe(
      'anthropic',
    );
  });

  it('returns ollama for /api/generate', () => {
    expect(detectProvider('/api/generate', {}, {})).toBe('ollama');
  });

  it('returns ollama for /api/chat', () => {
    expect(detectProvider('/api/chat', {}, {})).toBe('ollama');
  });

  it('returns ollama for /api/tags', () => {
    expect(detectProvider('/api/tags', {}, {})).toBe('ollama');
  });
});

// ---------------------------------------------------------------------------
// Tier 3 — x-puffer-original-host header on chat/embeddings paths
// ---------------------------------------------------------------------------
describe('detectProvider – tier 3: x-puffer-original-host', () => {
  it('returns openai when host contains openai', () => {
    expect(
      detectProvider('/v1/chat/completions', { 'x-puffer-original-host': 'api.openai.com' }, {}),
    ).toBe('openai');
  });

  it('returns anthropic when host contains anthropic', () => {
    expect(
      detectProvider('/v1/chat/completions', { 'x-puffer-original-host': 'api.anthropic.com' }, {}),
    ).toBe('anthropic');
  });

  it('returns deepseek when host contains deepseek', () => {
    expect(
      detectProvider('/v1/chat/completions', { 'x-puffer-original-host': 'api.deepseek.com' }, {}),
    ).toBe('deepseek');
  });

  it('returns groq when host contains groq', () => {
    expect(
      detectProvider('/v1/chat/completions', { 'x-puffer-original-host': 'api.groq.com' }, {}),
    ).toBe('groq');
  });

  it('returns together when host contains together', () => {
    expect(
      detectProvider('/v1/chat/completions', { 'x-puffer-original-host': 'api.together.xyz' }, {}),
    ).toBe('together');
  });

  it('returns openrouter when host contains openrouter', () => {
    expect(
      detectProvider('/v1/chat/completions', { 'x-puffer-original-host': 'openrouter.ai' }, {}),
    ).toBe('openrouter');
  });

  it('returns mistral when host contains mistral', () => {
    expect(
      detectProvider('/v1/chat/completions', { 'x-puffer-original-host': 'api.mistral.ai' }, {}),
    ).toBe('mistral');
  });

  it('returns cohere when host contains cohere', () => {
    expect(
      detectProvider('/v1/chat/completions', { 'x-puffer-original-host': 'api.cohere.ai' }, {}),
    ).toBe('cohere');
  });
});

// ---------------------------------------------------------------------------
// Tier 4 — body.model prefix matching (NEW)
// ---------------------------------------------------------------------------
describe('detectProvider – tier 4: body.model prefix matching', () => {
  // --- deepseek ---
  it('returns deepseek for model "deepseek-chat"', () => {
    expect(
      detectProvider('/v1/chat/completions', {}, { model: 'deepseek-chat', messages: [] }),
    ).toBe('deepseek');
  });

  it('returns deepseek for model "deepseek-coder" (variant)', () => {
    expect(
      detectProvider('/v1/chat/completions', {}, { model: 'deepseek-coder', messages: [] }),
    ).toBe('deepseek');
  });

  it('returns deepseek for model prefix match on /v1/embeddings path', () => {
    expect(detectProvider('/v1/embeddings', {}, { model: 'deepseek-chat', input: 'hello' })).toBe(
      'deepseek',
    );
  });

  // --- openai ---
  it('returns openai for model "gpt-4o"', () => {
    expect(detectProvider('/v1/chat/completions', {}, { model: 'gpt-4o', messages: [] })).toBe(
      'openai',
    );
  });

  it('returns openai for model "gpt-3.5-turbo"', () => {
    expect(
      detectProvider('/v1/chat/completions', {}, { model: 'gpt-3.5-turbo', messages: [] }),
    ).toBe('openai');
  });

  it('returns openai for model "o1-mini"', () => {
    expect(detectProvider('/v1/chat/completions', {}, { model: 'o1-mini', messages: [] })).toBe(
      'openai',
    );
  });

  it('returns openai for model "chatgpt-4o-latest"', () => {
    expect(
      detectProvider('/v1/chat/completions', {}, { model: 'chatgpt-4o-latest', messages: [] }),
    ).toBe('openai');
  });

  // --- anthropic via chat completions path ---
  it('returns anthropic for model "claude-3-opus-20240229" on /v1/chat/completions', () => {
    expect(
      detectProvider('/v1/chat/completions', {}, { model: 'claude-3-opus-20240229', messages: [] }),
    ).toBe('anthropic');
  });

  it('returns anthropic for model "claude-3-5-sonnet-20241022"', () => {
    expect(
      detectProvider(
        '/v1/chat/completions',
        {},
        { model: 'claude-3-5-sonnet-20241022', messages: [] },
      ),
    ).toBe('anthropic');
  });

  // --- google ---
  it('returns google for model "gemini-1.5-pro"', () => {
    expect(
      detectProvider('/v1/chat/completions', {}, { model: 'gemini-1.5-pro', messages: [] }),
    ).toBe('google');
  });

  it('returns google for model "models/gemini-pro"', () => {
    expect(
      detectProvider('/v1/chat/completions', {}, { model: 'models/gemini-pro', messages: [] }),
    ).toBe('google');
  });

  // --- mistral ---
  it('returns mistral for model "mistral-large-latest"', () => {
    expect(
      detectProvider('/v1/chat/completions', {}, { model: 'mistral-large-latest', messages: [] }),
    ).toBe('mistral');
  });

  it('returns mistral for model "open-mixtral-8x7b"', () => {
    expect(
      detectProvider('/v1/chat/completions', {}, { model: 'open-mixtral-8x7b', messages: [] }),
    ).toBe('mistral');
  });

  it('returns mistral for model "codestral-latest"', () => {
    expect(
      detectProvider('/v1/chat/completions', {}, { model: 'codestral-latest', messages: [] }),
    ).toBe('mistral');
  });

  // --- cohere ---
  it('returns cohere for model "command-r-plus"', () => {
    expect(
      detectProvider('/v1/chat/completions', {}, { model: 'command-r-plus', messages: [] }),
    ).toBe('cohere');
  });

  it('returns cohere for model "command-light"', () => {
    expect(
      detectProvider('/v1/chat/completions', {}, { model: 'command-light', messages: [] }),
    ).toBe('cohere');
  });

  // --- together (llama models) ---
  it('returns together for model "meta-llama/Llama-3.1-70b-Instruct"', () => {
    expect(
      detectProvider(
        '/v1/chat/completions',
        {},
        { model: 'meta-llama/Llama-3.1-70b-Instruct', messages: [] },
      ),
    ).toBe('together');
  });

  it('returns together for model "llama-3-70b"', () => {
    expect(detectProvider('/v1/chat/completions', {}, { model: 'llama-3-70b', messages: [] })).toBe(
      'together',
    );
  });

  // --- groq ---
  it('returns groq for model "llama3-groq-70b-8192-tool-use-preview"', () => {
    expect(
      detectProvider(
        '/v1/chat/completions',
        {},
        { model: 'llama3-groq-70b-8192-tool-use-preview', messages: [] },
      ),
    ).toBe('groq');
  });

  it('returns groq for model "groq-some-model"', () => {
    expect(
      detectProvider('/v1/chat/completions', {}, { model: 'groq-some-model', messages: [] }),
    ).toBe('groq');
  });

  // --- case insensitivity ---
  it('matches deepseek prefix case-insensitively (DEEPSEEK-chat)', () => {
    expect(
      detectProvider('/v1/chat/completions', {}, { model: 'DEEPSEEK-chat', messages: [] }),
    ).toBe('deepseek');
  });

  it('matches gpt- prefix case-insensitively (GPT-4)', () => {
    expect(detectProvider('/v1/chat/completions', {}, { model: 'GPT-4', messages: [] })).toBe(
      'openai',
    );
  });
});

// ---------------------------------------------------------------------------
// Tier 5 — Anthropic body heuristic (system + messages, no tools)
// ---------------------------------------------------------------------------
describe('detectProvider – tier 5: Anthropic body heuristic', () => {
  it('returns anthropic for body with system + messages and no tools on unknown path', () => {
    expect(
      detectProvider(
        '/some/unknown/path',
        {},
        { system: 'You are helpful', messages: [{ role: 'user', content: 'Hi' }] },
      ),
    ).toBe('anthropic');
  });
});

// ---------------------------------------------------------------------------
// Fallback / unknown
// ---------------------------------------------------------------------------
describe('detectProvider – fallback', () => {
  it('returns openai-compatible for /v1/chat/completions with no body.model and no host header', () => {
    expect(detectProvider('/v1/chat/completions', {}, {})).toBe('openai-compatible');
  });

  it('returns openai-compatible for /v1/embeddings with no body.model', () => {
    expect(detectProvider('/v1/embeddings', {}, {})).toBe('openai-compatible');
  });

  it('returns openai-compatible when body.model is an empty string', () => {
    expect(detectProvider('/v1/chat/completions', {}, { model: '', messages: [] })).toBe(
      'openai-compatible',
    );
  });

  it('returns openai-compatible when body.model is a non-string (number)', () => {
    expect(detectProvider('/v1/chat/completions', {}, { model: 42, messages: [] })).toBe(
      'openai-compatible',
    );
  });

  it('returns openai-compatible for an unknown model prefix on chat path', () => {
    expect(
      detectProvider('/v1/chat/completions', {}, { model: 'unknown-model-xyz', messages: [] }),
    ).toBe('openai-compatible');
  });

  it('returns unknown for a completely unrecognizable path + body', () => {
    expect(detectProvider('/random/path', {}, { data: 'something' })).toBe('unknown');
  });

  it('returns unknown when body is null', () => {
    expect(detectProvider('/random/path', {}, null)).toBe('unknown');
  });

  it('returns unknown when body is undefined', () => {
    expect(detectProvider('/random/path', {}, undefined)).toBe('unknown');
  });

  it('does not throw when body is a Buffer', () => {
    expect(() =>
      detectProvider('/v1/chat/completions', {}, Buffer.from('{"model":"gpt-4"}')),
    ).not.toThrow();
  });

  it('does not throw when body is a plain string', () => {
    expect(() => detectProvider('/v1/chat/completions', {}, '{"model":"gpt-4"}')).not.toThrow();
  });

  it('returns unknown for unknown path even with a recognized model prefix', () => {
    // body model prefix detection only activates on chat/embeddings paths
    // — for other paths, falls through to body heuristic then unknown
    expect(detectProvider('/random/path', {}, { model: 'deepseek-chat', messages: [] })).toBe(
      'unknown',
    );
  });
});
