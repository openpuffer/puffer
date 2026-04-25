// Prometheus metrics for Puffer.
//
// All Puffer metrics live on the same registry so the daemon exposes a
// single /metrics endpoint. The metric set is opinionated: it captures
// what an operator monitoring a chatbot or agent deployment actually
// needs (cost, latency, blocks, layer health, agent activity) without
// inflating cardinality with per-request dimensions.
//
// Label conventions:
// - `agent`:    discovered or attributed agent identity (e.g. claude-code)
// - `layer`:    pipeline layer name (pii-scanner, injection-detector, ...)
// - `verdict`:  allow | block | audit | escalate
// - `severity`: critical | high | medium | low
// - `provider`: openai | anthropic | ollama | ...
// - `model`:    model identifier when known (gpt-4o, claude-sonnet-4-5, ...)
// - `kind`:     input | output (for token counts)

import { Counter, Histogram, Gauge, Registry, collectDefaultMetrics } from 'prom-client';

/** Process-wide registry. Consumers expose it via /metrics. */
export const registry = new Registry();

// Default Node.js process metrics (event loop lag, GC, heap, fds, etc.).
// Useful for diagnosing the daemon itself, not just the proxied traffic.
collectDefaultMetrics({ register: registry, prefix: 'puffer_process_' });

// -- Counters ---------------------------------------------------------------

export const eventsTotal = new Counter({
  name: 'puffer_events_total',
  help: 'Total number of events evaluated by the defense pipeline',
  labelNames: ['agent', 'verdict'] as const,
  registers: [registry],
});

export const blocksTotal = new Counter({
  name: 'puffer_blocks_total',
  help: 'Total events blocked by a defense layer',
  labelNames: ['layer', 'severity'] as const,
  registers: [registry],
});

export const auditsTotal = new Counter({
  name: 'puffer_audits_total',
  help: 'Total events flagged for audit by a defense layer',
  labelNames: ['layer', 'severity'] as const,
  registers: [registry],
});

export const escalatesTotal = new Counter({
  name: 'puffer_escalates_total',
  help: 'Total events escalated for human review',
  labelNames: ['layer'] as const,
  registers: [registry],
});

export const layerErrorsTotal = new Counter({
  name: 'puffer_layer_errors_total',
  help: 'Layer execution errors (timeout or thrown exception)',
  labelNames: ['layer', 'reason'] as const,
  registers: [registry],
});

export const llmTokensTotal = new Counter({
  name: 'puffer_llm_tokens_total',
  help: 'Tokens consumed across LLM requests/responses',
  labelNames: ['agent', 'provider', 'model', 'kind'] as const,
  registers: [registry],
});

export const llmCostUsdTotal = new Counter({
  name: 'puffer_llm_cost_usd_total',
  help: 'Estimated USD cost of LLM traffic',
  labelNames: ['agent', 'provider', 'model'] as const,
  registers: [registry],
});

// -- Histograms -------------------------------------------------------------

const layerBuckets = [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5];

export const layerDurationSeconds = new Histogram({
  name: 'puffer_layer_duration_seconds',
  help: 'Wall-clock time spent inside a single defense layer',
  labelNames: ['layer'] as const,
  buckets: layerBuckets,
  registers: [registry],
});

export const pipelineDurationSeconds = new Histogram({
  name: 'puffer_pipeline_duration_seconds',
  help: 'End-to-end wall-clock time spent evaluating a single event through the pipeline',
  buckets: layerBuckets,
  registers: [registry],
});

export const llmRequestDurationSeconds = new Histogram({
  name: 'puffer_llm_request_duration_seconds',
  help: 'Wall-clock time of LLM upstream requests, observed by the proxy',
  labelNames: ['provider', 'model'] as const,
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60],
  registers: [registry],
});

// -- Gauges -----------------------------------------------------------------

export const agentsActive = new Gauge({
  name: 'puffer_agents_active',
  help: 'Number of AI agents currently visible to discovery',
  labelNames: ['protection_status'] as const,
  registers: [registry],
});

export const scoreTotal = new Gauge({
  name: 'puffer_score_total',
  help: 'Latest Puffer posture score (0-100)',
  registers: [registry],
});

export const offlineStatus = new Gauge({
  name: 'puffer_offline_status',
  help: 'Whether a downstream component is currently in offline mode (1 = offline, 0 = online)',
  labelNames: ['component'] as const,
  registers: [registry],
});

export const queueDepth = new Gauge({
  name: 'puffer_queue_depth',
  help: 'Current size of an in-memory queue inside the daemon',
  labelNames: ['queue'] as const,
  registers: [registry],
});

/**
 * Render the registry to Prometheus text exposition format. Async because
 * prom-client may collect metrics from default collectors that read /proc.
 */
export async function renderMetrics(): Promise<{ contentType: string; body: string }> {
  return {
    contentType: registry.contentType,
    body: await registry.metrics(),
  };
}
