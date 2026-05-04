# Integrating OpenClaw with Puffer

OpenClaw is a self-hosted personal AI assistant runtime ([openclaw/openclaw](https://github.com/openclaw/openclaw)).
Its gateway runs at `http://127.0.0.1:18789` by default, with persistent memory,
multi-provider LLM support (Anthropic, OpenAI, Gemini, DeepSeek, …), and an
ecosystem of community skills.

This document describes how Puffer observes and protects OpenClaw traffic.

## What OpenClaw exposes — and what it does NOT

We probed the live `:18789` API and read the upstream docs. The picture:

| Capability                                            | Status           | Notes                                                                                                                                  |
| ----------------------------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Inbound webhooks (`POST /hooks/<name>`)               | ✅ Supported     | External services call OpenClaw to trigger agent turns. NOT useful for observing OpenClaw's own activity.                              |
| Outbound webhooks (OpenClaw → my URL on every action) | ❌ Not supported | Confirmed against `docs.openclaw.ai/automation/webhook` and live gateway. The only outbound hook is per-cron-task, not per-action.     |
| Pre-action interception API                           | ❌ Not supported | No documented `/api/hooks` `/api/skills/register` `/api/middleware` endpoint. Skills are filesystem-loaded plugins running in-process. |
| Custom provider `baseUrl` override                    | ✅ Supported     | Lets us route every LLM call through Puffer's reverse proxy. **This is the integration we use.**                                       |
| Plugin SDK (`openclaw plugins install`)               | ✅ Supported     | An in-process plugin could intercept actions, but requires shipping a separate npm package. Out of scope for v0.x.                     |

## How Puffer integrates: provider-level reverse proxy

OpenClaw's `~/.openclaw/openclaw.json` accepts overrides for built-in providers.
Pointing those at Puffer's proxy port routes 100 % of OpenClaw's LLM traffic
through Puffer's defense pipeline — same path Claude Code uses via
`ANTHROPIC_BASE_URL`.

### Configuration

Edit `~/.openclaw/openclaw.json` and add (or merge into) the `models` section:

```json
{
  "models": {
    "mode": "merge",
    "providers": {
      "anthropic": {
        "baseUrl": "http://127.0.0.1:8787",
        "apiKey": "${ANTHROPIC_API_KEY}",
        "api": "anthropic-messages"
      },
      "openai": {
        "baseUrl": "http://127.0.0.1:8787",
        "apiKey": "${OPENAI_API_KEY}",
        "api": "openai-completions"
      }
    }
  }
}
```

Replace `8787` with the actual `proxyPort` from your Puffer config if you
overrode the default.

### Apply

1. Save the file.
2. Restart OpenClaw — the gateway re-reads `openclaw.json` only on boot.
3. Issue a request through OpenClaw (chat message, channel command, agent turn).
4. Open the Puffer dashboard at `http://127.0.0.1:8788`. You should see a card
   for `openclaw` with `ev/min > 0`, plus tokens and cost populating.

### What Puffer captures once routed

| Signal                                              | Captured                                                                        |
| --------------------------------------------------- | ------------------------------------------------------------------------------- |
| `llm_request` event with full body                  | ✅                                                                              |
| `llm_response` event with parsed body               | ✅                                                                              |
| Real `inputTokens` / `outputTokens` / `totalTokens` | ✅                                                                              |
| Cost estimate (provider × model)                    | ✅                                                                              |
| Streaming SSE responses (Anthropic, OpenAI)         | ✅ — pipeline scans the assembled text after the stream completes               |
| Provider rate-limit headers                         | ✅                                                                              |
| Pre-flight blocking (`mode: enforce`)               | ✅ — request returns 403 from Puffer; OpenClaw surfaces the error to its caller |

### What Puffer does NOT capture from OpenClaw

- **Tool execution** that happens inside OpenClaw and never touches an LLM
  (filesystem ops, channel sends). Those are out of scope for the proxy because
  they bypass it by design.
- **Cron-only events** that have no LLM call. Use OpenClaw's per-cron webhook
  delivery to hit a Puffer endpoint if you need those — out of scope today.
- **Plugin internals**. Plugins running in-process do not generate HTTP calls
  unless they call an LLM.

## Why the daemon does NOT auto-configure OpenClaw

We deliberately do **not** mutate `~/.openclaw/openclaw.json` on `install()`.
The file is user-owned and may contain hand-crafted provider catalogs, agent
defaults, and custom skills. Auto-merging risks clobbering or invalidating that
state. Instead, on daemon startup the `OpenClawHook`:

1. Probes `http://127.0.0.1:18789/health`.
2. Reads `~/.openclaw/openclaw.json` and checks whether `models.providers.{anthropic,openai}.baseUrl`
   already points at Puffer's proxy.
3. Logs `info` if routed correctly; logs an actionable `warn` with the snippet
   above if not. Never writes to OpenClaw's config.

You will see one of these two log lines on every daemon start:

```
[🐡 PUFFER] OpenClaw is routed through Puffer proxy — full observability active
```

```
[🐡 PUFFER] OpenClaw is running but its providers are not routed through Puffer.
Add to /home/<user>/.openclaw/openclaw.json: models.providers.anthropic.baseUrl="http://127.0.0.1:8787" …
```

## Verification snippets

```bash
# Confirm the OpenClaw gateway is alive
curl -s http://127.0.0.1:18789/health | jq

# Confirm Puffer's proxy is alive on the expected port
curl -s http://127.0.0.1:8787/__puffer/health | jq

# After editing openclaw.json and restarting OpenClaw, run a chat turn and
# tail the daemon log:
tail -f ~/.puffer/daemon.log | grep -i openclaw
```

## Provider detection for third-party agents (model-prefix tier)

OpenClaw's DeepSeek provider sends standard OpenAI Chat Completions requests to the proxy without any Puffer-specific headers (e.g. `x-puffer-target`, `x-puffer-original-host`). Before this fix the proxy could only distinguish providers via URL path or those headers, so `/v1/chat/completions` from DeepSeek was detected as `openai-compatible` and forwarded to `https://api.openai.com`, producing 401 errors and incorrect telemetry.

`detectProvider()` in `packages/proxy/src/providers.ts` now includes a **model-prefix tier** (tier 4) that activates when the path is `/v1/chat/completions` or `/v1/embeddings` and no `x-puffer-original-host` header resolved to a known provider. It inspects `body.model` (string, case-insensitive prefix match) against a compact lookup table covering DeepSeek, OpenAI, Anthropic, Google, Mistral, Cohere, Together, and Groq. Unknown prefixes and non-string model fields fall back to `openai-compatible` as before. No headers or config changes are required from the agent side — the routing is fully transparent.

## References

- OpenClaw repo: <https://github.com/openclaw/openclaw>
- Model providers configuration: <https://github.com/openclaw/openclaw/blob/main/docs/concepts/model-providers.md>
- Webhook docs (inbound only): <https://docs.openclaw.ai/automation/webhook>
- Puffer proxy entry point: `packages/proxy/src/index.ts`
- Puffer OpenClaw hook: `packages/hooks/src/openclaw.ts`
