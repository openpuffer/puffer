# PUFFER

```
    🐡 P U F F E R
    The autonomous immune system for AI agents.
    ─────────────────────────────────────────────
```

**Puffer** is a local-first security daemon that protects AI agents from prompt injection, PII leakage, dangerous commands, and more. It acts like a subconscious immune system — always running, detects threats before they cause harm, and acts on instinct.

> "Assume the agent will be compromised — contain the blast radius."

## Quick Start

```bash
# Install globally
npm install -g openpuffer

# Initialize (scans your system, creates config, starts daemon)
puffer init

# Or run directly with npx
npx openpuffer init
```

## What It Does

Puffer sits between your AI agents and LLM providers, inspecting every request and response through a **7-layer defense pipeline**:

| Layer | Name                 | What It Detects                                                   |
| ----- | -------------------- | ----------------------------------------------------------------- |
| L1    | PII Scanner          | SSNs, credit cards, API keys, passwords, private keys, JWTs       |
| L2    | Injection Detector   | Prompt injection attacks, role switching, data exfiltration       |
| L3    | Command Analyzer     | Dangerous shell commands (`rm -rf /`, `curl \| bash`, fork bombs) |
| L4    | Network Egress Guard | SSRF attempts, DGA domains, unauthorized outbound calls           |
| L5    | Filesystem Sentinel  | Access to `~/.ssh`, `~/.aws`, path traversal, secret leakage      |
| L6    | Behavior Analyzer    | Cost runaway, agent loops, bypass attempts                        |
| L7    | MCP Detector         | Unauthorized MCP servers, tool result poisoning                   |

## Features

- **Auto-Discovery**: Automatically finds AI agents and LLM servers running on your system
- **Multi-Provider Proxy**: Supports OpenAI, Anthropic, Ollama, LM Studio, DeepSeek, Groq, Together, OpenRouter, and more
- **Zero-Config Defaults**: Works out of the box with sensible security policies
- **Agent Hooks**: Native integration with Claude Code, OpenClaw, and generic env-based routing
- **Real-Time Dashboard**: Web UI at `localhost:8788` with live event streaming
- **Audit Logging**: JSONL audit trail with reporting and retention policies
- **4 Operating Modes**: `monitor` (observe only), `enforce` (block threats), `paranoid` (whitelist-only), `interactive` (ask before blocking)

## Supported Agents

| Agent                               | Detection Method    | Hook Type                   |
| ----------------------------------- | ------------------- | --------------------------- |
| Claude Code                         | Process scan        | Native hook (settings.json) |
| OpenClaw                            | Process + Port scan | Middleware skill            |
| Cursor                              | Process scan        | Env-based proxy             |
| Aider                               | Process scan        | Env-based proxy             |
| Continue.dev                        | Process scan        | Env-based proxy             |
| Cline                               | Process scan        | Env-based proxy             |
| GitHub Copilot                      | Process scan        | Env-based proxy             |
| Python (LangChain, CrewAI, AutoGen) | Process scan        | Env-based proxy             |

## Supported LLM Providers

| Provider   | Type  | Auto-Discovery |
| ---------- | ----- | -------------- |
| OpenAI     | Cloud | Network scan   |
| Anthropic  | Cloud | Network scan   |
| Ollama     | Local | Port 11434     |
| LM Studio  | Local | Port 1234      |
| LocalAI    | Local | Port 8080      |
| vLLM       | Local | Port 8000      |
| DeepSeek   | Cloud | Network scan   |
| Groq       | Cloud | Network scan   |
| Together   | Cloud | Network scan   |
| OpenRouter | Cloud | Network scan   |

## CLI Commands

```bash
puffer init        # First-time setup: scan, configure, start
puffer scan        # Run discovery scan
puffer status      # Show protection status
puffer logs        # View audit log (add -f to follow)
puffer logs --report  # Generate audit report
puffer config show # Display current config
puffer start       # Start daemon
puffer stop        # Stop daemon
puffer inflate     # Switch to paranoid mode 🐡💨
puffer deflate     # Switch back to normal mode
```

## Configuration

Puffer uses YAML configuration at `~/.puffer/config.yaml`. Edit manually or use the dashboard.

```yaml
mode: enforce # monitor | enforce | paranoid | interactive

layers:
  pii:
    enabled: true
    regions: ['us', 'eu', 'global']
    action_by_severity:
      critical: block
      high: block
      medium: audit

  injection:
    enabled: true
    mode: heuristic
    thresholds:
      direct_input:
        block: 0.65
        audit: 0.40

  commands:
    enabled: true
    require_approval:
      - 'sudo *'
      - 'npm publish *'

  behavior:
    max_cost_per_session_usd: 10.00
    max_cost_per_hour_usd: 20.00
```

## How It Works

Like the human immune system:

1. **Always Running** — Puffer daemon scans for agents and threats continuously
2. **Auto-Detection** — Discovers AI agents via process scanning, port probing, and network monitoring
3. **Layered Defense** — Every action passes through 7 independent defense layers
4. **Short-Circuit** — If ANY layer detects a threat, the action is blocked immediately
5. **Learns Context** — Behavior analysis tracks sessions, costs, and patterns
6. **Local-First** — All processing happens on your machine. Zero cloud calls.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    PUFFER DAEMON                            │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ AUTO-DISCOVER │  │ LLM PROXY    │  │ AGENT HOOKS  │      │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘      │
│         └─────────────────┼─────────────────┘               │
│                           ▼                                 │
│              ┌────────────────────────┐                     │
│              │  7-LAYER DEFENSE ENGINE │                     │
│              └────────────┬───────────┘                     │
│                           ▼                                 │
│              ┌────────────────────────┐                     │
│              │  DECISION ENGINE       │                     │
│              │  ALLOW/BLOCK/AUDIT/    │                     │
│              │  ESCALATE              │                     │
│              └────────────┬───────────┘                     │
│                           ▼                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ AUDIT LOG    │  │ DASHBOARD    │  │ ALERTS       │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
```

## Repository Layout

Puffer is an npm-workspaces monorepo. The source ships as 24 private
packages plus three apps:

```
apps/
  cli/         @puffer/cli         — thin commander wrapper
  daemon/      @puffer/daemon      — orchestration (proxy + pipeline + hooks)
  dashboard/   Vite + React frontend (localhost:8788 UI)
packages/
  core/        types, schemas, logger, constants, config loader
  engine/      DefensePipeline + DecisionEngine + PolicyEngine
  rules/       YAML community rule loader + remote registry updater
  layers/{pii,injection,commands,network,filesystem,behavior,mcp}
  proxy/       HTTP proxy + provider adapters + SSE parser
  discovery/   process / port / network scanners
  hooks/       agent integrations (Claude Code, Cursor, Aider, …)
  alerts/      dispatcher + webhook / desktop channels
  audit/       JSONL audit log + reporter
  cloud/       optional cloud reporter
  dashboard/   Express + WebSocket backend
  observability/ Prometheus metrics, structured logs, OpenTelemetry
  reports/     weekly threat report
  redteam/     simulation runner
  score/       posture score calculator
```

## Development

```bash
# Clone and install — npm workspaces wires every package as symlinks
git clone <repo-url>
cd puffer
npm install

# Smoke-check the gates
npm run typecheck    # strict TS + project references across all 24 packages
npm run lint         # ESLint (custom rules block empty catches and silent .catch)
npm run format:check # Prettier
npm test             # Vitest — should report 249+ tests

# Run from TS source while iterating (no build step needed)
npm run puffer -- --help
npm run puffer -- score
npm run puffer:daemon

# Compile every package to dist/ and run the production binary
npm run build        # tsc -b apps/cli apps/daemon
npm run puffer:prod -- score
node apps/daemon/dist/index.js  # equivalent of `npm run start`

# Auto-fix lint / format issues
npm run lint:fix
npm run format
```

For a full end-to-end walkthrough — including the optional Docker
Compose observability stack with Prometheus, Grafana, Loki, and
Jaeger — see **[docs/architecture/getting-started.md](docs/architecture/getting-started.md)**.

## Observability

Puffer ships first-class Prometheus metrics, structured JSON logs, and
OpenTelemetry traces:

```bash
# Live metrics (Prometheus text exposition format)
curl -s http://localhost:8788/metrics | head -20

# JSON-line logs for Loki / Datadog / CloudWatch
PUFFER_LOG_FORMAT=json npm run puffer:daemon

# OTel traces to a collector (Jaeger, Honeycomb, Tempo, ...)
PUFFER_OTEL_EXPORTER_ENDPOINT=http://localhost:4318/v1/traces \
  npm run puffer:daemon
```

The full metric catalog, PromQL examples, and integration recipes live
in [docs/architecture/observability.md](docs/architecture/observability.md).

## Security

Puffer is a security project — vulnerabilities have outsized impact on
everything Puffer protects. **Do not file public GitHub issues for
security problems.** See [SECURITY.md](SECURITY.md) for the disclosure
process and contact details.

## Documentation

- [Getting started](docs/architecture/getting-started.md) — local hacking runbook (install → tests → docker stack → smoke request)
- [Observability](docs/architecture/observability.md) — metrics catalog, PromQL, integration recipes
- [Architecture overview](docs/architecture/overview.md) — project identity, high-level architecture, repo structure
- [Implementation phases](docs/architecture/implementation-phases.md) — the 6 build phases (proxy, discovery, 7-layer pipeline, CLI, dashboard, hooks)
- [Configuration & audit](docs/architecture/operations.md) — config schema and audit logging
- [Testing strategy](docs/architecture/testing.md) — adversarial + unit test approach
- [Packaging & release](docs/architecture/packaging-and-release.md) — npm distribution, build order
- [Refactor progress log](docs/PROGRESS.md) — five-session modernization log

## License

Apache 2.0 — see [LICENSE](LICENSE) for details.
