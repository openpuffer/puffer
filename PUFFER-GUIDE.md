# PUFFER 🐡 — Complete Build Guide

> **Purpose of this document**: This is the master blueprint for building Puffer from scratch.
> It is written for an AI coding agent (Claude Code) that will execute the implementation.
> Every architectural decision, file, function, and behavior is specified here.
> Follow this document sequentially. Do not skip sections. Do not deviate from the spec.

---

## Table of Contents

1. [Project Identity](#1-project-identity)
2. [Architecture Overview](#2-architecture-overview)
3. [Project Structure](#3-project-structure)
4. [Phase 1: Core Proxy Engine (MVP)](#4-phase-1-core-proxy-engine-mvp)
5. [Phase 2: Auto-Discovery Engine](#5-phase-2-auto-discovery-engine)
6. [Phase 3: 7-Layer Defense Pipeline](#6-phase-3-7-layer-defense-pipeline)
7. [Phase 4: CLI](#7-phase-4-cli)
8. [Phase 5: Dashboard](#8-phase-5-dashboard)
9. [Phase 6: Agent Hooks](#9-phase-6-agent-hooks)
10. [Configuration System](#10-configuration-system)
11. [Audit Logging](#11-audit-logging)
12. [Testing Strategy](#12-testing-strategy)
13. [Packaging and Distribution](#13-packaging-and-distribution)
14. [README and Documentation](#14-readme-and-documentation)

---

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

## 4. Phase 1: Core Proxy Engine (MVP)

This is the FIRST thing to build. Everything else depends on it.

### 4.1 What the Proxy Does

The proxy is an HTTP server that sits between AI agents and LLM providers. It receives API calls intended for OpenAI/Anthropic/Ollama/etc., runs them through the defense layers, and forwards them (or blocks them).

### 4.2 `src/types.ts` — Core Type Definitions

```typescript
// === CORE EVENT TYPE ===
// Every intercepted action becomes a PufferEvent
export interface PufferEvent {
  id: string;                    // UUID v4
  timestamp: string;             // ISO 8601
  source: EventSource;           // Where did this event come from?
  action: EventAction;           // What is the agent trying to do?
  payload: any;                  // The actual data (request body, command string, etc.)
  metadata: EventMetadata;       // Additional context
  layers: LayerResult[];         // Results from each defense layer (populated during pipeline)
  decision: Decision | null;     // Final decision (populated after pipeline)
}

export interface EventSource {
  type: 'proxy' | 'hook' | 'manual';
  agent: string;                 // Detected agent name (e.g., "openclaw", "claude-code", "python-openai")
  pid?: number;                  // Process ID if known
  provider: string;              // LLM provider (e.g., "openai", "anthropic", "ollama")
  model?: string;                // Model name if known (e.g., "gpt-4o", "llama3")
}

export type EventAction = 
  | { type: 'llm_request'; method: string; endpoint: string; body: any }
  | { type: 'llm_response'; status: number; body: any }
  | { type: 'command_execute'; command: string; args: string[] }
  | { type: 'file_read'; path: string }
  | { type: 'file_write'; path: string; content?: string }
  | { type: 'network_request'; url: string; method: string; body?: any }
  | { type: 'mcp_tool_call'; server: string; tool: string; params: any }
  | { type: 'mcp_tool_result'; server: string; tool: string; result: any };

export interface EventMetadata {
  sessionId: string;             // Groups events from the same agent session
  sequenceNumber: number;        // Order within the session
  tokenEstimate?: number;        // Estimated tokens in this request
  costEstimate?: number;         // Estimated cost in USD
}

// === LAYER TYPES ===
export type Verdict = 'allow' | 'block' | 'audit' | 'escalate';

export interface LayerResult {
  layer: number;                 // 1-7
  name: string;                  // e.g., "pii_scanner"
  verdict: Verdict;
  confidence: number;            // 0.0 - 1.0
  details: string;               // Human-readable explanation
  findings: Finding[];           // Specific things detected
  durationMs: number;            // How long this layer took
}

export interface Finding {
  type: string;                  // e.g., "ssn_detected", "prompt_injection", "dangerous_command"
  severity: 'critical' | 'high' | 'medium' | 'low';
  location: string;              // Where in the payload
  value?: string;                // The detected value (redacted if PII)
  suggestion?: string;           // What to do about it
}

// === DECISION ===
export type Decision = 'ALLOW' | 'BLOCK' | 'AUDIT' | 'ESCALATE';

// === PROVIDER CONFIG ===
export interface ProviderConfig {
  name: string;                  // "openai", "anthropic", "ollama", "lm_studio", etc.
  targetUrl: string;             // Where to forward (e.g., "https://api.openai.com", "http://localhost:11434")
  proxyPort: number;             // Local port Puffer listens on for this provider
  apiFormat: 'openai' | 'anthropic' | 'ollama' | 'generic';  // API format
  isLocal: boolean;              // true for Ollama, LM Studio, etc.
  detected: boolean;             // Was this auto-discovered?
  status: 'active' | 'inactive' | 'error';
}

// === DISCOVERED AGENT ===
export interface DiscoveredAgent {
  name: string;                  // "openclaw", "claude-code", "python-langchain", etc.
  pid: number;
  command: string;               // Full command line
  detectedVia: 'process' | 'port' | 'network';
  provider?: string;             // Which LLM provider it's using
  port?: number;                 // If it's a server
  protectionStatus: 'protected' | 'unprotected' | 'partial';
}

// === CONFIGURATION ===
export interface PufferConfig {
  mode: 'monitor' | 'enforce' | 'paranoid' | 'interactive';
  providers: ProviderConfig[];
  autoDiscovery: {
    enabled: boolean;
    scanIntervalMs: number;      // Default: 30000 (30 seconds)
    processScanner: boolean;
    portScanner: boolean;
    networkScanner: boolean;
  };
  layers: {
    pii: PIIConfig;
    injection: InjectionConfig;
    commands: CommandsConfig;
    network: NetworkConfig;
    filesystem: FilesystemConfig;
    behavior: BehaviorConfig;
    mcp: MCPConfig;
  };
  dashboard: {
    enabled: boolean;
    port: number;                // Default: 8788
  };
  audit: {
    logPath: string;             // Default: ~/.puffer/audit.jsonl
    retentionDays: number;       // Default: 30
  };
  alerts: {
    webhook?: string;            // Optional webhook URL for alerts
    desktop: boolean;            // Desktop notifications
  };
}

// Layer-specific configs (defined in detail in each layer section below)
export interface PIIConfig {
  enabled: boolean;
  regions: string[];             // ["us", "eu", "mx"]
  actionBySeverity: Record<string, Verdict>;
  customPatterns: { name: string; pattern: string; severity: string }[];
  excludeContexts: string[];
}

export interface InjectionConfig {
  enabled: boolean;
  mode: 'heuristic' | 'model' | 'hybrid';  // 'heuristic' for MVP (no model download needed)
  thresholds: {
    directInput: { block: number; audit: number };
    externalContent: { block: number; audit: number };
  };
  heuristics: string[];          // Which heuristic checks to enable
}

export interface CommandsConfig {
  enabled: boolean;
  blockedPatterns: string[];
  requireApproval: string[];
  maxCommandsPerMinute: number;
  consecutiveBlockThreshold: number;
}

export interface NetworkConfig {
  enabled: boolean;
  mode: 'whitelist' | 'blacklist';
  allowedDomains: string[];
  blockedDomains: string[];
  blockPrivateIPs: boolean;
  maxPayloadSizeMb: number;
  scanPayloadForPII: boolean;
}

export interface FilesystemConfig {
  enabled: boolean;
  forbidden: string[];
  restricted: string[];
  workspace: string[];
  secretPatterns: string[];
}

export interface BehaviorConfig {
  enabled: boolean;
  maxCostPerSessionUsd: number;
  maxCostPerHourUsd: number;
  loopDetection: {
    windowSize: number;
    similarityThreshold: number;
    consecutiveMatches: number;
  };
  sensitivity: 'low' | 'medium' | 'high';
}

export interface MCPConfig {
  enabled: boolean;
  authorizedServers: { url: string; allowedTools: string[] }[];
  blockUnauthorized: boolean;
  scanToolResults: boolean;
}
```

### 4.3 `src/proxy/index.ts` — The Proxy Server

The proxy is a standard HTTP server using `http` and `http-proxy` (or `node-http-proxy`).

```
npm install http-proxy uuid yaml chalk commander express cors ws
npm install -D typescript @types/node @types/http-proxy @types/express vitest
```

**Behavior specification:**

1. Listen on a configurable port (default 8787)
2. Accept the header `x-puffer-target` to determine the destination provider
3. If no header, auto-detect based on the request path and body format
4. Parse the request body (JSON)
5. Create a `PufferEvent` with `action.type = 'llm_request'`
6. Run the event through the 7-Layer Defense Pipeline
7. If decision is `BLOCK`: return HTTP 403 with a JSON error body explaining why
8. If decision is `ALLOW` or `AUDIT`: forward the request to the target provider
9. When the response comes back, create another `PufferEvent` with `action.type = 'llm_response'`
10. Run the response through layers that inspect responses (L1 PII, L2 Injection on tool results)
11. Forward the response to the calling agent
12. Log both events to the audit trail

**Provider detection logic:**

```typescript
function detectProvider(req: IncomingMessage, body: any): string {
  // 1. Check explicit header
  const target = req.headers['x-puffer-target'] as string;
  if (target) return target;
  
  // 2. Check the URL path patterns
  const url = req.url || '';
  if (url.includes('/v1/chat/completions') || url.includes('/v1/embeddings')) {
    // Could be OpenAI or any OpenAI-compatible (Ollama, LM Studio, vLLM)
    // Check if original destination header exists
    const originalHost = req.headers['x-puffer-original-host'] as string;
    if (originalHost?.includes('anthropic')) return 'anthropic';
    if (originalHost?.includes('openai')) return 'openai';
    return 'openai-compatible';  // Default to OpenAI format
  }
  if (url.includes('/v1/messages')) return 'anthropic';
  if (url.includes('/api/generate') || url.includes('/api/chat')) return 'ollama';
  
  // 3. Default
  return 'unknown';
}
```

**Error response format when blocking:**

```json
{
  "error": {
    "type": "puffer_blocked",
    "message": "Request blocked by Puffer defense layer",
    "layer": "pii_scanner",
    "details": "SSN detected in request body. Sensitive data cannot be sent to external APIs.",
    "event_id": "uuid-here",
    "puffer_version": "0.1.0"
  }
}
```

### 4.4 `src/proxy/providers.ts` — Provider Adapters

Each LLM provider has slightly different API formats. Puffer needs to understand each one to properly inspect the content.

**Supported providers and their specifications:**

| Provider | API Base | Request Format | Chat Endpoint | Model Field |
|----------|----------|---------------|---------------|-------------|
| OpenAI | api.openai.com | `{ model, messages, tools }` | `/v1/chat/completions` | `model` |
| Anthropic | api.anthropic.com | `{ model, messages, system }` | `/v1/messages` | `model` |
| Ollama | localhost:11434 | `{ model, messages }` | `/api/chat` | `model` |
| LM Studio | localhost:1234 | OpenAI-compatible | `/v1/chat/completions` | `model` |
| LocalAI | localhost:8080 | OpenAI-compatible | `/v1/chat/completions` | `model` |
| vLLM | localhost:8000 | OpenAI-compatible | `/v1/chat/completions` | `model` |
| DeepSeek | api.deepseek.com | OpenAI-compatible | `/v1/chat/completions` | `model` |
| Google | generativelanguage.googleapis.com | `{ contents }` | `/v1/models/*/generateContent` | in URL |
| Together | api.together.xyz | OpenAI-compatible | `/v1/chat/completions` | `model` |
| Groq | api.groq.com | OpenAI-compatible | `/v1/chat/completions` | `model` |
| OpenRouter | openrouter.ai | OpenAI-compatible | `/api/v1/chat/completions` | `model` |

**For each provider, implement:**

```typescript
interface ProviderAdapter {
  name: string;
  extractMessages(body: any): Message[];      // Extract the message array
  extractModel(body: any, url: string): string; // Extract model name
  extractSystemPrompt(body: any): string | null;
  extractToolCalls(body: any): ToolCall[];     // Extract tool/function calls
  estimateTokens(body: any): number;           // Rough token estimate
  estimateCost(body: any): number;             // Estimated cost in USD
  formatBlockResponse(reason: string): any;    // Format a block response in provider's format
}
```

**Token estimation (rough, for cost tracking):**

```typescript
function estimateTokens(text: string): number {
  // Rough estimate: 1 token ≈ 4 characters for English
  // This is intentionally imprecise — we just need order of magnitude for cost alerts
  return Math.ceil(text.length / 4);
}
```

**Cost estimation table (USD per 1M tokens, input/output):**

```typescript
const COST_TABLE: Record<string, { input: number; output: number }> = {
  'gpt-4o': { input: 2.50, output: 10.00 },
  'gpt-4o-mini': { input: 0.15, output: 0.60 },
  'gpt-4-turbo': { input: 10.00, output: 30.00 },
  'claude-sonnet-4-20250514': { input: 3.00, output: 15.00 },
  'claude-haiku-4-5-20251001': { input: 0.80, output: 4.00 },
  'claude-opus-4-6': { input: 15.00, output: 75.00 },
  'deepseek-r1': { input: 0.55, output: 2.19 },
  'llama3': { input: 0, output: 0 },          // Local = free
  'deepseek-r1:local': { input: 0, output: 0 },
  'default_local': { input: 0, output: 0 },
  'default_cloud': { input: 1.00, output: 5.00 },
};
```

---

## 5. Phase 2: Auto-Discovery Engine

### 5.1 Overview

The auto-discovery engine runs continuously (every 30 seconds by default) and uses 3 scanning methods to find AI agents and LLM servers on the system.

### 5.2 `src/discovery/signatures.ts` — Known Signatures Database

```typescript
export const AGENT_SIGNATURES = [
  // Process name patterns
  { pattern: /openclaw|clawdbot|moltbot/i, name: 'openclaw', type: 'process' },
  { pattern: /claude[-_]?code/i, name: 'claude-code', type: 'process' },
  { pattern: /cursor[-_]?agent|cursor.*--type=agent/i, name: 'cursor', type: 'process' },
  { pattern: /aider/i, name: 'aider', type: 'process' },
  { pattern: /continue.*dev/i, name: 'continue-dev', type: 'process' },
  { pattern: /cline/i, name: 'cline', type: 'process' },
  { pattern: /copilot/i, name: 'github-copilot', type: 'process' },
  
  // Python patterns (check command line args and imported modules)
  { pattern: /python.*langchain/i, name: 'python-langchain', type: 'process' },
  { pattern: /python.*crewai/i, name: 'python-crewai', type: 'process' },
  { pattern: /python.*autogen/i, name: 'python-autogen', type: 'process' },
  { pattern: /python.*openai/i, name: 'python-openai', type: 'process' },
  { pattern: /python.*anthropic/i, name: 'python-anthropic', type: 'process' },
];

export const PORT_SIGNATURES = [
  { port: 11434, name: 'ollama', probe: '/api/tags', type: 'local-llm' },
  { port: 1234, name: 'lm-studio', probe: '/v1/models', type: 'local-llm' },
  { port: 8080, name: 'localai', probe: '/v1/models', type: 'local-llm' },
  { port: 8000, name: 'vllm', probe: '/v1/models', type: 'local-llm' },
  { port: 7860, name: 'text-generation-webui', probe: '/api/v1/model', type: 'local-llm' },
  { port: 5000, name: 'llama-cpp', probe: '/health', type: 'local-llm' },
  { port: 18789, name: 'openclaw-gateway', probe: '/health', type: 'agent' },
];

export const NETWORK_SIGNATURES = [
  { domain: 'api.openai.com', provider: 'openai' },
  { domain: 'api.anthropic.com', provider: 'anthropic' },
  { domain: 'generativelanguage.googleapis.com', provider: 'google' },
  { domain: 'api.deepseek.com', provider: 'deepseek' },
  { domain: 'api.together.xyz', provider: 'together' },
  { domain: 'api.groq.com', provider: 'groq' },
  { domain: 'openrouter.ai', provider: 'openrouter' },
  { domain: 'api.mistral.ai', provider: 'mistral' },
  { domain: 'api.cohere.ai', provider: 'cohere' },
];
```

### 5.3 `src/discovery/process-scanner.ts`

**How it works:**

1. Execute `ps aux` (Linux/Mac) or use `wmic process` (Windows)
2. Parse each line to extract: PID, command, arguments
3. Match against `AGENT_SIGNATURES`
4. For Python processes, also check `/proc/{pid}/maps` or `lsof -p {pid}` for loaded modules
5. Return a list of `DiscoveredAgent` objects

```typescript
import { execSync } from 'child_process';
import { AGENT_SIGNATURES } from './signatures';
import { DiscoveredAgent } from '../types';

export function scanProcesses(): DiscoveredAgent[] {
  const agents: DiscoveredAgent[] = [];
  
  try {
    // Get process list
    const platform = process.platform;
    let output: string;
    
    if (platform === 'win32') {
      output = execSync('wmic process get ProcessId,CommandLine /format:csv', { encoding: 'utf-8' });
    } else {
      output = execSync('ps aux', { encoding: 'utf-8' });
    }
    
    const lines = output.split('\n');
    
    for (const line of lines) {
      for (const sig of AGENT_SIGNATURES) {
        if (sig.pattern.test(line)) {
          // Extract PID
          const parts = line.trim().split(/\s+/);
          const pid = parseInt(platform === 'win32' ? parts[0] : parts[1]);
          
          if (!isNaN(pid) && !agents.some(a => a.pid === pid)) {
            agents.push({
              name: sig.name,
              pid,
              command: line.trim(),
              detectedVia: 'process',
              protectionStatus: 'unprotected',
            });
          }
        }
      }
    }
  } catch (err) {
    // Process scanning failed — log but don't crash
    console.error('[🐡 PUFFER] Process scan error:', (err as Error).message);
  }
  
  return agents;
}
```

### 5.4 `src/discovery/port-scanner.ts`

**How it works:**

1. For each known port in `PORT_SIGNATURES`, attempt an HTTP GET to the probe endpoint
2. If it responds with 200, the service is running
3. Parse the response to extract model names (e.g., Ollama returns list of loaded models)
4. Check binding address — if bound to 0.0.0.0, emit a SECURITY WARNING

```typescript
import http from 'http';
import { PORT_SIGNATURES } from './signatures';
import { DiscoveredAgent, ProviderConfig } from '../types';

interface PortScanResult {
  agent: DiscoveredAgent;
  provider: ProviderConfig;
  securityWarnings: string[];
}

export async function scanPorts(): Promise<PortScanResult[]> {
  const results: PortScanResult[] = [];
  
  for (const sig of PORT_SIGNATURES) {
    try {
      const response = await probePort(sig.port, sig.probe);
      if (response) {
        const warnings: string[] = [];
        
        // Check if bound to 0.0.0.0 (exposed to network)
        const bindCheck = await checkBinding(sig.port);
        if (bindCheck === '0.0.0.0') {
          warnings.push(
            `⚠️  ${sig.name} is bound to 0.0.0.0 on port ${sig.port} — ` +
            `EXPOSED TO YOUR ENTIRE NETWORK! Anyone on your network can access this LLM. ` +
            `Puffer will add authentication, but you should also bind to 127.0.0.1.`
          );
        }
        
        // Extract models if available
        let models: string[] = [];
        try {
          const data = JSON.parse(response);
          if (data.models) models = data.models.map((m: any) => m.name || m.id);
          if (data.data) models = data.data.map((m: any) => m.id);
        } catch {}
        
        results.push({
          agent: {
            name: sig.name,
            pid: 0, // Unknown from port scan
            command: `${sig.name} on port ${sig.port}`,
            detectedVia: 'port',
            provider: sig.name,
            port: sig.port,
            protectionStatus: 'unprotected',
          },
          provider: {
            name: sig.name,
            targetUrl: `http://localhost:${sig.port}`,
            proxyPort: 8787 + results.length, // Auto-assign proxy ports
            apiFormat: sig.name === 'ollama' ? 'ollama' : 'openai',
            isLocal: true,
            detected: true,
            status: 'active',
          },
          securityWarnings: warnings,
        });
      }
    } catch {
      // Port not responding — service not running, skip
    }
  }
  
  return results;
}

function probePort(port: number, path: string): Promise<string | null> {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}${path}`, { timeout: 2000 }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

async function checkBinding(port: number): Promise<string> {
  try {
    // Check if the port is bound to 0.0.0.0 or 127.0.0.1
    const output = execSync(
      process.platform === 'win32'
        ? `netstat -an | findstr :${port}`
        : `ss -tlnp | grep :${port} || netstat -tlnp 2>/dev/null | grep :${port}`,
      { encoding: 'utf-8' }
    );
    if (output.includes('0.0.0.0:') || output.includes(':::')) return '0.0.0.0';
    return '127.0.0.1';
  } catch {
    return 'unknown';
  }
}
```

### 5.5 `src/discovery/network-scanner.ts`

**How it works:**

1. Read active network connections: `ss -tnp` (Linux), `lsof -i -P` (Mac), `netstat -b` (Windows)
2. Match destination IPs/domains against `NETWORK_SIGNATURES`
3. Identify which process (PID) is making the connection
4. Cross-reference with the process scanner results

This is the most platform-dependent scanner. For the MVP, implement Linux and Mac. Windows can be added later.

```typescript
export async function scanNetworkConnections(): Promise<DiscoveredAgent[]> {
  // Implementation: parse `lsof -i -P -n` output or `ss -tnp` output
  // Match against NETWORK_SIGNATURES
  // Return list of agents making LLM API calls
}
```

### 5.6 `src/discovery/index.ts` — Discovery Orchestrator

```typescript
export class DiscoveryEngine {
  private interval: NodeJS.Timeout | null = null;
  private knownAgents: Map<string, DiscoveredAgent> = new Map();
  private knownProviders: Map<string, ProviderConfig> = new Map();
  
  async scan(): Promise<DiscoveryResult> {
    const processAgents = scanProcesses();
    const portResults = await scanPorts();
    const networkAgents = await scanNetworkConnections();
    
    // Merge and deduplicate
    // Update known agents map
    // Detect new agents since last scan
    // Detect removed agents since last scan
    // Emit events for new/removed agents
    
    return {
      agents: [...this.knownAgents.values()],
      providers: [...this.knownProviders.values()],
      securityWarnings: portResults.flatMap(r => r.securityWarnings),
      newSinceLastScan: [], // Agents detected for the first time
      removedSinceLastScan: [], // Agents no longer running
    };
  }
  
  start(intervalMs: number = 30000) {
    // Run initial scan
    this.scan();
    // Start periodic scanning
    this.interval = setInterval(() => this.scan(), intervalMs);
  }
  
  stop() {
    if (this.interval) clearInterval(this.interval);
  }
}
```

---

## 6. Phase 3: 7-Layer Defense Pipeline

### 6.1 Pipeline Orchestrator — `src/layers/index.ts`

```typescript
import { PufferEvent, LayerResult, Decision } from '../types';

// Each layer exports a function with this signature
export type LayerFunction = (event: PufferEvent, config: any) => Promise<LayerResult>;

export class DefensePipeline {
  private layers: { name: string; fn: LayerFunction; config: any }[] = [];
  
  registerLayer(name: string, fn: LayerFunction, config: any) {
    this.layers.push({ name, fn, config });
  }
  
  async evaluate(event: PufferEvent): Promise<PufferEvent> {
    for (const layer of this.layers) {
      if (!layer.config.enabled) continue;
      
      const start = Date.now();
      const result = await layer.fn(event, layer.config);
      result.durationMs = Date.now() - start;
      
      event.layers.push(result);
      
      // SHORT CIRCUIT: If any layer says BLOCK, stop immediately
      if (result.verdict === 'block') {
        event.decision = 'BLOCK';
        return event;
      }
    }
    
    // If no layer blocked, check for escalations or audits
    const hasEscalate = event.layers.some(l => l.verdict === 'escalate');
    const hasAudit = event.layers.some(l => l.verdict === 'audit');
    
    if (hasEscalate) event.decision = 'ESCALATE';
    else if (hasAudit) event.decision = 'AUDIT';
    else event.decision = 'ALLOW';
    
    return event;
  }
}
```

### 6.2 Layer 1: PII Scanner — `src/layers/layer-1-pii.ts`

**Implementation approach**: Pure regex-based pattern matching for the MVP. No ML models needed. Fast and reliable.

**Patterns to implement:**

```typescript
export const PII_PATTERNS: PIIPattern[] = [
  // US Social Security Number
  {
    name: 'ssn_us',
    pattern: /\b(?!000|666|9\d{2})\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/g,
    severity: 'critical',
    region: 'us',
    validate: (match: string) => {
      // Luhn-like validation: check range validity
      const parts = match.split('-').map(Number);
      return parts[0] >= 1 && parts[0] <= 899 && parts[0] !== 666;
    }
  },
  
  // Credit Card Numbers (Visa, MC, Amex, Discover)
  {
    name: 'credit_card',
    pattern: /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|6(?:011|5[0-9]{2})[0-9]{12})\b/g,
    severity: 'critical',
    region: 'global',
    validate: (match: string) => luhnCheck(match),
  },
  
  // Email addresses
  {
    name: 'email',
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
    severity: 'medium',
    region: 'global',
  },
  
  // Phone numbers (US)
  {
    name: 'phone_us',
    pattern: /\b(?:\+?1[-.\s]?)?\(?[2-9]\d{2}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
    severity: 'medium',
    region: 'us',
  },
  
  // AWS Access Keys
  {
    name: 'aws_access_key',
    pattern: /\bAKIA[A-Z0-9]{16}\b/g,
    severity: 'critical',
    region: 'global',
  },
  
  // OpenAI API Keys
  {
    name: 'openai_api_key',
    pattern: /\bsk-[a-zA-Z0-9]{20,}\b/g,
    severity: 'critical',
    region: 'global',
  },
  
  // GitHub Personal Access Tokens
  {
    name: 'github_pat',
    pattern: /\bghp_[a-zA-Z0-9]{36}\b/g,
    severity: 'critical',
    region: 'global',
  },
  
  // Anthropic API Keys
  {
    name: 'anthropic_api_key',
    pattern: /\bsk-ant-[a-zA-Z0-9-]{20,}\b/g,
    severity: 'critical',
    region: 'global',
  },
  
  // Private keys (PEM format)
  {
    name: 'private_key',
    pattern: /-----BEGIN\s+(RSA|EC|DSA|OPENSSH)?\s*PRIVATE KEY-----/g,
    severity: 'critical',
    region: 'global',
  },
  
  // JWT tokens
  {
    name: 'jwt_token',
    pattern: /\beyJ[A-Za-z0-9-_]+\.eyJ[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\b/g,
    severity: 'high',
    region: 'global',
  },
  
  // IP Addresses (private ranges — flag when being sent externally)
  {
    name: 'private_ip',
    pattern: /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})\b/g,
    severity: 'low',
    region: 'global',
  },
  
  // Mexican CURP
  {
    name: 'curp_mx',
    pattern: /\b[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z0-9]\d\b/g,
    severity: 'high',
    region: 'mx',
  },
  
  // Mexican RFC
  {
    name: 'rfc_mx',
    pattern: /\b[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}\b/g,
    severity: 'high',
    region: 'mx',
  },
  
  // IBAN
  {
    name: 'iban',
    pattern: /\b[A-Z]{2}\d{2}[A-Z0-9]{4,30}\b/g,
    severity: 'high',
    region: 'eu',
    validate: (match: string) => validateIBAN(match),
  },
  
  // Passwords in common formats
  {
    name: 'password_field',
    pattern: /(?:password|passwd|pwd|secret|token)[\s]*[=:]\s*['"]?[^\s'"]{8,}/gi,
    severity: 'critical',
    region: 'global',
  },
];
```

**The layer function:**

```typescript
export async function piiScanner(event: PufferEvent, config: PIIConfig): Promise<LayerResult> {
  const findings: Finding[] = [];
  
  // Extract all text content from the event
  const textContent = extractTextFromEvent(event);
  
  // Run each pattern
  for (const piiPattern of PII_PATTERNS) {
    // Skip if region not enabled
    if (piiPattern.region !== 'global' && !config.regions.includes(piiPattern.region)) continue;
    
    const matches = textContent.matchAll(piiPattern.pattern);
    for (const match of matches) {
      // Run validation if available
      if (piiPattern.validate && !piiPattern.validate(match[0])) continue;
      
      findings.push({
        type: piiPattern.name,
        severity: piiPattern.severity as any,
        location: `offset:${match.index}`,
        value: redactValue(match[0]),  // Never log the actual PII
        suggestion: `Detected ${piiPattern.name}. Consider redacting before sending to LLM.`,
      });
    }
  }
  
  // Also run custom patterns from config
  for (const custom of config.customPatterns) {
    const regex = new RegExp(custom.pattern, 'g');
    const matches = textContent.matchAll(regex);
    for (const match of matches) {
      findings.push({
        type: custom.name,
        severity: custom.severity as any,
        location: `offset:${match.index}`,
        value: redactValue(match[0]),
      });
    }
  }
  
  // Determine verdict based on highest severity finding
  const maxSeverity = getMaxSeverity(findings);
  const verdict = maxSeverity ? (config.actionBySeverity[maxSeverity] || 'audit') : 'allow';
  
  return {
    layer: 1,
    name: 'pii_scanner',
    verdict,
    confidence: findings.length > 0 ? 0.95 : 1.0,
    details: findings.length > 0
      ? `Found ${findings.length} PII items (highest severity: ${maxSeverity})`
      : 'No PII detected',
    findings,
    durationMs: 0,
  };
}

function redactValue(value: string): string {
  if (value.length <= 4) return '****';
  return value.substring(0, 2) + '*'.repeat(value.length - 4) + value.substring(value.length - 2);
}
```

### 6.3 Layer 2: Prompt Injection Detector — `src/layers/layer-2-injection.ts`

**MVP Implementation**: Heuristic-only (no ML model). This is fast, zero-dependency, and catches the majority of real attacks.

```typescript
// Heuristic features for prompt injection detection
const INJECTION_HEURISTICS = [
  {
    name: 'role_switching',
    pattern: /(?:you are now|act as|pretend to be|forget (?:your|all|previous)|ignore (?:previous|above|all)|disregard (?:your|all|previous)|override (?:your|all)|new instructions?:)/gi,
    weight: 0.8,
    severity: 'high',
  },
  {
    name: 'system_delimiters',
    pattern: /(?:\[INST\]|\[\/INST\]|<\|system\|>|<\|user\|>|<\|assistant\|>|###\s*(?:system|instruction|human|assistant)|<\/?(?:system|instruction)>)/gi,
    weight: 0.9,
    severity: 'high',
  },
  {
    name: 'imperative_override',
    pattern: /(?:instead,?\s+(?:do|say|output|print|write|execute|run)|do not (?:follow|obey|listen)|stop (?:following|obeying)|(?:always|never) (?:respond|answer|say|output) with)/gi,
    weight: 0.7,
    severity: 'high',
  },
  {
    name: 'data_exfil_instruction',
    pattern: /(?:send (?:all|this|the) (?:data|info|content|text|conversation|history) to|forward (?:everything|all|this) to|(?:curl|wget|fetch|post)\s+https?:\/\/)/gi,
    weight: 0.95,
    severity: 'critical',
  },
  {
    name: 'encoding_detection',
    // Detect base64-encoded content that might hide instructions
    pattern: /(?:base64|atob|btoa|decode|eval)\s*\(|data:text\/[^;]+;base64,/gi,
    weight: 0.6,
    severity: 'medium',
  },
  {
    name: 'hidden_text',
    // HTML comments, zero-width characters, invisible Unicode
    pattern: /(?:<!--[\s\S]*?-->|[\u200B\u200C\u200D\uFEFF\u2060]|\\u200[bcd])/gi,
    weight: 0.85,
    severity: 'high',
  },
  {
    name: 'prompt_leaking',
    pattern: /(?:(?:show|reveal|print|output|display|repeat|echo)\s+(?:your|the|system)\s+(?:prompt|instructions?|rules?|guidelines?|system\s*message))/gi,
    weight: 0.5,
    severity: 'medium',
  },
  {
    name: 'tool_abuse',
    pattern: /(?:(?:call|invoke|use|execute|run)\s+(?:the\s+)?(?:tool|function|bash|shell|terminal|command)|execute\s+(?:system|shell)\s+command)/gi,
    weight: 0.7,
    severity: 'high',
  },
];

export async function injectionDetector(event: PufferEvent, config: InjectionConfig): Promise<LayerResult> {
  const findings: Finding[] = [];
  const textContent = extractTextFromEvent(event);
  
  let totalScore = 0;
  let maxWeight = 0;
  
  for (const heuristic of INJECTION_HEURISTICS) {
    const matches = textContent.match(heuristic.pattern);
    if (matches && matches.length > 0) {
      totalScore += heuristic.weight * matches.length;
      maxWeight = Math.max(maxWeight, heuristic.weight);
      
      findings.push({
        type: `injection_${heuristic.name}`,
        severity: heuristic.severity as any,
        location: 'request_body',
        value: matches[0].substring(0, 50),
        suggestion: `Possible prompt injection detected: ${heuristic.name}`,
      });
    }
  }
  
  // Entropy check — high entropy in short strings suggests obfuscation
  const entropy = calculateEntropy(textContent);
  if (entropy > 5.5 && textContent.length < 500) {
    totalScore += 0.4;
    findings.push({
      type: 'injection_high_entropy',
      severity: 'medium',
      location: 'request_body',
      suggestion: 'Unusually high entropy — possible obfuscated injection',
    });
  }
  
  // Normalize score to 0-1 range
  const normalizedScore = Math.min(totalScore / 3.0, 1.0);
  
  // Determine thresholds based on whether this is direct input or external content
  const isExternal = event.action.type === 'mcp_tool_result' || 
                     event.action.type === 'llm_response';
  const thresholds = isExternal 
    ? config.thresholds.externalContent 
    : config.thresholds.directInput;
  
  let verdict: Verdict = 'allow';
  if (normalizedScore >= thresholds.block) verdict = 'block';
  else if (normalizedScore >= thresholds.audit) verdict = 'audit';
  
  return {
    layer: 2,
    name: 'injection_detector',
    verdict,
    confidence: normalizedScore,
    details: findings.length > 0
      ? `Injection score: ${(normalizedScore * 100).toFixed(1)}% (threshold: ${thresholds.block * 100}% for block)`
      : 'No injection patterns detected',
    findings,
    durationMs: 0,
  };
}

function calculateEntropy(text: string): number {
  const freq: Record<string, number> = {};
  for (const char of text) freq[char] = (freq[char] || 0) + 1;
  const len = text.length;
  return -Object.values(freq).reduce((sum, count) => {
    const p = count / len;
    return sum + p * Math.log2(p);
  }, 0);
}
```

### 6.4 Layer 3: Command Analyzer — `src/layers/layer-3-commands.ts`

**MVP Implementation**: Pattern-based command analysis. Parse the command string, classify the binary, analyze arguments.

```typescript
const BINARY_CLASSIFICATIONS = {
  safe: ['ls', 'cat', 'echo', 'pwd', 'whoami', 'date', 'head', 'tail', 'wc', 'grep', 'find', 'which', 'env', 'printenv', 'uname', 'hostname', 'id', 'df', 'du', 'free', 'uptime', 'ps', 'top'],
  caution: ['git', 'npm', 'npx', 'yarn', 'pnpm', 'pip', 'pip3', 'python', 'python3', 'node', 'docker', 'docker-compose', 'make', 'cargo', 'go', 'rustc', 'gcc', 'cc', 'sed', 'awk', 'sort', 'uniq', 'cut', 'tr', 'tee', 'xargs', 'mkdir', 'cp', 'mv', 'touch'],
  dangerous: ['rm', 'chmod', 'chown', 'chgrp', 'kill', 'killall', 'pkill', 'shutdown', 'reboot', 'mkfs', 'dd', 'mount', 'umount', 'fdisk', 'format', 'systemctl', 'service', 'iptables', 'ufw'],
  critical: ['sudo', 'su', 'eval', 'exec', 'nc', 'netcat', 'ncat', 'socat', 'ssh', 'scp', 'sftp', 'rsync', 'curl', 'wget', 'aria2c'],
};

const DANGEROUS_PATTERNS = [
  { pattern: /rm\s+(-[a-zA-Z]*r[a-zA-Z]*f|--recursive\s+--force|-[a-zA-Z]*f[a-zA-Z]*r)\s+[\/~]/, reason: 'Recursive force delete of root or home', severity: 'critical' },
  { pattern: /curl\s+.*\|\s*(ba)?sh/, reason: 'Download and execute pattern', severity: 'critical' },
  { pattern: /wget\s+.*\|\s*(ba)?sh/, reason: 'Download and execute pattern', severity: 'critical' },
  { pattern: /chmod\s+777/, reason: 'World-writable permissions', severity: 'high' },
  { pattern: /chmod\s+\+s/, reason: 'SUID bit set', severity: 'critical' },
  { pattern: />\s*\/dev\/sd/, reason: 'Direct write to block device', severity: 'critical' },
  { pattern: />\s*\/etc\//, reason: 'Write to system config', severity: 'high' },
  { pattern: /mkfs/, reason: 'Format filesystem', severity: 'critical' },
  { pattern: /dd\s+.*of=\/dev\//, reason: 'Direct disk write', severity: 'critical' },
  { pattern: /:(){ :\|:& };:/, reason: 'Fork bomb', severity: 'critical' },
  { pattern: /npm\s+publish/, reason: 'Publish package — requires approval', severity: 'high' },
  { pattern: /git\s+push\s+.*(?:main|master|prod)/, reason: 'Push to protected branch', severity: 'medium' },
  { pattern: /pip\s+install\s+--break-system-packages/, reason: 'System-level pip install', severity: 'medium' },
  { pattern: /docker\s+run\s+.*--privileged/, reason: 'Privileged Docker container', severity: 'high' },
  { pattern: /\.\.\/\.\.\/(\.\.\/)*etc\/passwd/, reason: 'Path traversal to sensitive file', severity: 'critical' },
];

const SENSITIVE_PATHS = [
  /~\/\.ssh\//,
  /~\/\.aws\//,
  /~\/\.env/,
  /~\/\.gnupg\//,
  /~\/\.config\/gcloud\//,
  /~\/\.kube\/config/,
  /~\/\.docker\/config\.json/,
  /\/etc\/shadow/,
  /\/etc\/passwd/,
  /~\/\.npmrc/,
  /~\/\.pypirc/,
  /~\/\.netrc/,
];

export async function commandAnalyzer(event: PufferEvent, config: CommandsConfig): Promise<LayerResult> {
  if (event.action.type !== 'command_execute') {
    return { layer: 3, name: 'command_analyzer', verdict: 'allow', confidence: 1.0, details: 'Not a command event', findings: [], durationMs: 0 };
  }
  
  const command = event.action.command;
  const fullCommand = `${command} ${(event.action.args || []).join(' ')}`;
  const findings: Finding[] = [];
  
  // 1. Check against explicit blocklist from config
  for (const blocked of config.blockedPatterns) {
    const blockRegex = new RegExp(blocked.replace(/\*/g, '.*'), 'i');
    if (blockRegex.test(fullCommand)) {
      findings.push({
        type: 'blocked_pattern',
        severity: 'critical',
        location: 'command',
        value: fullCommand.substring(0, 100),
        suggestion: `Command matches blocklist pattern: ${blocked}`,
      });
      return {
        layer: 3, name: 'command_analyzer', verdict: 'block', confidence: 1.0,
        details: `Command blocked: matches pattern "${blocked}"`, findings, durationMs: 0,
      };
    }
  }
  
  // 2. Check dangerous patterns
  for (const dp of DANGEROUS_PATTERNS) {
    if (dp.pattern.test(fullCommand)) {
      findings.push({
        type: 'dangerous_pattern',
        severity: dp.severity as any,
        location: 'command',
        value: fullCommand.substring(0, 100),
        suggestion: dp.reason,
      });
    }
  }
  
  // 3. Check sensitive paths
  for (const sp of SENSITIVE_PATHS) {
    if (sp.test(fullCommand)) {
      findings.push({
        type: 'sensitive_path_access',
        severity: 'critical',
        location: 'command',
        value: fullCommand.substring(0, 100),
        suggestion: 'Command accesses a sensitive path (credentials, keys)',
      });
    }
  }
  
  // 4. Classify the binary
  const binary = command.split('/').pop()?.split(' ')[0] || '';
  let binaryClass = 'unknown';
  for (const [cls, bins] of Object.entries(BINARY_CLASSIFICATIONS)) {
    if (bins.includes(binary)) { binaryClass = cls; break; }
  }
  
  // 5. Check require_approval list
  for (const approvalPattern of config.requireApproval) {
    const regex = new RegExp(approvalPattern.replace(/\*/g, '.*'), 'i');
    if (regex.test(fullCommand)) {
      return {
        layer: 3, name: 'command_analyzer', verdict: 'escalate', confidence: 0.9,
        details: `Command requires approval: ${approvalPattern}`, findings, durationMs: 0,
      };
    }
  }
  
  // 6. Determine verdict
  const hasCritical = findings.some(f => f.severity === 'critical');
  const hasHigh = findings.some(f => f.severity === 'high');
  
  let verdict: Verdict = 'allow';
  if (hasCritical || binaryClass === 'critical') verdict = 'block';
  else if (hasHigh || binaryClass === 'dangerous') verdict = 'block';
  else if (binaryClass === 'caution') verdict = 'audit';
  
  return {
    layer: 3, name: 'command_analyzer', verdict,
    confidence: hasCritical ? 1.0 : hasHigh ? 0.9 : 0.7,
    details: findings.length > 0
      ? `Command analysis: binary="${binary}" class="${binaryClass}", ${findings.length} issues found`
      : `Command analysis: binary="${binary}" class="${binaryClass}", clean`,
    findings, durationMs: 0,
  };
}
```

### 6.5 Layer 4: Network Egress Guard — `src/layers/layer-4-network.ts`

```typescript
import { URL } from 'url';
import net from 'net';

const PRIVATE_IP_RANGES = [
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^127\./,
  /^169\.254\./,
  /^0\./,
  /^fc00:/i,
  /^fe80:/i,
  /^::1$/,
];

export async function networkEgressGuard(event: PufferEvent, config: NetworkConfig): Promise<LayerResult> {
  // Only applies to network requests and LLM requests going to external endpoints
  if (event.action.type !== 'network_request' && event.action.type !== 'llm_request') {
    return allowResult(4, 'network_egress');
  }
  
  const findings: Finding[] = [];
  let targetUrl: string;
  
  if (event.action.type === 'network_request') {
    targetUrl = event.action.url;
  } else {
    targetUrl = event.action.endpoint;
  }
  
  try {
    const parsed = new URL(targetUrl);
    const hostname = parsed.hostname;
    
    // 1. Block private IPs (anti-SSRF)
    if (config.blockPrivateIPs) {
      const isPrivate = PRIVATE_IP_RANGES.some(r => r.test(hostname));
      if (isPrivate && !event.source.provider.includes('local')) {
        findings.push({
          type: 'ssrf_attempt',
          severity: 'critical',
          location: 'url',
          value: hostname,
          suggestion: 'Request to private IP blocked (anti-SSRF)',
        });
        return blockResult(4, 'network_egress', 'SSRF attempt: request to private IP', findings);
      }
    }
    
    // 2. Whitelist/blacklist check
    if (config.mode === 'whitelist') {
      const allowed = config.allowedDomains.some(d => {
        if (d.startsWith('*.')) return hostname.endsWith(d.substring(1));
        return hostname === d;
      });
      if (!allowed) {
        findings.push({
          type: 'domain_not_whitelisted',
          severity: 'high',
          location: 'url',
          value: hostname,
          suggestion: `Domain not in whitelist. Add "${hostname}" to allowedDomains if trusted.`,
        });
        return blockResult(4, 'network_egress', `Domain not whitelisted: ${hostname}`, findings);
      }
    } else { // blacklist mode
      const blocked = config.blockedDomains.some(d => {
        if (d.startsWith('*.')) return hostname.endsWith(d.substring(1));
        return hostname === d;
      });
      if (blocked) {
        findings.push({
          type: 'domain_blacklisted',
          severity: 'critical',
          location: 'url',
          value: hostname,
        });
        return blockResult(4, 'network_egress', `Blocked domain: ${hostname}`, findings);
      }
    }
    
    // 3. DGA detection (Domain Generation Algorithm — random-looking domains)
    if (isDGADomain(hostname)) {
      findings.push({
        type: 'dga_suspected',
        severity: 'high',
        location: 'url',
        value: hostname,
        suggestion: 'Domain appears algorithmically generated — possible C2 server',
      });
    }
    
    // 4. Payload size check
    if (event.action.type === 'network_request' && event.action.body) {
      const payloadSize = JSON.stringify(event.action.body).length;
      const maxBytes = config.maxPayloadSizeMb * 1024 * 1024;
      if (payloadSize > maxBytes) {
        findings.push({
          type: 'payload_too_large',
          severity: 'medium',
          location: 'body',
          value: `${(payloadSize / 1024 / 1024).toFixed(2)} MB`,
          suggestion: `Payload exceeds max size of ${config.maxPayloadSizeMb} MB`,
        });
      }
    }
    
  } catch (err) {
    findings.push({
      type: 'invalid_url',
      severity: 'medium',
      location: 'url',
      value: targetUrl.substring(0, 100),
    });
  }
  
  const hasCritical = findings.some(f => f.severity === 'critical');
  const hasHigh = findings.some(f => f.severity === 'high');
  
  return {
    layer: 4, name: 'network_egress', 
    verdict: hasCritical ? 'block' : hasHigh ? 'audit' : 'allow',
    confidence: 0.9,
    details: findings.length > 0 ? `${findings.length} network concerns` : 'Network request OK',
    findings, durationMs: 0,
  };
}

function isDGADomain(hostname: string): boolean {
  // Simple DGA heuristic: high entropy + short TLD + no common words
  const parts = hostname.split('.');
  const domain = parts[0];
  if (domain.length < 8) return false;
  
  const entropy = calculateEntropy(domain);
  const hasNumbers = /\d/.test(domain);
  const consonantRatio = (domain.match(/[bcdfghjklmnpqrstvwxyz]/gi)?.length || 0) / domain.length;
  
  return entropy > 3.5 && hasNumbers && consonantRatio > 0.65;
}
```

### 6.6 Layer 5: Filesystem Sentinel — `src/layers/layer-5-filesystem.ts`

```typescript
import path from 'path';
import os from 'os';

const HOME = os.homedir();

function expandPath(p: string): string {
  return p.replace(/^~/, HOME);
}

export async function filesystemSentinel(event: PufferEvent, config: FilesystemConfig): Promise<LayerResult> {
  if (event.action.type !== 'file_read' && event.action.type !== 'file_write') {
    return allowResult(5, 'filesystem_sentinel');
  }
  
  const filePath = path.resolve(expandPath(event.action.path));
  const isWrite = event.action.type === 'file_write';
  const findings: Finding[] = [];
  
  // 1. Check forbidden paths
  for (const forbidden of config.forbidden) {
    const expandedForbidden = expandPath(forbidden);
    if (filePath.startsWith(expandedForbidden) || minimatch(filePath, expandedForbidden)) {
      findings.push({
        type: 'forbidden_path',
        severity: 'critical',
        location: 'path',
        value: filePath,
        suggestion: `Access to ${forbidden} is forbidden`,
      });
      return blockResult(5, 'filesystem_sentinel', `Forbidden path: ${forbidden}`, findings);
    }
  }
  
  // 2. Check restricted paths (read OK, write needs escalation)
  for (const restricted of config.restricted) {
    const expandedRestricted = expandPath(restricted);
    if (filePath.startsWith(expandedRestricted) || minimatch(filePath, expandedRestricted)) {
      if (isWrite) {
        findings.push({
          type: 'restricted_write',
          severity: 'high',
          location: 'path',
          value: filePath,
          suggestion: `Writing to restricted path requires approval`,
        });
        return {
          layer: 5, name: 'filesystem_sentinel', verdict: 'escalate',
          confidence: 1.0, details: `Write to restricted path: ${restricted}`, findings, durationMs: 0,
        };
      }
    }
  }
  
  // 3. Check for path traversal
  if (event.action.path.includes('..')) {
    const resolved = path.resolve(event.action.path);
    findings.push({
      type: 'path_traversal',
      severity: 'high',
      location: 'path',
      value: event.action.path,
      suggestion: `Path contains ".." — resolved to ${resolved}`,
    });
  }
  
  // 4. Scan file content for secrets (on write operations, check what's being written)
  if (isWrite && event.action.content) {
    for (const secretPattern of config.secretPatterns) {
      const regex = new RegExp(secretPattern, 'g');
      if (regex.test(event.action.content)) {
        findings.push({
          type: 'secret_in_content',
          severity: 'high',
          location: 'content',
          suggestion: `File content matches secret pattern: ${secretPattern}`,
        });
      }
    }
  }
  
  const hasCritical = findings.some(f => f.severity === 'critical');
  const hasHigh = findings.some(f => f.severity === 'high');
  
  return {
    layer: 5, name: 'filesystem_sentinel',
    verdict: hasCritical ? 'block' : hasHigh ? 'audit' : 'allow',
    confidence: 0.95,
    details: findings.length > 0 ? `${findings.length} filesystem concerns` : 'Filesystem access OK',
    findings, durationMs: 0,
  };
}
```

### 6.7 Layer 6: Behavior Analyzer — `src/layers/layer-6-behavior.ts`

```typescript
// Session state — maintained across events in the same session
interface SessionState {
  sessionId: string;
  startTime: number;
  eventCount: number;
  totalTokens: number;
  totalCost: number;
  recentActions: string[];       // Sliding window for loop detection
  commandHistory: string[];      // For privilege escalation detection
  blockedCount: number;
}

const sessions = new Map<string, SessionState>();

export async function behaviorAnalyzer(event: PufferEvent, config: BehaviorConfig): Promise<LayerResult> {
  const sessionId = event.metadata.sessionId;
  const findings: Finding[] = [];
  
  // Get or create session state
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, {
      sessionId,
      startTime: Date.now(),
      eventCount: 0,
      totalTokens: 0,
      totalCost: 0,
      recentActions: [],
      commandHistory: [],
      blockedCount: 0,
    });
  }
  const session = sessions.get(sessionId)!;
  session.eventCount++;
  
  // 1. Cost tracking
  if (event.metadata.costEstimate) {
    session.totalCost += event.metadata.costEstimate;
    
    if (session.totalCost > config.maxCostPerSessionUsd) {
      findings.push({
        type: 'cost_exceeded',
        severity: 'high',
        location: 'session',
        value: `$${session.totalCost.toFixed(2)}`,
        suggestion: `Session cost $${session.totalCost.toFixed(2)} exceeds limit of $${config.maxCostPerSessionUsd}`,
      });
      return blockResult(6, 'behavior_analyzer', 'Cost limit exceeded', findings);
    }
    
    // Hourly rate check
    const hoursSinceStart = (Date.now() - session.startTime) / 3600000;
    if (hoursSinceStart > 0) {
      const costPerHour = session.totalCost / hoursSinceStart;
      if (costPerHour > config.maxCostPerHourUsd) {
        findings.push({
          type: 'cost_rate_high',
          severity: 'medium',
          location: 'session',
          value: `$${costPerHour.toFixed(2)}/hr`,
          suggestion: `Cost rate $${costPerHour.toFixed(2)}/hr exceeds hourly limit`,
        });
      }
    }
  }
  
  // 2. Loop detection
  const actionString = JSON.stringify(event.action).substring(0, 200);
  session.recentActions.push(actionString);
  if (session.recentActions.length > config.loopDetection.windowSize) {
    session.recentActions.shift();
  }
  
  // Check for repeated similar actions
  const recent = session.recentActions.slice(-config.loopDetection.consecutiveMatches);
  if (recent.length >= config.loopDetection.consecutiveMatches) {
    const allSimilar = recent.every(a => stringSimilarity(a, recent[0]) > config.loopDetection.similarityThreshold);
    if (allSimilar) {
      findings.push({
        type: 'loop_detected',
        severity: 'high',
        location: 'session',
        value: `${config.loopDetection.consecutiveMatches} similar actions`,
        suggestion: 'Agent appears to be in a loop',
      });
      return blockResult(6, 'behavior_analyzer', 'Loop detected', findings);
    }
  }
  
  // 3. Consecutive block detection (agent trying to bypass restrictions)
  if (event.layers.some(l => l.verdict === 'block')) {
    session.blockedCount++;
    if (session.blockedCount >= 3) {
      findings.push({
        type: 'repeated_blocks',
        severity: 'high',
        location: 'session',
        value: `${session.blockedCount} blocks in session`,
        suggestion: 'Agent has been blocked multiple times — possible attack attempt',
      });
    }
  } else {
    session.blockedCount = 0; // Reset on successful action
  }
  
  const hasHigh = findings.some(f => f.severity === 'high');
  return {
    layer: 6, name: 'behavior_analyzer',
    verdict: hasHigh ? 'block' : findings.length > 0 ? 'audit' : 'allow',
    confidence: 0.8,
    details: findings.length > 0 ? `${findings.length} behavioral concerns` : 'Behavior normal',
    findings, durationMs: 0,
  };
}

function stringSimilarity(a: string, b: string): number {
  if (a === b) return 1.0;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1.0;
  let matches = 0;
  const minLen = Math.min(a.length, b.length);
  for (let i = 0; i < minLen; i++) {
    if (a[i] === b[i]) matches++;
  }
  return matches / maxLen;
}
```

### 6.8 Layer 7: MCP Poisoning Detector — `src/layers/layer-7-mcp.ts`

```typescript
export async function mcpPoisoningDetector(event: PufferEvent, config: MCPConfig): Promise<LayerResult> {
  if (event.action.type !== 'mcp_tool_call' && event.action.type !== 'mcp_tool_result') {
    return allowResult(7, 'mcp_detector');
  }
  
  const findings: Finding[] = [];
  
  if (event.action.type === 'mcp_tool_call') {
    // Check if server is authorized
    const server = event.action.server;
    const tool = event.action.tool;
    
    if (config.blockUnauthorized) {
      const authorized = config.authorizedServers.find(s => s.url === server);
      if (!authorized) {
        findings.push({
          type: 'unauthorized_mcp_server',
          severity: 'critical',
          location: 'mcp_server',
          value: server,
          suggestion: `MCP server not in authorized list`,
        });
        return blockResult(7, 'mcp_detector', `Unauthorized MCP server: ${server}`, findings);
      }
      
      // Check if tool is allowed for this server
      if (authorized.allowedTools.length > 0 && !authorized.allowedTools.includes(tool)) {
        findings.push({
          type: 'unauthorized_mcp_tool',
          severity: 'high',
          location: 'mcp_tool',
          value: `${server}/${tool}`,
          suggestion: `Tool "${tool}" not in allowed list for server`,
        });
        return blockResult(7, 'mcp_detector', `Unauthorized tool: ${tool}`, findings);
      }
    }
  }
  
  if (event.action.type === 'mcp_tool_result') {
    // Scan tool results for prompt injection
    const resultText = JSON.stringify(event.action.result);
    
    if (config.scanToolResults) {
      // Reuse injection detector on tool results
      // (The pipeline already does this if injection detector is enabled,
      //  but we do an extra check with lower thresholds here)
      const injectionResult = await injectionDetector(
        { ...event, action: { type: 'llm_request', method: '', endpoint: '', body: { content: resultText } } } as any,
        { ...defaultInjectionConfig, thresholds: { directInput: { block: 0.5, audit: 0.3 }, externalContent: { block: 0.4, audit: 0.2 } } }
      );
      
      if (injectionResult.findings.length > 0) {
        findings.push({
          type: 'mcp_result_injection',
          severity: 'critical',
          location: 'mcp_result',
          value: resultText.substring(0, 200),
          suggestion: 'MCP tool result contains possible prompt injection',
        });
      }
    }
  }
  
  const hasCritical = findings.some(f => f.severity === 'critical');
  return {
    layer: 7, name: 'mcp_detector',
    verdict: hasCritical ? 'block' : findings.length > 0 ? 'audit' : 'allow',
    confidence: 0.9,
    details: findings.length > 0 ? `${findings.length} MCP security concerns` : 'MCP interaction OK',
    findings, durationMs: 0,
  };
}
```

---

## 7. Phase 4: CLI

### 7.1 CLI Commands

Use `commander.js` for the CLI framework.

```
puffer init          # First-time setup: scan system, create config, start daemon
puffer scan          # Run auto-discovery scan and report findings
puffer status        # Show current protection status
puffer logs          # Stream audit log in real-time (like tail -f)
puffer config        # Open or edit configuration
puffer start         # Start Puffer daemon
puffer stop          # Stop Puffer daemon
puffer inflate       # Switch to paranoid mode (whitelist-only)
puffer deflate       # Switch back to normal mode
```

### 7.2 `puffer init` — The Magic Command

This is the most important command. It must work perfectly on first run.

**Flow:**

1. Print the Puffer ASCII art banner
2. Run the full auto-discovery scan (all 3 scanners)
3. Display discovered agents and LLM servers with security warnings
4. Ask the user which to protect (default: all)
5. Create `~/.puffer/` directory
6. Generate `~/.puffer/config.yaml` with auto-discovered providers
7. Start the Puffer daemon in background
8. Display final status

**ASCII art banner:**

```
    🐡 P U F F E R
    The autonomous immune system for AI agents.
    ─────────────────────────────────────────────
```

**Example output:**

```
$ npx puffer init

🐡 P U F F E R v0.1.0
The autonomous immune system for AI agents.
─────────────────────────────────────────────

Scanning your system...

DISCOVERED:
  ✓ Ollama on :11434 (models: llama3, deepseek-r1)
    ⚠️  WARNING: Bound to 0.0.0.0 — exposed to network!
    → Proxy: localhost:8787

  ✓ Claude Code (PID 4521)
    → Hook installed

  ✓ Python process calling api.openai.com (PID 8832)
    → Proxy: localhost:8788

  ✓ OpenClaw gateway on :18789
    → Hook installed

Config saved: ~/.puffer/config.yaml
Audit log: ~/.puffer/audit.jsonl
Dashboard: http://localhost:8788

STATUS:
  🟢 4 agents protected
  🟢 7-layer defense active
  🟢 Mode: enforce

Puffer is watching. 🐡
```

---

## 8. Phase 5: Dashboard

### 8.1 Dashboard Specifications

The dashboard is a React SPA served by an Express server on `localhost:8788`.

**Pages:**

1. **Overview**: Real-time stats — events/min, blocks/min, active agents, cost tracking
2. **Events**: Searchable, filterable list of all events with layer results
3. **Agents**: List of discovered agents with protection status
4. **Alerts**: Recent blocks and security warnings
5. **Config**: Visual config editor

**Tech stack**: React + Tailwind CSS + Recharts (for charts). Build with Vite. Serve the built files via Express from the main Puffer process.

**Real-time updates**: Use WebSocket from the main process to push events to the dashboard as they happen.

### 8.2 Dashboard API Endpoints

```
GET  /api/stats          # Overall stats (events count, blocks, agents, cost)
GET  /api/events         # Paginated event list with filters
GET  /api/events/:id     # Single event detail
GET  /api/agents         # Discovered agents
GET  /api/alerts         # Recent alerts
GET  /api/config         # Current config
PUT  /api/config         # Update config
WS   /ws                 # Real-time event stream
```

---

## 9. Phase 6: Agent Hooks

### 9.1 Claude Code Hook

Claude Code supports a hook system via `~/.claude/settings.json`. Puffer registers a pre-execution hook that intercepts tool calls before they run.

The hook script receives the tool call details (command, file path, URL) via stdin, sends it to the Puffer daemon via HTTP, and returns the decision.

### 9.2 OpenClaw Hook

OpenClaw supports a skill system. Puffer installs as a "security middleware" skill that runs before every other skill. It uses OpenClaw's event system to intercept actions.

### 9.3 Generic Hook

For agents without native hook support, Puffer can wrap the agent's process using `LD_PRELOAD` (Linux) or similar techniques to intercept system calls. This is complex and not needed for MVP.

---

## 10. Configuration System

### 10.1 Default Configuration — `config/default-policy.yaml`

```yaml
# Puffer Default Configuration
# https://github.com/puffer-fish/puffer

version: "0.1.0"
mode: enforce  # monitor | enforce | paranoid | interactive

auto_discovery:
  enabled: true
  scan_interval_ms: 30000
  process_scanner: true
  port_scanner: true
  network_scanner: true

layers:
  pii:
    enabled: true
    regions: ["us", "eu", "global"]
    action_by_severity:
      critical: block
      high: block
      medium: audit
      low: log
    custom_patterns: []
    exclude_contexts: []

  injection:
    enabled: true
    mode: heuristic
    thresholds:
      direct_input:
        block: 0.65
        audit: 0.40
      external_content:
        block: 0.50
        audit: 0.30
    heuristics:
      - role_switching
      - system_delimiters
      - imperative_override
      - data_exfil_instruction
      - encoding_detection
      - hidden_text
      - prompt_leaking
      - tool_abuse

  commands:
    enabled: true
    blocked_patterns:
      - "rm -rf /"
      - "rm -rf ~"
      - "curl * | bash"
      - "curl * | sh"
      - "wget * | bash"
      - "wget * | sh"
      - "chmod 777 *"
      - ":(){ :|:& };:"
      - "> /dev/sd*"
      - "mkfs *"
      - "dd * of=/dev/*"
    require_approval:
      - "sudo *"
      - "npm publish *"
      - "git push * main"
      - "git push * master"
      - "docker run * --privileged *"
    max_commands_per_minute: 60
    consecutive_block_threshold: 3

  network:
    enabled: true
    mode: blacklist
    allowed_domains: []
    blocked_domains: []
    block_private_ips: true
    max_payload_size_mb: 50
    scan_payload_for_pii: true

  filesystem:
    enabled: true
    forbidden:
      - "~/.ssh/"
      - "~/.aws/"
      - "~/.gnupg/"
      - "~/.env"
      - "~/.config/gcloud/"
      - "~/.kube/config"
      - "~/.docker/config.json"
      - "~/.npmrc"
      - "~/.pypirc"
      - "~/.netrc"
      - "/etc/shadow"
    restricted:
      - "~/.gitconfig"
      - "~/.bashrc"
      - "~/.zshrc"
      - ".github/workflows/"
    workspace:
      - "~/workspace/"
      - "~/projects/"
      - "~/code/"
      - "/tmp/"
    secret_patterns:
      - "sk-[a-zA-Z0-9]{20,}"
      - "ghp_[a-zA-Z0-9]{36}"
      - "AKIA[A-Z0-9]{16}"
      - "-----BEGIN.*PRIVATE KEY"
      - "sk-ant-[a-zA-Z0-9-]{20,}"

  behavior:
    enabled: true
    max_cost_per_session_usd: 10.00
    max_cost_per_hour_usd: 20.00
    loop_detection:
      window_size: 20
      similarity_threshold: 0.85
      consecutive_matches: 5
    sensitivity: medium

  mcp:
    enabled: true
    authorized_servers: []
    block_unauthorized: false
    scan_tool_results: true

dashboard:
  enabled: true
  port: 8788

audit:
  log_path: "~/.puffer/audit.jsonl"
  retention_days: 30

alerts:
  desktop: true
  webhook: null
```

---

## 11. Audit Logging

### 11.1 Log Format

Every event is logged as a single JSON line (JSONL) in `~/.puffer/audit.jsonl`.

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "timestamp": "2026-03-12T14:30:00.000Z",
  "source": { "type": "proxy", "agent": "openclaw", "provider": "ollama", "model": "llama3" },
  "action": { "type": "llm_request", "method": "POST", "endpoint": "/api/chat" },
  "decision": "BLOCK",
  "layers": [
    { "layer": 1, "name": "pii_scanner", "verdict": "block", "confidence": 0.95, "details": "SSN detected", "durationMs": 1 },
    { "layer": 2, "name": "injection_detector", "verdict": "allow", "confidence": 0.1, "durationMs": 3 }
  ],
  "metadata": { "sessionId": "abc123", "sequenceNumber": 42, "costEstimate": 0 }
}
```

Note: The actual request/response bodies are NOT logged by default (privacy). Only metadata, decisions, and findings are logged. Bodies can be optionally logged for debugging.

---

## 12. Testing Strategy

### 12.1 Test Framework

Use `vitest` for all tests. Fast, TypeScript-native, compatible with Jest API.

### 12.2 Test Categories

**Unit tests** for each layer:
- PII Scanner: Test each regex pattern with positive and negative examples
- Injection Detector: Test each heuristic with real and synthetic attacks
- Command Analyzer: Test dangerous/safe commands, path traversal, blocklist
- Network Egress: Test whitelist/blacklist, DGA detection, SSRF blocking
- Filesystem: Test forbidden/restricted/workspace paths, secret detection
- Behavior: Test cost limits, loop detection, consecutive blocks
- MCP: Test unauthorized servers, tool injection

**Integration tests:**
- Full proxy flow: Request → Layers → Decision → Forward/Block
- Auto-discovery: Mock processes, ports, network connections
- Config loading and validation

### 12.3 Test Data

Create a `tests/fixtures/` directory with:
- `injection-attacks.json`: 50+ real prompt injection examples
- `safe-prompts.json`: 50+ normal prompts that should NOT be blocked
- `pii-samples.json`: Examples of each PII type
- `commands-dangerous.json`: Dangerous commands
- `commands-safe.json`: Safe commands

---

## 13. Packaging and Distribution

### 13.1 npm Package

```json
{
  "name": "puffer-agent-firewall",
  "version": "0.1.0",
  "description": "🐡 The autonomous immune system for AI agents",
  "bin": {
    "puffer": "./dist/cli/index.js"
  },
  "main": "./dist/index.js",
  "keywords": ["ai", "security", "firewall", "agent", "llm", "openai", "anthropic", "ollama", "prompt-injection", "pii"],
  "license": "Apache-2.0",
  "repository": "https://github.com/puffer-fish/puffer"
}
```

### 13.2 Installation Methods

```bash
# npx (zero install)
npx puffer-agent-firewall init

# Global install
npm install -g puffer-agent-firewall
puffer init

# From source
git clone https://github.com/puffer-fish/puffer.git
cd puffer
npm install
npm run build
npm link
puffer init
```

---

## 14. README and Documentation

The README must include:
1. Puffer ASCII logo and tagline
2. One-line install command
3. Animated GIF showing auto-discovery and a blocked attack
4. Feature list (7 layers, auto-discovery, multi-provider support)
5. Supported agents and providers table
6. Quick configuration example
7. How it works section (the subconscious analogy)
8. Comparison with alternatives (LlamaFirewall, Sage, Sentinel)
9. Contributing guide
10. License

---

## Build Order (for Claude Code)

Execute in this exact order:

1. **Initialize project**: package.json, tsconfig.json, install dependencies
2. **Types**: `src/types.ts` — all interfaces
3. **Utils**: `src/utils/` — config loader, logger, constants
4. **Proxy**: `src/proxy/` — the HTTP proxy server
5. **Layer 1 (PII)**: `src/layers/layer-1-pii.ts` + tests
6. **Layer 2 (Injection)**: `src/layers/layer-2-injection.ts` + tests
7. **Layer 3 (Commands)**: `src/layers/layer-3-commands.ts` + tests
8. **Layer 4 (Network)**: `src/layers/layer-4-network.ts` + tests
9. **Layer 5 (Filesystem)**: `src/layers/layer-5-filesystem.ts` + tests
10. **Layer 6 (Behavior)**: `src/layers/layer-6-behavior.ts` + tests
11. **Layer 7 (MCP)**: `src/layers/layer-7-mcp.ts` + tests
12. **Pipeline**: `src/layers/index.ts` — orchestrator
13. **Discovery**: `src/discovery/` — all scanners
14. **Decision Engine**: `src/engine/`
15. **Audit**: `src/audit/`
16. **CLI**: `src/cli/` — all commands
17. **Main**: `src/index.ts` — ties everything together
18. **Integration tests**
19. **Dashboard** (can be built in parallel)
20. **README**
21. **Package and publish**

---

## Final Notes

- Every console output should be prefixed with `🐡` or `[PUFFER]`
- Use chalk for colored terminal output
- The log format for blocked actions: `[🐡 PUFFER] BLOCKED: <reason> | Layer: <name> | Agent: <agent>`
- The log format for allowed actions (verbose mode only): `[🐡 PUFFER] ALLOW: <action> | 7 layers passed in <X>ms`
- When in doubt about a security decision, BLOCK and log. False positives are better than false negatives.
- The proxy should add a header to forwarded requests: `X-Puffer-Scanned: true` so downstream can verify Puffer is active
- Never log actual PII values — always redact
- The daemon should handle SIGTERM gracefully and flush audit logs before exit
