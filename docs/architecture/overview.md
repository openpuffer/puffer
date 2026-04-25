# Architecture Overview

> Extracted from PUFFER-GUIDE.md (sections 1–3).

## 1. Project Identity

- **Name**: Puffer
- **Tagline**: "The autonomous immune system for AI agents."
- **Mascot**: Pufferfish 🐡 — small and silent, inflates when threatened
- **Philosophy**: Like the human subconscious — always running, detects threats before you're aware, acts on instinct
- **Core principle**: "Assume the agent will be compromised — contain the blast radius."
- **Language**: The project is written primarily in **TypeScript/Node.js** for the MVP (not Rust). Reason: fastest path to working product, same ecosystem as OpenClaw and most AI agent tools, easy to contribute to, Claude Code is excellent at TypeScript. Rust can be introduced later for performance-critical paths.
- **License**: Apache 2.0 for core, BSL (Business Source License) for enterprise features (added later)

---

## 2. Architecture Overview

### 2.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    PUFFER DAEMON                             │
│                  (always running)                            │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ AUTO-DISCOVER │  │ LLM PROXY    │  │ AGENT HOOKS  │      │
│  │              │  │              │  │              │      │
│  │ • Process    │  │ • HTTP proxy │  │ • Claude Code│      │
│  │   scanner    │  │ • Intercepts │  │ • OpenClaw   │      │
│  │ • Port       │  │   all LLM    │  │ • Cursor     │      │
│  │   scanner    │  │   API calls  │  │ • LangChain  │      │
│  │ • Network    │  │ • Cloud +    │  │ • Custom     │      │
│  │   scanner    │  │   Local      │  │              │      │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘      │
│         │                 │                 │               │
│         └─────────────────┼─────────────────┘               │
│                           ▼                                 │
│              ┌────────────────────────┐                     │
│              │  7-LAYER DEFENSE ENGINE │                     │
│              │                        │                     │
│              │  L1: PII Scanner       │                     │
│              │  L2: Prompt Injection   │                     │
│              │  L3: Command Analyzer   │                     │
│              │  L4: Network Egress     │                     │
│              │  L5: Filesystem Sentinel│                     │
│              │  L6: Behavior Analyzer  │                     │
│              │  L7: MCP Poisoning      │                     │
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
│  │ (JSONL)      │  │ (localhost)  │  │ (webhook)    │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 Data Flow for a Single Action

1. An agent (OpenClaw, Claude Code, Python script, etc.) makes a request
2. The request is intercepted by either the LLM Proxy or an Agent Hook
3. The request is wrapped in a standardized `PufferEvent` object
4. The `PufferEvent` passes through the 7-Layer Defense Pipeline sequentially
5. If ANY layer returns `BLOCK`, the pipeline short-circuits immediately
6. The Decision Engine returns: `ALLOW`, `BLOCK`, `AUDIT`, or `ESCALATE`
7. The action is executed (or blocked), and the full event is logged to the audit trail

### 2.3 Key Design Decisions

- **Node.js + TypeScript**: Same ecosystem as OpenClaw, Claude Code, and most AI tooling
- **Single binary via `npx`**: Zero-install experience. `npx puffer init` and it works.
- **Local-first**: All processing happens on the user's machine. Zero cloud calls.
- **Plugin architecture**: Each defense layer is a standalone module. Easy to add/remove/customize.
- **Zero-config default**: Puffer auto-discovers agents and applies sensible defaults. Users CAN configure via YAML but don't have to.

---

## 3. Project Structure

```
puffer/
├── package.json
├── tsconfig.json
├── README.md
├── LICENSE                    # Apache 2.0
├── GUIDE.md                   # This file
├── puffer.config.yaml         # Default configuration (ships with package)
│
├── src/
│   ├── index.ts               # Main entry point — starts the daemon
│   ├── types.ts               # All TypeScript interfaces and types
│   │
│   ├── discovery/             # Auto-discovery engine
│   │   ├── index.ts           # Discovery orchestrator
│   │   ├── process-scanner.ts # Scans running processes for AI agents
│   │   ├── port-scanner.ts    # Probes known LLM ports
│   │   ├── network-scanner.ts # Detects outbound LLM API traffic
│   │   └── signatures.ts      # Known agent/model signatures database
│   │
│   ├── proxy/                 # LLM API Proxy
│   │   ├── index.ts           # Proxy server setup
│   │   ├── handler.ts         # Request/response interception logic
│   │   ├── providers.ts       # Provider-specific adapters (OpenAI, Anthropic, Ollama, etc.)
│   │   └── tls.ts             # TLS/certificate handling
│   │
│   ├── layers/                # 7 Defense Layers
│   │   ├── index.ts           # Pipeline orchestrator — runs all layers sequentially
│   │   ├── layer-1-pii.ts     # PII Scanner
│   │   ├── layer-2-injection.ts  # Prompt Injection Detector
│   │   ├── layer-3-commands.ts   # Command Analyzer
│   │   ├── layer-4-network.ts    # Network Egress Guard
│   │   ├── layer-5-filesystem.ts # Filesystem Sentinel
│   │   ├── layer-6-behavior.ts   # Behavior Analyzer
│   │   └── layer-7-mcp.ts       # MCP Poisoning Detector
│   │
│   ├── hooks/                 # Agent-specific hooks
│   │   ├── index.ts           # Hook manager
│   │   ├── claude-code.ts     # Claude Code hook integration
│   │   ├── openclaw.ts        # OpenClaw skill/middleware hook
│   │   └── generic.ts         # Generic hook for any agent
│   │
│   ├── engine/                # Decision engine
│   │   ├── decision.ts        # ALLOW/BLOCK/AUDIT/ESCALATE logic
│   │   └── policy.ts          # Policy loader and evaluator
│   │
│   ├── audit/                 # Audit logging
│   │   ├── logger.ts          # JSONL audit log writer
│   │   └── reporter.ts        # Summary report generator
│   │
│   ├── dashboard/             # Web dashboard
│   │   ├── server.ts          # Express server for dashboard
│   │   └── public/            # Static files (React SPA, built separately)
│   │       └── index.html
│   │
│   ├── cli/                   # CLI commands
│   │   ├── index.ts           # CLI entry point (commander.js)
│   │   ├── init.ts            # `puffer init` command
│   │   ├── scan.ts            # `puffer scan` command
│   │   ├── status.ts          # `puffer status` command
│   │   ├── logs.ts            # `puffer logs` command
│   │   └── config.ts          # `puffer config` command
│   │
│   └── utils/                 # Shared utilities
│       ├── config.ts          # Configuration loader (YAML)
│       ├── logger.ts          # Console logger with 🐡 branding
│       └── constants.ts       # Ports, paths, version, etc.
│
├── config/
│   └── default-policy.yaml    # Ships with Puffer — sensible defaults
│
├── tests/
│   ├── proxy.test.ts
│   ├── discovery.test.ts
│   ├── layers/
│   │   ├── pii.test.ts
│   │   ├── injection.test.ts
│   │   ├── commands.test.ts
│   │   ├── network.test.ts
│   │   ├── filesystem.test.ts
│   │   ├── behavior.test.ts
│   │   └── mcp.test.ts
│   └── integration/
│       ├── ollama-proxy.test.ts
│       └── openai-proxy.test.ts
│
├── dashboard/                 # Dashboard React app (separate build)
│   ├── package.json
│   ├── src/
│   │   ├── App.tsx
│   │   ├── components/
│   │   └── hooks/
│   └── vite.config.ts
│
└── .github/
    └── workflows/
        ├── test.yml
        └── release.yml
```

---
