import { IncomingMessage, IncomingHttpHeaders, ServerResponse } from 'node:http';
import { v4 as uuidv4 } from 'uuid';
import { PufferEvent, EventAction, Decision, RateLimitInfo } from '../types.js';
import { detectProvider, getAdapter, estimateCostWithOutput } from './providers.js';
import { COST_TABLE, VERSION } from '../utils/constants.js';
import { logger } from '../utils/logger.js';

export interface ProxyDependencies {
  evaluatePipeline: (event: PufferEvent) => Promise<PufferEvent>;
  logEvent: (event: PufferEvent) => void;
  forwardRequest: (
    req: IncomingMessage,
    res: ServerResponse,
    targetUrl: string,
    body: Buffer,
    onResponse: (statusCode: number, responseBody: unknown, responseHeaders?: IncomingHttpHeaders) => void
  ) => void;
  resolveTarget: (provider: string) => string | null;
  sessionId: string;
  sequenceCounter: { value: number };
  mode: 'monitor' | 'enforce' | 'paranoid' | 'interactive';
}

export async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  bodyBuffer: Buffer,
  deps: ProxyDependencies
): Promise<void> {
  const url = req.url ?? '/';

  let body: unknown;
  try {
    body = bodyBuffer.length > 0 ? JSON.parse(bodyBuffer.toString('utf-8')) : {};
  } catch {
    body = {};
  }

  const headers = req.headers as Record<string, string | string[] | undefined>;
  const provider = detectProvider(url, headers, body);
  const adapter = getAdapter(provider);

  const model = adapter.extractModel(body, url);
  const tokens = adapter.estimateTokens(body);
  const cost = adapter.estimateCost(body);
  const seq = deps.sequenceCounter.value++;

  const action: EventAction = {
    type: 'llm_request',
    method: req.method ?? 'POST',
    endpoint: url,
    body,
  };

  const event: PufferEvent = {
    id: uuidv4(),
    timestamp: new Date().toISOString(),
    source: {
      type: 'proxy',
      agent: String(headers['x-puffer-agent'] ?? 'unknown'),
      provider,
      model,
    },
    action,
    payload: body,
    metadata: {
      sessionId: deps.sessionId,
      sequenceNumber: seq,
      tokenEstimate: tokens,
      costEstimate: cost,
    },
    layers: [],
    decision: null,
  };

  // Run through defense pipeline
  const evaluated = await deps.evaluatePipeline(event);

  // Log the event
  deps.logEvent(evaluated);

  // Decision handling
  if (evaluated.decision === 'BLOCK' && deps.mode !== 'monitor') {
    const blockLayer = evaluated.layers.find((l) => l.verdict === 'block');
    const reason = blockLayer?.details ?? 'Blocked by Puffer defense pipeline';

    logger.blocked(reason, blockLayer?.name ?? 'unknown', event.source.agent);

    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: {
        type: 'puffer_blocked',
        message: 'Request blocked by Puffer defense layer',
        layer: blockLayer?.name ?? 'unknown',
        details: reason,
        event_id: event.id,
        puffer_version: VERSION,
      },
    }));
    return;
  }

  // Forward the request
  const targetUrl = deps.resolveTarget(provider);
  if (!targetUrl) {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: {
        type: 'puffer_error',
        message: `No target URL configured for provider: ${provider}`,
        puffer_version: VERSION,
      },
    }));
    return;
  }

  deps.forwardRequest(req, res, targetUrl, bodyBuffer, (statusCode, responseBody, responseHeaders) => {
    // Extract real token usage from provider response
    const usage = extractUsageFromResponse(responseBody, provider);
    const rateLimits = extractRateLimits(responseHeaders);

    // Compute accurate cost if real tokens available, otherwise fall back to estimate
    let costEstimate: number | undefined;
    if (usage.inputTokens > 0 || usage.outputTokens > 0) {
      costEstimate = estimateCostWithOutput(model, usage.inputTokens, usage.outputTokens);
    }

    const responseEvent: PufferEvent = {
      id: uuidv4(),
      timestamp: new Date().toISOString(),
      source: event.source,
      action: { type: 'llm_response', status: statusCode, body: responseBody },
      payload: responseBody,
      metadata: {
        sessionId: deps.sessionId,
        sequenceNumber: deps.sequenceCounter.value++,
        tokenEstimate: usage.totalTokens || estimateResponseTokens(responseBody),
        costEstimate,
        inputTokens: usage.inputTokens || undefined,
        outputTokens: usage.outputTokens || undefined,
        totalTokens: usage.totalTokens || undefined,
        model,
        rateLimits: rateLimits ?? undefined,
      },
      layers: [],
      decision: 'ALLOW' as Decision,
    };

    deps.logEvent(responseEvent);

    const totalMs = evaluated.layers.reduce((sum, l) => sum + l.durationMs, 0);
    logger.allowed(`${req.method} ${url}`, totalMs);
  });
}

function estimateResponseTokens(body: unknown): number {
  if (!body) return 0;
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return Math.ceil(text.length / 4);
}

/**
 * Extract real token usage from LLM provider response bodies.
 * OpenAI format: usage.prompt_tokens, usage.completion_tokens, usage.total_tokens
 * Anthropic format: usage.input_tokens, usage.output_tokens
 */
function extractUsageFromResponse(body: unknown, provider: string): {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
} {
  const empty = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  if (!body || typeof body !== 'object') return empty;

  const b = body as Record<string, unknown>;
  const usage = b.usage as Record<string, unknown> | undefined;
  if (!usage || typeof usage !== 'object') return empty;

  if (provider === 'anthropic') {
    const input = Number(usage.input_tokens ?? 0);
    const output = Number(usage.output_tokens ?? 0);
    return { inputTokens: input, outputTokens: output, totalTokens: input + output };
  }

  // OpenAI and compatible providers
  const prompt = Number(usage.prompt_tokens ?? usage.input_tokens ?? 0);
  const completion = Number(usage.completion_tokens ?? usage.output_tokens ?? 0);
  const total = Number(usage.total_tokens ?? prompt + completion);
  return { inputTokens: prompt, outputTokens: completion, totalTokens: total };
}

/**
 * Extract rate limit info from provider response headers.
 * OpenAI: x-ratelimit-limit-tokens, x-ratelimit-remaining-tokens, etc.
 * Anthropic: anthropic-ratelimit-tokens-limit, anthropic-ratelimit-tokens-remaining, etc.
 */
function extractRateLimits(headers?: IncomingHttpHeaders): RateLimitInfo | null {
  if (!headers) return null;

  const h = (name: string): number | undefined => {
    const val = headers[name];
    const num = Number(typeof val === 'string' ? val : Array.isArray(val) ? val[0] : undefined);
    return isNaN(num) ? undefined : num;
  };

  // Try OpenAI format first
  let limitTokens = h('x-ratelimit-limit-tokens');
  let limitRequests = h('x-ratelimit-limit-requests');
  let remainingTokens = h('x-ratelimit-remaining-tokens');
  let remainingRequests = h('x-ratelimit-remaining-requests');

  // Try Anthropic format
  if (limitTokens === undefined) {
    limitTokens = h('anthropic-ratelimit-tokens-limit');
    limitRequests = h('anthropic-ratelimit-requests-limit');
    remainingTokens = h('anthropic-ratelimit-tokens-remaining');
    remainingRequests = h('anthropic-ratelimit-requests-remaining');
  }

  if (limitTokens === undefined && limitRequests === undefined) return null;

  return { limitTokens, limitRequests, remainingTokens, remainingRequests };
}
