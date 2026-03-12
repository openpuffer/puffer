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
npm install -g puffer-agent-firewall

# Initialize (scans your system, creates config, starts daemon)
puffer init

# Or run directly with npx
npx puffer-agent-firewall init
```

## What It Does

Puffer sits between your AI agents and LLM providers, inspecting every request and response through a **7-layer defense pipeline**:

| Layer | Name | What It Detects |
|-------|------|----------------|
| L1 | PII Scanner | SSNs, credit cards, API keys, passwords, private keys, JWTs |
| L2 | Injection Detector | Prompt injection attacks, role switching, data exfiltration |
| L3 | Command Analyzer | Dangerous shell commands (`rm -rf /`, `curl \| bash`, fork bombs) |
| L4 | Network Egress Guard | SSRF attempts, DGA domains, unauthorized outbound calls |
| L5 | Filesystem Sentinel | Access to `~/.ssh`, `~/.aws`, path traversal, secret leakage |
| L6 | Behavior Analyzer | Cost runaway, agent loops, bypass attempts |
| L7 | MCP Detector | Unauthorized MCP servers, tool result poisoning |

## Features

- **Auto-Discovery**: Automatically finds AI agents and LLM servers running on your system
- **Multi-Provider Proxy**: Supports OpenAI, Anthropic, Ollama, LM Studio, DeepSeek, Groq, Together, OpenRouter, and more
- **Zero-Config Defaults**: Works out of the box with sensible security policies
- **Agent Hooks**: Native integration with Claude Code, OpenClaw, and generic env-based routing
- **Real-Time Dashboard**: Web UI at `localhost:8788` with live event streaming
- **Audit Logging**: JSONL audit trail with reporting and retention policies
- **4 Operating Modes**: `monitor` (observe only), `enforce` (block threats), `paranoid` (whitelist-only), `interactive` (ask before blocking)

## Supported Agents

| Agent | Detection Method | Hook Type |
|-------|-----------------|-----------|
| Claude Code | Process scan | Native hook (settings.json) |
| OpenClaw | Process + Port scan | Middleware skill |
| Cursor | Process scan | Env-based proxy |
| Aider | Process scan | Env-based proxy |
| Continue.dev | Process scan | Env-based proxy |
| Cline | Process scan | Env-based proxy |
| GitHub Copilot | Process scan | Env-based proxy |
| Python (LangChain, CrewAI, AutoGen) | Process scan | Env-based proxy |

## Supported LLM Providers

| Provider | Type | Auto-Discovery |
|----------|------|---------------|
| OpenAI | Cloud | Network scan |
| Anthropic | Cloud | Network scan |
| Ollama | Local | Port 11434 |
| LM Studio | Local | Port 1234 |
| LocalAI | Local | Port 8080 |
| vLLM | Local | Port 8000 |
| DeepSeek | Cloud | Network scan |
| Groq | Cloud | Network scan |
| Together | Cloud | Network scan |
| OpenRouter | Cloud | Network scan |

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
mode: enforce  # monitor | enforce | paranoid | interactive

layers:
  pii:
    enabled: true
    regions: ["us", "eu", "global"]
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
      - "sudo *"
      - "npm publish *"

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

## Development

```bash
# Clone and install
git clone <repo-url>
cd puffer
npm install

# Build
npm run build

# Run tests (97 tests across 9 files)
npm test

# Type check
npm run lint

# Build dashboard
cd dashboard
npm install
npm run build
```

## License

Apache 2.0 — see [LICENSE](LICENSE) for details.
