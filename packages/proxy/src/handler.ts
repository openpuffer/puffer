import type { IncomingMessage, IncomingHttpHeaders, ServerResponse } from 'node:http';
import { v4 as uuidv4 } from 'uuid';
import type { PufferEvent, EventAction, Decision, RateLimitInfo } from '@puffer/core';
import { detectProvider, getAdapter, estimateCostWithOutput } from './providers.js';
import { VERSION } from '@puffer/core';
import { logger } from '@puffer/core';
import { llmCostUsdTotal, llmRequestDurationSeconds, llmTokensTotal } from '@puffer/observability';
import { extractRequestSnippet, extractResponseSnippet } from './snippet.js';

export interface ProxyDependencies {
  evaluatePipeline: (event: PufferEvent) => Promise<PufferEvent>;
  logEvent: (event: PufferEvent) => void;
  forwardRequest: (
    req: IncomingMessage,
    res: ServerResponse,
    targetUrl: string,
    body: Buffer,
    onResponse: (
      statusCode: number,
      responseBody: unknown,
      responseHeaders?: IncomingHttpHeaders,
    ) => void,
  ) => void;
  resolveTarget: (provider: string) => string | null;
  sessionId: string;
  sequenceCounter: { value: number };
  mode: 'monitor' | 'enforce' | 'paranoid' | 'interactive';
  passthrough: boolean;
  /** Returns names of agents currently detected by discovery engine */
  getDiscoveredAgentNames?: (() => string[]) | undefined;
}

/**
 * Agents that route traffic through the OpenAI-compatible SDK.
 * Listed in attribution priority order: the first match wins.
 * Add new agents here rather than inline in inferAgent.
 */
export const KNOWN_OPENAI_SDK_AGENTS = [
  'openclaw',
  'openclaw-gateway',
  'python-openai',
  'python-langchain',
  'python-crewai',
  'python-autogen',
  'aurora',
] as const;

/**
 * Agents that route traffic through the Anthropic SDK.
 * Listed in attribution priority order: the first match wins.
 * Add new agents here rather than inline in inferAgent.
 */
export const KNOWN_ANTHROPIC_SDK_AGENTS = [
  'claude-code',
  'claude-cli',
  'anthropic-client',
  'python-anthropic',
] as const;

/**
 * Infer the agent identity from request headers and body when
 * the explicit x-puffer-agent header is missing.
 *
 * Detection priority:
 *  1. Exact agent name in User-Agent header (e.g. "aider/0.5", "Cline/2.0")
 *  2. Anthropic SDK fingerprint (User-Agent "Anthropic/JS" or "anthropic-python",
 *     or presence of anthropic-version header) → attribute to claude-code if
 *     it's among discovered agents, since Claude Code is the agent that sets
 *     ANTHROPIC_BASE_URL to route through the proxy.
 *  3. OpenAI SDK fingerprint ("OpenAI/" in User-Agent) → attribute to the
 *     first discovered agent that appears in KNOWN_OPENAI_SDK_AGENTS (priority
 *     order). If none match but exactly one agent was discovered, return it.
 *  4. If process discovery found exactly one agent, attribute to it.
 */
export function inferAgent(
  headers: Record<string, string | string[] | undefined>,
  discoveredAgentNames?: string[],
): string {
  const ua = String(headers['user-agent'] ?? '');
  const uaLower = ua.toLowerCase();

  // 1. Exact agent name in User-Agent
  if (/aider/i.test(ua)) return 'aider';
  if (/cursor/i.test(ua)) return 'cursor';
  if (/cline/i.test(ua)) return 'cline';
  if (/continue/i.test(ua)) return 'continue-dev';
  if (/copilot/i.test(ua)) return 'github-copilot';
  if (/windsurf/i.test(ua)) return 'windsurf';
  if (/codeium/i.test(ua)) return 'codeium';
  if (/openclaw|clawdbot/i.test(ua)) return 'openclaw';
  if (/claude[-_]?code\b/i.test(ua)) return 'claude-code';
  if (/claude-cli\b/i.test(ua)) return 'claude-cli';

  // 2. Anthropic SDK fingerprint: "Anthropic/JS ...", "anthropic-python/...",
  //    "claude-cli/..." UA prefix, or the presence of the anthropic-version header.
  const isAnthropicSDK =
    uaLower.includes('anthropic/') ||
    uaLower.includes('anthropic-') ||
    /claude-cli\b/i.test(ua) ||
    !!headers['anthropic-version'];

  if (isAnthropicSDK && discoveredAgentNames) {
    // Walk the priority list and return the first discovered agent that matches.
    for (const knownAgent of KNOWN_ANTHROPIC_SDK_AGENTS) {
      if (discoveredAgentNames.includes(knownAgent)) return knownAgent;
    }
  }

  // 3. OpenAI SDK fingerprint
  const isOpenAISDK = uaLower.includes('openai/');
  if (isOpenAISDK && discoveredAgentNames) {
    // Walk the priority list and return the first discovered agent that matches.
    for (const knownAgent of KNOWN_OPENAI_SDK_AGENTS) {
      if (discoveredAgentNames.includes(knownAgent)) return knownAgent;
    }
    // No known agent matched — if exactly one unknown agent was discovered, attribute to it.
    if (discoveredAgentNames.length === 1) {
      const only = discoveredAgentNames[0];
      if (only !== undefined) return only;
    }
  }

  // 4. Single discovered agent fallback
  if (discoveredAgentNames && discoveredAgentNames.length === 1) {
    const only = discoveredAgentNames[0];
    if (only !== undefined) return only;
  }

  return 'unknown';
}

export async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  bodyBuffer: Buffer,
  deps: ProxyDependencies,
): Promise<void> {
  const url = req.url ?? '/';

  // Health check endpoint — used by daemon startup, env.sh guard, and liveness probes
  if (url === '/__puffer/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', version: VERSION, pid: process.pid }));
    return;
  }

  // Passthrough mode: skip all defense layers, just forward transparently.
  // Used during graceful shutdown so existing sessions keep working.
  if (deps.passthrough) {
    const headers = req.headers as Record<string, string | string[] | undefined>;
    let body: unknown;
    try {
      body = bodyBuffer.length > 0 ? JSON.parse(bodyBuffer.toString('utf-8')) : {};
    } catch {
      body = {};
    }
    const provider = detectProvider(url, headers, body);
    const targetUrl = deps.resolveTarget(provider);
    if (!targetUrl) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: { type: 'puffer_error', message: `No target for provider: ${provider}` },
        }),
      );
      return;
    }
    deps.forwardRequest(req, res, targetUrl, bodyBuffer, () => {});
    return;
  }

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

  const agent = headers['x-puffer-agent']
    ? String(headers['x-puffer-agent'])
    : inferAgent(headers, deps.getDiscoveredAgentNames?.());

  // Capture raw debug info when agent can't be identified
  const debugInfo =
    agent === 'unknown' ? captureDebugInfo(headers, req.method ?? 'POST', url) : undefined;

  const event: PufferEvent = {
    id: uuidv4(),
    timestamp: new Date().toISOString(),
    source: {
      type: 'proxy',
      agent,
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
      debugInfo,
      snippet: extractRequestSnippet(body),
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
    res.end(
      JSON.stringify({
        error: {
          type: 'puffer_blocked',
          message: 'Request blocked by Puffer defense layer',
          layer: blockLayer?.name ?? 'unknown',
          details: reason,
          event_id: event.id,
          puffer_version: VERSION,
        },
      }),
    );
    return;
  }

  // Forward the request
  const targetUrl = deps.resolveTarget(provider);
  if (!targetUrl) {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        error: {
          type: 'puffer_error',
          message: `No target URL configured for provider: ${provider}`,
          puffer_version: VERSION,
        },
      }),
    );
    return;
  }

  const upstreamStart = Date.now();

  deps.forwardRequest(
    req,
    res,
    targetUrl,
    bodyBuffer,
    (statusCode, responseBody, responseHeaders) => {
      llmRequestDurationSeconds
        .labels(provider, model)
        .observe((Date.now() - upstreamStart) / 1000);

      // Extract real token usage from provider response
      const usage = extractUsageFromResponse(responseBody, provider);
      const rateLimits = extractRateLimits(responseHeaders);

      // Compute accurate cost if real tokens available, otherwise fall back to estimate
      let costEstimate: number | undefined;
      if (usage.inputTokens > 0 || usage.outputTokens > 0) {
        costEstimate = estimateCostWithOutput(model, usage.inputTokens, usage.outputTokens);
      }

      if (usage.inputTokens > 0)
        llmTokensTotal.labels(agent, provider, model, 'input').inc(usage.inputTokens);
      if (usage.outputTokens > 0)
        llmTokensTotal.labels(agent, provider, model, 'output').inc(usage.outputTokens);
      if (costEstimate !== undefined && costEstimate > 0)
        llmCostUsdTotal.labels(agent, provider, model).inc(costEstimate);

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
          snippet: extractResponseSnippet(responseBody),
        },
        layers: [],
        decision: null,
      };

      // Run LLM response through defense pipeline (PII, injection detection, etc.)
      deps
        .evaluatePipeline(responseEvent)
        .then((evaluatedResponse) => {
          deps.logEvent(evaluatedResponse);

          if (evaluatedResponse.decision === 'BLOCK') {
            const blockLayer = evaluatedResponse.layers.find((l) => l.verdict === 'block');
            logger.blocked(
              `Response contained blocked content: ${blockLayer?.details ?? 'unknown'}`,
              blockLayer?.name ?? 'unknown',
              event.source.agent,
            );
          }
        })
        .catch((err) => {
          // If pipeline fails, still log the response with ALLOW
          responseEvent.decision = 'ALLOW' as Decision;
          deps.logEvent(responseEvent);
          logger.error(`Response pipeline error: ${(err as Error).message}`);
        });

      // Total defense pipeline duration (request-side layers only, not round-trip)
      const totalMs = evaluated.layers.reduce((sum, l) => sum + l.durationMs, 0);
      logger.allowed(`${req.method} ${url}`, totalMs);
    },
  );
}

/**
 * Capture raw request info for debugging unidentified agents.
 * Extracts headers relevant for fingerprinting (User-Agent, SDK headers, etc.)
 */
function captureDebugInfo(
  headers: Record<string, string | string[] | undefined>,
  method: string,
  endpoint: string,
): NonNullable<PufferEvent['metadata']['debugInfo']> {
  const debugHeaders: Record<string, string> = {};

  // Capture all potentially useful headers for agent identification
  const interestingHeaders = [
    'user-agent',
    'anthropic-version',
    'x-stainless-lang',
    'x-stainless-runtime',
    'x-stainless-runtime-version',
    'x-stainless-os',
    'x-stainless-arch',
    'x-stainless-retry-count',
    'x-stainless-timeout',
    'openai-organization',
    'x-request-id',
    'x-api-key', // will be masked below
    'authorization', // will be masked below
    'accept',
    'content-type',
    'host',
    'origin',
    'referer',
  ];

  for (const name of interestingHeaders) {
    const val = headers[name];
    if (val === undefined) continue;
    let strVal = Array.isArray(val) ? (val[0] ?? '') : String(val);

    // Mask sensitive values — show only prefix for identification
    if (name === 'x-api-key' || name === 'authorization') {
      strVal = strVal.length > 12 ? strVal.slice(0, 12) + '...' : '***';
    }

    debugHeaders[name] = strVal;
  }

  return {
    userAgent: String(headers['user-agent'] ?? ''),
    headers: debugHeaders,
    method,
    endpoint,
  };
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
function extractUsageFromResponse(
  body: unknown,
  provider: string,
): {
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
