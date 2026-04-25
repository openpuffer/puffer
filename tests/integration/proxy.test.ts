import { describe, it, expect, vi } from 'vitest';
import { handleRequest, ProxyDependencies } from '@puffer/proxy';
import { detectProvider } from '@puffer/proxy';
import { PufferEvent } from '@puffer/core';
import { IncomingMessage, ServerResponse } from 'node:http';

function makeMockRequest(
  overrides: {
    url?: string;
    method?: string;
    headers?: Record<string, string>;
  } = {},
): IncomingMessage {
  return {
    url: overrides.url ?? '/v1/chat/completions',
    method: overrides.method ?? 'POST',
    headers: overrides.headers ?? {},
  } as unknown as IncomingMessage;
}

function makeMockResponse(): ServerResponse & {
  _statusCode: number | null;
  _headers: Record<string, string>;
  _body: string;
} {
  const res = {
    _statusCode: null as number | null,
    _headers: {} as Record<string, string>,
    _body: '',
    writeHead: vi.fn(function (
      this: typeof res,
      statusCode: number,
      headers?: Record<string, string>,
    ) {
      this._statusCode = statusCode;
      if (headers) Object.assign(this._headers, headers);
      return this;
    }),
    end: vi.fn(function (this: typeof res, body?: string) {
      if (body) this._body = body;
      return this;
    }),
    setHeader: vi.fn(),
  };
  return res as unknown as ServerResponse & typeof res;
}

function makeMockDeps(overrides: Partial<ProxyDependencies> = {}): ProxyDependencies {
  return {
    evaluatePipeline: vi.fn(async (event: PufferEvent) => {
      event.decision = 'ALLOW';
      return event;
    }),
    logEvent: vi.fn(),
    forwardRequest: vi.fn((_req, _res, _targetUrl, _body, onResponse) => {
      onResponse(200, { choices: [{ message: { content: 'Hello!' } }] });
    }),
    resolveTarget: vi.fn(() => 'https://api.openai.com'),
    sessionId: 'test-session-1',
    sequenceCounter: { value: 0 },
    mode: 'enforce',
    passthrough: false,
    ...overrides,
  };
}

describe('Proxy Request Handling', () => {
  describe('handleRequest', () => {
    it('should forward a clean request', async () => {
      const req = makeMockRequest();
      const res = makeMockResponse();
      const body = Buffer.from(
        JSON.stringify({
          model: 'gpt-4o',
          messages: [{ role: 'user', content: 'Hello' }],
        }),
      );
      const deps = makeMockDeps();

      await handleRequest(req, res, body, deps);

      // evaluatePipeline called twice: once for request, once for response scanning
      expect(deps.evaluatePipeline).toHaveBeenCalledTimes(2);
      expect(deps.forwardRequest).toHaveBeenCalledOnce();
      expect(deps.logEvent).toHaveBeenCalled();
      // Response should not be 403
      expect(res._statusCode).not.toBe(403);
    });

    it('should return 403 for blocked request in enforce mode', async () => {
      const req = makeMockRequest();
      const res = makeMockResponse();
      const body = Buffer.from(
        JSON.stringify({
          model: 'gpt-4o',
          messages: [{ role: 'user', content: 'blocked content' }],
        }),
      );
      const deps = makeMockDeps({
        evaluatePipeline: vi.fn(async (event: PufferEvent) => {
          event.decision = 'BLOCK';
          event.layers.push({
            layer: 1,
            name: 'test-blocker',
            verdict: 'block',
            confidence: 1.0,
            details: 'Test block reason',
            findings: [],
            durationMs: 1,
          });
          return event;
        }),
      });

      await handleRequest(req, res, body, deps);

      expect(res.writeHead).toHaveBeenCalledWith(403, expect.any(Object));
      expect(res._statusCode).toBe(403);

      const responseBody = JSON.parse(res._body);
      expect(responseBody.error.type).toBe('puffer_blocked');
      expect(responseBody.error.layer).toBe('test-blocker');
      // forwardRequest should NOT have been called
      expect(deps.forwardRequest).not.toHaveBeenCalled();
    });

    it('should forward blocked request in monitor mode (not return 403)', async () => {
      const req = makeMockRequest();
      const res = makeMockResponse();
      const body = Buffer.from(
        JSON.stringify({
          model: 'gpt-4o',
          messages: [{ role: 'user', content: 'blocked content' }],
        }),
      );
      const deps = makeMockDeps({
        evaluatePipeline: vi.fn(async (event: PufferEvent) => {
          event.decision = 'BLOCK';
          event.layers.push({
            layer: 1,
            name: 'test-blocker',
            verdict: 'block',
            confidence: 1.0,
            details: 'Test block reason',
            findings: [],
            durationMs: 1,
          });
          return event;
        }),
        mode: 'monitor',
      });

      await handleRequest(req, res, body, deps);

      // In monitor mode, even BLOCK should be forwarded
      expect(deps.forwardRequest).toHaveBeenCalledOnce();
      expect(res._statusCode).not.toBe(403);
    });

    it('should return 502 when no target URL is configured', async () => {
      const req = makeMockRequest();
      const res = makeMockResponse();
      const body = Buffer.from(
        JSON.stringify({
          model: 'gpt-4o',
          messages: [{ role: 'user', content: 'Hello' }],
        }),
      );
      const deps = makeMockDeps({
        resolveTarget: vi.fn(() => null),
      });

      await handleRequest(req, res, body, deps);

      expect(res.writeHead).toHaveBeenCalledWith(502, expect.any(Object));
      expect(res._statusCode).toBe(502);

      const responseBody = JSON.parse(res._body);
      expect(responseBody.error.type).toBe('puffer_error');
    });

    it('should handle empty body gracefully', async () => {
      const req = makeMockRequest();
      const res = makeMockResponse();
      const body = Buffer.alloc(0);
      const deps = makeMockDeps();

      await handleRequest(req, res, body, deps);

      // evaluatePipeline called twice: request + response scanning
      expect(deps.evaluatePipeline).toHaveBeenCalledTimes(2);
      expect(deps.forwardRequest).toHaveBeenCalledOnce();
    });
  });

  describe('detectProvider from URL paths', () => {
    it('should detect Anthropic from /v1/messages', () => {
      const provider = detectProvider('/v1/messages', {}, {});
      expect(provider).toBe('anthropic');
    });

    it('should detect Ollama from /api/generate', () => {
      const provider = detectProvider('/api/generate', {}, {});
      expect(provider).toBe('ollama');
    });

    it('should detect Ollama from /api/chat', () => {
      const provider = detectProvider('/api/chat', {}, {});
      expect(provider).toBe('ollama');
    });

    it('should detect Ollama from /api/tags', () => {
      const provider = detectProvider('/api/tags', {}, {});
      expect(provider).toBe('ollama');
    });

    it('should detect openai-compatible from /v1/chat/completions without host header', () => {
      const provider = detectProvider('/v1/chat/completions', {}, {});
      expect(provider).toBe('openai-compatible');
    });

    it('should detect OpenAI from /v1/chat/completions with openai host', () => {
      const provider = detectProvider(
        '/v1/chat/completions',
        { 'x-puffer-original-host': 'api.openai.com' },
        {},
      );
      expect(provider).toBe('openai');
    });

    it('should detect openai-compatible from /v1/embeddings', () => {
      const provider = detectProvider('/v1/embeddings', {}, {});
      expect(provider).toBe('openai-compatible');
    });
  });

  describe('detectProvider from headers', () => {
    it('should use x-puffer-target header when present', () => {
      const provider = detectProvider('/some/path', { 'x-puffer-target': 'anthropic' }, {});
      expect(provider).toBe('anthropic');
    });

    it('should detect Anthropic from x-puffer-original-host containing anthropic', () => {
      const provider = detectProvider(
        '/v1/chat/completions',
        { 'x-puffer-original-host': 'api.anthropic.com' },
        {},
      );
      expect(provider).toBe('anthropic');
    });

    it('should detect DeepSeek from x-puffer-original-host containing deepseek', () => {
      const provider = detectProvider(
        '/v1/chat/completions',
        { 'x-puffer-original-host': 'api.deepseek.com' },
        {},
      );
      expect(provider).toBe('deepseek');
    });

    it('should detect Groq from x-puffer-original-host', () => {
      const provider = detectProvider(
        '/v1/chat/completions',
        { 'x-puffer-original-host': 'api.groq.com' },
        {},
      );
      expect(provider).toBe('groq');
    });

    it('should detect Together from x-puffer-original-host', () => {
      const provider = detectProvider(
        '/v1/chat/completions',
        { 'x-puffer-original-host': 'api.together.xyz' },
        {},
      );
      expect(provider).toBe('together');
    });

    it('should detect OpenRouter from x-puffer-original-host', () => {
      const provider = detectProvider(
        '/v1/chat/completions',
        { 'x-puffer-original-host': 'openrouter.ai' },
        {},
      );
      expect(provider).toBe('openrouter');
    });
  });

  describe('detectProvider from body heuristics', () => {
    it('should detect Anthropic from body with system and messages but no tools', () => {
      const provider = detectProvider(
        '/some/unknown/path',
        {},
        {
          system: 'You are helpful',
          messages: [{ role: 'user', content: 'Hi' }],
        },
      );
      expect(provider).toBe('anthropic');
    });

    it('should return unknown for unrecognizable requests', () => {
      const provider = detectProvider('/random/path', {}, { data: 'something' });
      expect(provider).toBe('unknown');
    });
  });
});
