# Packaging & Release

> Extracted from PUFFER-GUIDE.md (sections 13–14 + Build Order + Final Notes).

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
  "keywords": [
    "ai",
    "security",
    "firewall",
    "agent",
    "llm",
    "openai",
    "anthropic",
    "ollama",
    "prompt-injection",
    "pii"
  ],
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
