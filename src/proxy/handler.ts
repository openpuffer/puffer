import { IncomingMessage, ServerResponse } from 'node:http';
import { v4 as uuidv4 } from 'uuid';
import { PufferEvent, EventAction, Decision } from '../types.js';
import { detectProvider, getAdapter } from './providers.js';
import { VERSION } from '../utils/constants.js';
import { logger } from '../utils/logger.js';

export interface ProxyDependencies {
  evaluatePipeline: (event: PufferEvent) => Promise<PufferEvent>;
  logEvent: (event: PufferEvent) => void;
  forwardRequest: (
    req: IncomingMessage,
    res: ServerResponse,
    targetUrl: string,
    body: Buffer,
    onResponse: (statusCode: number, responseBody: unknown) => void
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

  deps.forwardRequest(req, res, targetUrl, bodyBuffer, (statusCode, responseBody) => {
    // Create response event for auditing
    const responseEvent: PufferEvent = {
      id: uuidv4(),
      timestamp: new Date().toISOString(),
      source: event.source,
      action: { type: 'llm_response', status: statusCode, body: responseBody },
      payload: responseBody,
      metadata: {
        sessionId: deps.sessionId,
        sequenceNumber: deps.sequenceCounter.value++,
        tokenEstimate: estimateResponseTokens(responseBody),
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
