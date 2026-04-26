# Observability

Puffer ships with first-class observability so a single deploy can serve as
both the security firewall and the metrics + logs source for every chatbot,
agent, or Claude/OpenAI integration that flows through the proxy.

There are two complementary surfaces: **Prometheus metrics** (numeric
time-series, ideal for Grafana dashboards and alerting) and **structured
JSON logs** (one event per line, ideal for Loki / Datadog / CloudWatch).

## Prometheus metrics

The dashboard server exposes `GET /metrics` in standard Prometheus text
exposition format. The dashboard server is bound to `127.0.0.1` only (see
the localhost middleware in `packages/dashboard/src/server.ts`), so by
default no remote scraper can hit the endpoint. Operators who need to
expose metrics externally can put a reverse proxy in front of the daemon.

```bash
# Verify the endpoint is alive
curl -s http://127.0.0.1:8788/metrics | head -20
```

### Metric reference

| Metric                                | Type      | Labels                                              | What it captures                                                                    |
| ------------------------------------- | --------- | --------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `puffer_events_total`                 | counter   | `agent`, `verdict`                                  | Every event evaluated by the pipeline, bucketed by allow / block / audit / escalate |
| `puffer_blocks_total`                 | counter   | `layer`, `severity`                                 | Events stopped by a defense layer, with the worst severity that triggered           |
| `puffer_audits_total`                 | counter   | `layer`, `severity`                                 | Events flagged for audit but not blocked                                            |
| `puffer_escalates_total`              | counter   | `layer`                                             | Events escalated for human review                                                   |
| `puffer_layer_errors_total`           | counter   | `layer`, `reason=timeout\|exception`                | Layer execution failures by mode                                                    |
| `puffer_llm_tokens_total`             | counter   | `agent`, `provider`, `model`, `kind=input\|output`  | Tokens consumed across LLM calls                                                    |
| `puffer_llm_cost_usd_total`           | counter   | `agent`, `provider`, `model`                        | Estimated USD cost from real provider usage                                         |
| `puffer_layer_duration_seconds`       | histogram | `layer`                                             | Wall-clock per-layer latency                                                        |
| `puffer_pipeline_duration_seconds`    | histogram | —                                                   | End-to-end evaluation time per event                                                |
| `puffer_llm_request_duration_seconds` | histogram | `provider`, `model`                                 | Upstream LLM round-trip latency                                                     |
| `puffer_agents_active`                | gauge     | `protection_status=protected\|partial\|unprotected` | Snapshot from each discovery scan                                                   |
| `puffer_score_total`                  | gauge     | —                                                   | Latest Puffer posture score (0–100)                                                 |
| `puffer_offline_status`               | gauge     | `component`                                         | 1 if a downstream component is offline                                              |
| `puffer_queue_depth`                  | gauge     | `queue`                                             | Current size of an in-memory queue                                                  |
| `puffer_process_*`                    | various   | —                                                   | Standard Node.js process metrics (event-loop lag, GC, heap, fds)                    |

### Example PromQL

```promql
# Block rate over the last 5 minutes per layer
sum by (layer) (rate(puffer_blocks_total[5m]))

# 95th-percentile pipeline latency
histogram_quantile(0.95, sum by (le) (rate(puffer_pipeline_duration_seconds_bucket[5m])))

# LLM spend per agent in the last hour (USD)
sum by (agent) (increase(puffer_llm_cost_usd_total[1h]))

# Tokens-per-minute by model
sum by (model) (rate(puffer_llm_tokens_total[1m]))
```

## Structured JSON logs

Two activation paths, depending on what you want to capture:

### 1. `PUFFER_LOG_FORMAT=json` (operator-level switch)

Setting this environment variable swaps the colorized CLI output of the
core logger for one JSON line per call. `info` / `debug` go to stdout,
`warn` / `error` go to stderr — same convention as `console.warn`.

```bash
PUFFER_LOG_FORMAT=json puffer start

# Pipe the daemon log through jq while developing
puffer start 2>&1 | jq 'select(.level == "block")'
```

Every line carries `timestamp`, `level`, `msg`. Block events also include
`layer` and `agent`; allow events include `duration_ms`. Free-form details
arrive as a `details` array.

### 2. `logEvent` and `withTraceContext` (call-site, trace-correlated)

When you need a search like "show me everything Puffer did for request
`abc-123`", the call sites that participate in a request use the
trace-correlated helpers from `@puffer/observability`:

```ts
import { logEvent, withTraceContext } from '@puffer/observability';

// Single line bound to one event:
logEvent(event, 'info', 'request received', { endpoint: req.url });

// Bind once, log many times:
const log = withTraceContext(event);
log.info('layer pii_scanner started');
log.warn('layer pii_scanner near threshold', { confidence: 0.62 });
```

Every line emits JSON regardless of `PUFFER_LOG_FORMAT`. The `trace_id`
field equals `event.id`, so a single grep across logs returns every step
of one request — proxy entry, layer evaluations, alert dispatch.

```jsonc
{
  "timestamp": "2026-04-25T19:42:00.123Z",
  "level": "info",
  "msg": "layer pii_scanner started",
  "trace_id": "evt-abc-123",
  "agent": "claude-code",
  "provider": "anthropic",
  "model": "claude-sonnet-4-5",
}
```

## OpenTelemetry traces (planned)

Nivel 3 of the observability roadmap. Not implemented yet — open a feature
request if you have a concrete use case (Honeycomb, Datadog APM, Tempo).
Until then, the trace_id in structured logs already correlates
within-Puffer execution; what's missing is propagating that context
upstream to the LLM provider via W3C `traceparent` headers.

## Integration recipes

### Grafana + Prometheus (local)

```yaml
# prometheus.yml
scrape_configs:
  - job_name: puffer
    static_configs:
      - targets: ['127.0.0.1:8788']
    metrics_path: /metrics
    scrape_interval: 15s
```

### Loki

```bash
# Run the daemon with JSON output and ship to Loki via Promtail / Vector
PUFFER_LOG_FORMAT=json puffer start | vector --config=vector-loki.toml
```

### Datadog

Datadog Agent reads JSON line logs natively when you set
`source: puffer` in the integration config; every line carries
`level`, `msg`, and optionally `trace_id`, which Datadog renders as a
clickable correlation pivot.
