# Getting Started — Local Hacking on Puffer

This guide is for the moment after the workspace migration: you've
just cloned (or pulled) the monorepo and want to run Puffer end-to-end
on your machine, with metrics, logs, and traces wired up.

## 1. Install dependencies

```bash
npm install
```

That installs every workspace package in one shot via npm workspaces.
You should see the symlink graph created under `node_modules/@puffer/*`.

## 2. Run the CLI from source (no build step needed)

`tsx` is wired up as a `devDependency` so you can drive the CLI
straight from TypeScript without compiling first. Useful while you're
making changes — no stale `dist/` to fight with.

```bash
# Inspect the command surface
npm run puffer -- --help
npm run puffer -- --version

# Run a one-shot discovery scan
npm run puffer -- scan

# Compute the posture score (no daemon required)
npm run puffer -- score
```

When you actually want the daemon resident (proxy + dashboard up,
hooks installed, all the layers running), use:

```bash
npm run puffer:daemon
```

That blocks the terminal with the daemon foreground process. `Ctrl-C`
or `puffer stop` from another shell to take it down.

## 3. Smoke-check the test suite

```bash
npm run typecheck    # tsc --noEmit across every workspace
npm run lint         # ESLint flat config, all packages + apps
npm run format:check # Prettier
npm test             # Vitest — should report 243 passing tests
```

If any of those four don't come back green on your machine, that's a
bug in the migration, not in your environment.

## 4. Spin up the observability stack (optional)

The repo ships a Docker Compose file that brings up Prometheus,
Grafana, Loki, and Jaeger pre-wired against the daemon running on your
host:

```bash
docker compose -f docker-compose.observability.yaml up -d
```

Wait ~10 seconds for the containers to come up, then:

| Service    | URL                    | Default credentials |
| ---------- | ---------------------- | ------------------- |
| Grafana    | http://localhost:3001  | admin / admin       |
| Prometheus | http://localhost:9090  | —                   |
| Jaeger UI  | http://localhost:16686 | —                   |
| Loki API   | http://localhost:3100  | —                   |

Now start Puffer with all three observability surfaces enabled:

```bash
PUFFER_OTEL_EXPORTER_ENDPOINT=http://localhost:4318/v1/traces \
PUFFER_LOG_FORMAT=json \
  npm run puffer:daemon
```

You should see:

1. `OpenTelemetry tracing enabled → http://localhost:4318/v1/traces`
   in the daemon log.
2. JSON-line log output instead of the colorized banner.
3. `curl http://localhost:8788/metrics` returning Prometheus metrics.
4. After firing a request through the proxy, a corresponding trace in
   Jaeger with one parent span (`puffer.pipeline.evaluate`) and child
   spans for each layer (`puffer.layer.<name>`).

## 5. Send a test request through the proxy

The proxy listens on `:8787` by default. With the daemon running:

```bash
curl -X POST http://127.0.0.1:8787/v1/messages \
  -H 'Content-Type: application/json' \
  -H 'x-puffer-original-host: api.anthropic.com' \
  -H 'anthropic-version: 2023-06-01' \
  -d '{"model":"claude-sonnet-4-5","messages":[{"role":"user","content":"hello"}]}'
```

Without an upstream API key configured for Anthropic, you'll get a
`401` from the upstream — that's expected. What matters is that
Puffer's pipeline ran: check Grafana for a `puffer_events_total`
increment and Jaeger for the trace.

To exercise the **block** path, send an obvious PII payload:

```bash
curl -X POST http://127.0.0.1:8787/v1/messages \
  -H 'Content-Type: application/json' \
  -H 'x-puffer-original-host: api.anthropic.com' \
  -d '{"model":"claude-sonnet-4-5","messages":[{"role":"user","content":"My SSN is 123-45-6789"}]}'
```

Expected response: HTTP 403 with `error.type: "puffer_blocked"` and
the layer name in the body.

## 6. Stop everything

```bash
# Daemon (the puffer:daemon shell)
Ctrl-C

# Or graceful stop from another terminal
npm run puffer -- stop

# Take down the observability stack
docker compose -f docker-compose.observability.yaml down
```

## Troubleshooting

| Symptom                                              | Likely cause                                                                                                                                        |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Cannot find module '@puffer/*'`                     | Forgot to run `npm install` after pulling — workspaces aren't linked.                                                                               |
| Tests pass locally but CI fails                      | CI runs the full matrix on Node 18/20/22; we develop on 20+. Check the Actions log for which node version broke.                                    |
| `EADDRINUSE: address already in use :::8787`         | A previous daemon left the proxy running. `puffer stop --force`, or `lsof -i :8787` to find it.                                                     |
| Jaeger doesn't show traces                           | Confirm `PUFFER_OTEL_EXPORTER_ENDPOINT` was set in the same shell as the daemon, and that the daemon log printed `OpenTelemetry tracing enabled →`. |
| Prometheus shows `state: down` for the puffer target | The daemon's dashboard port was in use; check `puffer status` for the actual bound port and update `etc/prometheus.yml`.                            |

## Where to look next

- [observability.md](observability.md) — full metric catalog, PromQL examples, integration recipes.
- [overview.md](overview.md) — high-level architecture and the 7-layer model.
- [implementation-phases.md](implementation-phases.md) — original build phases and design decisions.
- `docs/PROGRESS.md` — running history of every refactor commit.
