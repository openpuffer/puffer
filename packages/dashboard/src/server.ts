import express from 'express';
import cors from 'cors';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import type { PufferEvent, PufferConfig, AuditLogEntry } from '@puffer/core';
import type { AuditLogger } from '@puffer/audit';
import type { DiscoveryEngine } from '@puffer/discovery';
import { makeDecision } from '@puffer/engine';
import { logger } from '@puffer/core';
import { saveConfig } from '@puffer/core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Common dev ports to avoid
const DEV_PORTS_TO_AVOID = new Set([
  3000,
  3001,
  3002,
  3003, // React, Next.js
  4200, // Angular
  5173,
  5174, // Vite
  8000, // Django, vLLM
  8080,
  8081, // LocalAI, generic
  8888, // Jupyter
  9000,
  9090, // Various
  11434, // Ollama
  1234, // LM Studio
]);

export interface DashboardDependencies {
  auditLogger: AuditLogger;
  discovery: DiscoveryEngine;
  config: PufferConfig;
  evaluatePipeline: (event: PufferEvent) => Promise<PufferEvent>;
}

export interface DashboardServer {
  start(): Promise<void>;
  stop(): Promise<void>;
  broadcast(event: PufferEvent): void;
  getPort(): number;
}

/**
 * Check if a port is available on 127.0.0.1
 */
function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const tester = net
      .createServer()
      .once('error', () => resolve(false))
      .once('listening', () => {
        tester.close(() => resolve(true));
      })
      .listen(port, '127.0.0.1');
  });
}

/**
 * Find an available port starting from the preferred one.
 * Skips common dev ports to avoid conflicts.
 */
async function findAvailablePort(preferred: number): Promise<number> {
  // Try preferred port first
  if (!DEV_PORTS_TO_AVOID.has(preferred) && (await isPortAvailable(preferred))) {
    return preferred;
  }

  // If preferred is in dev ports list, warn and look elsewhere
  if (DEV_PORTS_TO_AVOID.has(preferred)) {
    logger.warn(`Port ${preferred} is a common dev port, looking for alternative`);
  }

  // Search from preferred port upward, skipping dev ports
  for (let port = preferred; port < preferred + 100; port++) {
    if (DEV_PORTS_TO_AVOID.has(port)) continue;
    if (await isPortAvailable(port)) return port;
  }

  // Fallback: let the OS pick
  return 0;
}

export function createDashboardServer(
  deps: DashboardDependencies,
  preferredPort: number,
): DashboardServer {
  const app = express();

  // Security: only allow requests from localhost
  app.use((req, res, next) => {
    const ip = req.ip ?? req.socket.remoteAddress ?? '';
    const isLocal = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
    if (!isLocal) {
      res.status(403).json({ error: 'Dashboard is only accessible from localhost' });
      return;
    }
    next();
  });

  // Security headers
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://127.0.0.1:*",
    );
    next();
  });

  app.use(cors({ origin: /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/ }));
  app.use(express.json());

  // Serve static dashboard files
  // From packages/dashboard/src/, three levels up reaches the repo root,
  // and the frontend builds to apps/dashboard/dist/.
  const publicDir = path.resolve(__dirname, '../../../apps/dashboard/dist');
  app.use(express.static(publicDir));

  // === Event rate & cost tracking ===
  const eventTimestamps: number[] = [];
  let totalCostAccumulator = 0;
  let totalTokensAccumulator = 0;

  // Per-agent usage tracking
  interface AgentUsage {
    totalTokens: number;
    inputTokens: number;
    outputTokens: number;
    totalCost: number;
    requests: number;
    models: Record<string, number>; // model → request count
    rateLimits?: { limitTokens?: number | undefined; limitRequests?: number | undefined };
  }
  const agentUsageMap = new Map<string, AgentUsage>();

  function getOrCreateAgentUsage(agentName: string): AgentUsage {
    let usage = agentUsageMap.get(agentName);
    if (!usage) {
      usage = {
        totalTokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalCost: 0,
        requests: 0,
        models: {},
      };
      agentUsageMap.set(agentName, usage);
    }
    return usage;
  }

  function recordEvent(event?: PufferEvent): void {
    eventTimestamps.push(Date.now());
    // Keep only last 5 minutes of timestamps
    const fiveMinAgo = Date.now() - 5 * 60 * 1000;
    while (eventTimestamps.length > 0 && (eventTimestamps[0] ?? Infinity) < fiveMinAgo) {
      eventTimestamps.shift();
    }
    // Only accumulate cost and tokens from llm_response events to avoid
    // double-counting: the request estimates input cost, then the response
    // computes the real cost (input + output) from provider usage data.
    const isResponse = event?.action?.type === 'llm_response';
    if (isResponse && event?.metadata.costEstimate) {
      totalCostAccumulator += event.metadata.costEstimate;
    }
    if (isResponse && event?.metadata.totalTokens) {
      totalTokensAccumulator += event.metadata.totalTokens;
    }

    // Accumulate per-agent usage (only from responses)
    if (event?.source?.agent) {
      const usage = getOrCreateAgentUsage(event.source.agent);
      usage.requests++;
      if (isResponse && event.metadata.inputTokens) usage.inputTokens += event.metadata.inputTokens;
      if (isResponse && event.metadata.outputTokens)
        usage.outputTokens += event.metadata.outputTokens;
      if (isResponse && event.metadata.totalTokens) usage.totalTokens += event.metadata.totalTokens;
      if (isResponse && event.metadata.costEstimate) usage.totalCost += event.metadata.costEstimate;
      if (event.metadata.model) {
        usage.models[event.metadata.model] = (usage.models[event.metadata.model] ?? 0) + 1;
      }
      if (event.metadata.rateLimits) {
        usage.rateLimits = event.metadata.rateLimits;
      }
    }
  }

  function getEventsPerMinute(): number {
    const oneMinAgo = Date.now() - 60 * 1000;
    return eventTimestamps.filter((t) => t >= oneMinAgo).length;
  }

  // === Prometheus metrics ===
  // Exposed unprefixed at /metrics so any standard scraper picks it up
  // without configuration. The localhost-only middleware higher up
  // already restricts access to the local host.
  app.get('/metrics', async (_req, res) => {
    try {
      const { renderMetrics } = await import('@puffer/observability');
      const { contentType, body } = await renderMetrics();
      res.set('Content-Type', contentType);
      res.send(body);
    } catch (err) {
      logger.error(`Failed to render metrics: ${(err as Error).message}`);
      res.status(500).type('text/plain').send('# metrics collection failed');
    }
  });

  // === API endpoints ===

  app.get('/api/stats', (_req, res) => {
    const stats = deps.auditLogger.getStats();
    const agents = deps.discovery.getAgents();
    const response = {
      totalEvents: stats.total,
      blockedEvents: stats.blocked,
      allowedEvents: stats.allowed,
      auditEvents: stats.audit,
      escalatedEvents: stats.escalated,
      activeAgents: agents.length,
      totalCost: totalCostAccumulator,
      totalTokens: totalTokensAccumulator,
      eventsPerMinute: getEventsPerMinute(),
      mode: deps.config.mode,
    };
    res.json(response);
  });

  app.get('/api/agent-usage', (_req, res) => {
    const result: Record<string, AgentUsage> = {};
    for (const [name, usage] of agentUsageMap) {
      result[name] = usage;
    }
    res.json(result);
  });

  app.get('/api/events', (req, res) => {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 500);
    const offset = parseInt(req.query.offset as string) || 0;
    const filter = req.query.filter as string | undefined;

    let entries = deps.auditLogger.readEntries(limit + offset);
    if (filter) {
      entries = entries.filter((e) => e.decision === filter.toUpperCase());
    }
    entries = entries.slice(offset, offset + limit);
    res.json({ events: entries, total: deps.auditLogger.getEventCount() });
  });

  app.get('/api/events/:id', (req, res) => {
    const entries = deps.auditLogger.readEntries(10000);
    const event = entries.find((e) => e.id === req.params.id);
    if (event) {
      res.json(event);
    } else {
      res.status(404).json({ error: 'Event not found' });
    }
  });

  app.get('/api/agents', (_req, res) => {
    const agents = deps.discovery.getAgents();
    res.json({ agents });
  });

  app.get('/api/score', async (_req, res) => {
    try {
      const { calculateScore } = await import('@puffer/score');
      const result = await deps.discovery.scan();
      const stats = deps.auditLogger.getStats();
      const score = calculateScore(deps.config, result, stats);
      res.json(score);
    } catch (err) {
      logger.error('Failed to calculate score', err);
      res.status(500).json({ error: 'Failed to calculate score' });
    }
  });

  app.get('/api/report/weekly', async (_req, res) => {
    try {
      const { calculateScore } = await import('@puffer/score');
      const { generateWeeklyReport } = await import('@puffer/reports');
      const result = await deps.discovery.scan();
      const stats = deps.auditLogger.getStats();
      const score = calculateScore(deps.config, result, stats);
      const report = generateWeeklyReport(deps.auditLogger, {
        current: score.total,
        grade: score.grade,
      });
      res.json(report);
    } catch (err) {
      logger.error('Failed to generate report', err);
      res.status(500).json({ error: 'Failed to generate report' });
    }
  });

  app.get('/api/alerts', (_req, res) => {
    const entries = deps.auditLogger.readEntries(100);
    const alerts = entries.filter(
      (e: AuditLogEntry) => e.decision === 'BLOCK' || e.decision === 'ESCALATE',
    );
    res.json({ alerts: alerts.slice(0, 50) });
  });

  app.get('/api/config', (_req, res) => {
    res.json(deps.config);
  });

  app.put('/api/config', (req, res) => {
    try {
      const updates = req.body as Partial<PufferConfig>;

      // Validate: only allow specific fields to be updated
      const allowedTopKeys = ['mode', 'layers', 'dashboard', 'audit', 'alerts', 'autoDiscovery'];
      for (const key of Object.keys(updates)) {
        if (!allowedTopKeys.includes(key)) {
          res.status(400).json({ error: `Cannot update field: ${key}` });
          return;
        }
      }

      Object.assign(deps.config, updates);
      saveConfig(deps.config);
      res.json({ success: true, config: deps.config });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // === Hook endpoints for AI agent tool call interception ===

  /**
   * Map a tool name from Claude Code (or similar agent) to a PufferEvent action.
   */
  function toolNameToAction(
    toolName: string,
    toolInput: Record<string, unknown>,
  ): PufferEvent['action'] {
    switch (toolName) {
      case 'Bash':
      case 'bash':
        return {
          type: 'command_execute',
          command: String(toolInput.command ?? ''),
          args: [],
        };
      case 'Read':
      case 'read':
        return {
          type: 'file_read',
          path: String(toolInput.file_path ?? ''),
        };
      case 'Write':
      case 'write':
      case 'Edit':
      case 'edit':
        return {
          type: 'file_write',
          path: String(toolInput.file_path ?? ''),
        };
      case 'WebFetch':
      case 'WebSearch':
        return {
          type: 'network_request',
          url: String(toolInput.url ?? ''),
          method: 'GET',
        };
      case 'Agent':
        return {
          type: 'mcp_tool_call',
          server: 'claude-code-agent',
          tool: 'subagent',
          params: {
            subagent_type: String(
              toolInput.subagent_type ?? toolInput.subagentType ?? 'general-purpose',
            ),
            description: String(toolInput.description ?? ''),
            ...toolInput,
          },
        };
      default:
        // Detect MCP tool calls: tool names like "mcp__serverName__toolName"
        if (toolName.startsWith('mcp__') || toolName.startsWith('mcp_')) {
          const separator = toolName.startsWith('mcp__') ? '__' : '_';
          const parts = toolName.split(separator);
          const mcpServer = parts[1] || 'unknown';
          const mcpTool = parts.slice(2).join(separator) || 'unknown';
          return {
            type: 'mcp_tool_call',
            server: mcpServer,
            tool: mcpTool,
            params: toolInput,
          };
        }
        return {
          type: 'llm_request',
          method: 'TOOL',
          endpoint: toolName,
          body: toolInput,
        };
    }
  }

  /**
   * Build a PufferEvent from hook data.
   */
  function buildHookEvent(
    toolName: string,
    toolInput: Record<string, unknown>,
    sessionId: string,
    agentName: string,
  ): PufferEvent {
    return {
      id: uuidv4(),
      timestamp: new Date().toISOString(),
      source: {
        type: 'hook',
        agent: agentName,
        provider: agentName,
      },
      action: toolNameToAction(toolName, toolInput),
      payload: toolInput,
      metadata: {
        sessionId: sessionId || 'unknown',
        sequenceNumber: 0,
      },
      layers: [],
      decision: null,
    };
  }

  /**
   * POST /hooks/claude-code
   * Receives Claude Code PreToolUse hook data (JSON via stdin / curl POST -d @-).
   */
  app.post('/hooks/claude-code', async (req, res) => {
    try {
      const { tool_name, tool_input, session_id } = req.body as {
        tool_name: string;
        tool_input: Record<string, unknown>;
        session_id?: string;
      };

      if (!tool_name) {
        res.status(400).json({ error: 'Missing tool_name' });
        return;
      }

      const event = buildHookEvent(tool_name, tool_input ?? {}, session_id ?? '', 'claude-code');

      // Run through the evaluation pipeline
      const evaluated = await deps.evaluatePipeline(event);
      evaluated.decision = makeDecision(evaluated, { mode: deps.config.mode });

      // Log, broadcast, and track
      deps.auditLogger.log(evaluated);
      broadcastToAll(
        JSON.stringify({
          type: 'event',
          data: {
            id: evaluated.id,
            timestamp: evaluated.timestamp,
            source: evaluated.source,
            action: actionForBroadcast(evaluated.action),
            decision: evaluated.decision,
            layers: evaluated.layers.map((l) => ({
              layer: l.layer,
              name: l.name,
              verdict: l.verdict,
            })),
          },
        }),
      );
      broadcastToAll(buildStatsMessage());
      recordEvent(evaluated);

      const isBlocked = evaluated.decision === 'BLOCK' && deps.config.mode === 'enforce';
      const blockReason = isBlocked
        ? (evaluated.layers.find((l) => l.verdict === 'block')?.details ?? 'Blocked by Puffer')
        : undefined;

      // Return in Claude Code hook format: hookSpecificOutput with permissionDecision
      res.status(200).json({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: isBlocked ? 'deny' : 'allow',
          permissionDecisionReason: isBlocked
            ? `Puffer BLOCKED: ${blockReason}`
            : `Puffer: ${evaluated.decision}`,
        },
        decision: evaluated.decision,
        event_id: evaluated.id,
      });
    } catch (err) {
      logger.error(`Hook claude-code error: ${(err as Error).message}`);
      // Return allow on error so we don't block the user's workflow
      res.status(200).json({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'allow',
          permissionDecisionReason: `Puffer error: ${(err as Error).message}`,
        },
      });
    }
  });

  /**
   * POST /hooks/claude-code-response
   * Receives Claude Code PostToolUse hook data — the response path (provider → computer).
   */
  app.post('/hooks/claude-code-response', async (req, res) => {
    try {
      const { tool_name, tool_input, tool_result, session_id } = req.body as {
        tool_name: string;
        tool_input: Record<string, unknown>;
        tool_result?: unknown;
        session_id?: string;
      };

      if (!tool_name) {
        res.status(200).json({});
        return;
      }

      // Build a response event — action type = llm_response
      const event: PufferEvent = {
        id: uuidv4(),
        timestamp: new Date().toISOString(),
        source: {
          type: 'hook',
          agent: 'claude-code',
          provider: 'anthropic',
        },
        action: {
          type: 'llm_response',
          status: 200,
          body: tool_result ?? null,
        },
        payload: { tool_name, tool_input, tool_result },
        metadata: {
          sessionId: session_id || 'unknown',
          sequenceNumber: 0,
        },
        layers: [],
        decision: 'ALLOW',
      };

      // Run PostToolUse results through defense pipeline (detect PII, injection in results)
      const evaluated = await deps.evaluatePipeline(event);
      deps.auditLogger.log(evaluated);
      broadcastToAll(
        JSON.stringify({
          type: 'event',
          data: {
            id: evaluated.id,
            timestamp: evaluated.timestamp,
            source: evaluated.source,
            action: { type: 'llm_response' } as Record<string, unknown>,
            decision: evaluated.decision,
            layers: evaluated.layers.map((l) => ({
              layer: l.layer,
              name: l.name,
              verdict: l.verdict,
            })),
          },
        }),
      );
      broadcastToAll(buildStatsMessage());
      recordEvent(evaluated);

      if (evaluated.decision === 'BLOCK') {
        logger.blocked(
          `PostToolUse result blocked: ${evaluated.layers.find((l) => l.verdict === 'block')?.details ?? 'unknown'}`,
          evaluated.layers.find((l) => l.verdict === 'block')?.name ?? 'unknown',
          'claude-code',
        );
      }

      res.status(200).json({});
    } catch (err) {
      logger.error(`Hook claude-code-response error: ${(err as Error).message}`);
      res.status(200).json({});
    }
  });

  /**
   * POST /hooks/claude-code-notification
   * Receives Claude Code Notification hook data — session events, model changes, errors.
   */
  app.post('/hooks/claude-code-notification', async (req, res) => {
    try {
      const body = req.body as Record<string, unknown>;
      const category = String(body.type ?? body.category ?? 'notification');
      const message = String(body.message ?? body.notification ?? JSON.stringify(body));
      const sessionId = String(body.session_id ?? 'unknown');

      const event: PufferEvent = {
        id: uuidv4(),
        timestamp: new Date().toISOString(),
        source: {
          type: 'hook',
          agent: 'claude-code',
          provider: 'anthropic',
        },
        action: {
          type: 'notification',
          category,
          message,
        },
        payload: body,
        metadata: {
          sessionId,
          sequenceNumber: 0,
        },
        layers: [],
        decision: 'ALLOW',
      };

      deps.auditLogger.log(event);
      broadcastToAll(
        JSON.stringify({
          type: 'event',
          data: {
            id: event.id,
            timestamp: event.timestamp,
            source: event.source,
            action: { type: 'notification', category } as Record<string, unknown>,
            decision: 'ALLOW',
            layers: [],
          },
        }),
      );
      broadcastToAll(buildStatsMessage());
      recordEvent(event);

      res.status(200).json({});
    } catch (err) {
      logger.error(`Hook claude-code-notification error: ${(err as Error).message}`);
      res.status(200).json({});
    }
  });

  /**
   * POST /hooks/openclaw
   * Receives OpenClaw preAction hook data — action details for pipeline evaluation.
   */
  app.post('/hooks/openclaw', async (req, res) => {
    try {
      const body = req.body as Record<string, unknown>;
      const actionType = String(body.action_type ?? body.type ?? 'unknown');
      const sessionId = String(body.session_id ?? 'unknown');

      // Map OpenClaw action types to PufferEvent actions
      let action: PufferEvent['action'];
      switch (actionType) {
        case 'shell_execute':
          action = {
            type: 'command_execute',
            command: String(body.command ?? ''),
            args: Array.isArray(body.args) ? body.args.map(String) : [],
          };
          break;
        case 'file_read':
          action = { type: 'file_read', path: String(body.path ?? '') };
          break;
        case 'file_write':
          action = {
            type: 'file_write',
            path: String(body.path ?? ''),
            content: body.content as string | undefined,
          };
          break;
        case 'http_request':
          action = {
            type: 'network_request',
            url: String(body.url ?? ''),
            method: String(body.method ?? 'GET'),
            body: body.payload,
          };
          break;
        case 'skill_invoke':
          action = {
            type: 'mcp_tool_call',
            server: String(body.server ?? 'openclaw'),
            tool: String(body.skill ?? body.tool ?? ''),
            params: body.params ?? {},
          };
          break;
        default:
          action = { type: 'llm_request', method: 'HOOK', endpoint: actionType, body };
          break;
      }

      const event: PufferEvent = {
        id: uuidv4(),
        timestamp: new Date().toISOString(),
        source: { type: 'hook', agent: 'openclaw', provider: 'openclaw' },
        action,
        payload: body,
        metadata: { sessionId, sequenceNumber: 0 },
        layers: [],
        decision: null,
      };

      const evaluated = await deps.evaluatePipeline(event);
      deps.auditLogger.log(evaluated);
      broadcastToAll(
        JSON.stringify({
          type: 'event',
          data: {
            id: evaluated.id,
            timestamp: evaluated.timestamp,
            source: evaluated.source,
            action: { type: actionType } as Record<string, unknown>,
            decision: evaluated.decision,
            layers: evaluated.layers.map((l) => ({
              layer: l.layer,
              name: l.name,
              verdict: l.verdict,
            })),
          },
        }),
      );
      broadcastToAll(buildStatsMessage());
      recordEvent(evaluated);

      // Return allow/deny in OpenClaw's expected format
      res.status(200).json({
        allow: evaluated.decision !== 'BLOCK',
        reason:
          evaluated.decision === 'BLOCK'
            ? `Puffer: ${evaluated.layers.find((l) => l.verdict === 'block')?.details ?? 'Blocked'}`
            : undefined,
        decision: evaluated.decision,
        event_id: evaluated.id,
      });
    } catch (err) {
      logger.error(`Hook openclaw error: ${(err as Error).message}`);
      res.status(200).json({ allow: true }); // fail-open on hook error
    }
  });

  /**
   * POST /hooks/openclaw-response
   * Receives OpenClaw postAction hook data — logs results.
   */
  app.post('/hooks/openclaw-response', async (req, res) => {
    try {
      const body = req.body as Record<string, unknown>;
      const event: PufferEvent = {
        id: uuidv4(),
        timestamp: new Date().toISOString(),
        source: { type: 'hook', agent: 'openclaw', provider: 'openclaw' },
        action: { type: 'llm_response', status: 200, body: body.result ?? body },
        payload: body,
        metadata: { sessionId: String(body.session_id ?? 'unknown'), sequenceNumber: 0 },
        layers: [],
        decision: null,
      };

      const evaluated = await deps.evaluatePipeline(event);
      deps.auditLogger.log(evaluated);
      broadcastToAll(buildStatsMessage());
      recordEvent(evaluated);

      res.status(200).json({});
    } catch (err) {
      logger.error(`Hook openclaw-response error: ${(err as Error).message}`);
      res.status(200).json({});
    }
  });

  /**
   * POST /hooks/vscode
   * Receives events from the Puffer VS Code extension (LM calls, chat messages, code insertions).
   */
  app.post('/hooks/vscode', async (req, res) => {
    try {
      const body = req.body as Record<string, unknown>;
      const eventType = String(body.event_type ?? 'unknown');
      const agentName = String(body.agent ?? 'vscode');
      const sessionId = String(body.session_id ?? 'unknown');

      let action: PufferEvent['action'];
      switch (eventType) {
        case 'lm_call':
          action = {
            type: 'llm_request',
            method: 'LM_API',
            endpoint: String(body.model ?? 'unknown'),
            body: body.messages ?? body.content,
          };
          break;
        case 'chat_message':
          action = {
            type: 'llm_request',
            method: 'CHAT',
            endpoint: String(body.participant ?? 'copilot'),
            body: body.prompt ?? body.message,
          };
          break;
        case 'code_insertion':
          action = {
            type: 'file_write',
            path: String(body.file ?? 'unknown'),
            content: String(body.content ?? ''),
          };
          break;
        case 'extension_detected':
          action = {
            type: 'agent_activity_summary',
            agent: String(body.extension_id ?? agentName),
            summary: String(body.summary ?? 'Extension detected'),
            connections: Number(body.connections ?? 0),
          };
          break;
        default:
          action = { type: 'llm_request', method: 'VSCODE', endpoint: eventType, body };
          break;
      }

      const event: PufferEvent = {
        id: uuidv4(),
        timestamp: new Date().toISOString(),
        source: { type: 'hook', agent: agentName, provider: String(body.provider ?? 'vscode') },
        action,
        payload: body,
        metadata: { sessionId, sequenceNumber: 0 },
        layers: [],
        decision: null,
      };

      const evaluated = await deps.evaluatePipeline(event);
      deps.auditLogger.log(evaluated);
      broadcastToAll(
        JSON.stringify({
          type: 'event',
          data: {
            id: evaluated.id,
            timestamp: evaluated.timestamp,
            source: evaluated.source,
            action: { type: eventType } as Record<string, unknown>,
            decision: evaluated.decision,
            layers: evaluated.layers.map((l) => ({
              layer: l.layer,
              name: l.name,
              verdict: l.verdict,
            })),
          },
        }),
      );
      broadcastToAll(buildStatsMessage());
      recordEvent(evaluated);

      res.status(200).json({
        decision: evaluated.decision,
        event_id: evaluated.id,
      });
    } catch (err) {
      logger.error(`Hook vscode error: ${(err as Error).message}`);
      res.status(200).json({ decision: 'ALLOW' });
    }
  });

  /**
   * POST /hooks/generic
   * Accepts any agent's tool call data: { tool_name, tool_input, session_id, agent_name }.
   */
  app.post('/hooks/generic', async (req, res) => {
    try {
      const { tool_name, tool_input, session_id, agent_name } = req.body as {
        tool_name: string;
        tool_input: Record<string, unknown>;
        session_id?: string;
        agent_name?: string;
      };

      if (!tool_name) {
        res.status(400).json({ error: 'Missing tool_name' });
        return;
      }

      const event = buildHookEvent(
        tool_name,
        tool_input ?? {},
        session_id ?? '',
        agent_name ?? 'unknown-agent',
      );

      // Run through the evaluation pipeline
      const evaluated = await deps.evaluatePipeline(event);
      evaluated.decision = makeDecision(evaluated, { mode: deps.config.mode });

      // Log, broadcast, and track
      deps.auditLogger.log(evaluated);
      broadcastToAll(
        JSON.stringify({
          type: 'event',
          data: {
            id: evaluated.id,
            timestamp: evaluated.timestamp,
            source: evaluated.source,
            action: actionForBroadcast(evaluated.action),
            decision: evaluated.decision,
            layers: evaluated.layers.map((l) => ({
              layer: l.layer,
              name: l.name,
              verdict: l.verdict,
            })),
          },
        }),
      );
      broadcastToAll(buildStatsMessage());
      recordEvent(evaluated);

      const isBlocked = evaluated.decision === 'BLOCK' && deps.config.mode === 'enforce';
      const blockReason = isBlocked
        ? (evaluated.layers.find((l) => l.verdict === 'block')?.details ?? 'Blocked by Puffer')
        : undefined;

      res.status(200).json({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: isBlocked ? 'deny' : 'allow',
          permissionDecisionReason: isBlocked
            ? `Puffer BLOCKED: ${blockReason}`
            : `Puffer: ${evaluated.decision}`,
        },
        decision: evaluated.decision,
        event_id: evaluated.id,
      });
    } catch (err) {
      logger.error(`Hook generic error: ${(err as Error).message}`);
      res.status(200).json({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'allow',
          permissionDecisionReason: `Puffer error: ${(err as Error).message}`,
        },
      });
    }
  });

  /**
   * POST /hooks/browser
   * Receives text from the Puffer browser extension for full 7-layer scan.
   * Returns enriched results including per-layer findings.
   */
  app.post('/hooks/browser', async (req, res) => {
    try {
      const { text, site, session_id } = req.body as {
        text: string;
        site?: string;
        session_id?: string;
      };

      if (!text) {
        res.status(400).json({ error: 'Missing text' });
        return;
      }

      const event = buildHookEvent(
        'browser_input',
        { text, site: site ?? 'unknown' },
        session_id ?? `ext-${Date.now()}`,
        'puffer-extension',
      );

      const evaluated = await deps.evaluatePipeline(event);
      evaluated.decision = makeDecision(evaluated, { mode: deps.config.mode });

      deps.auditLogger.log(evaluated);
      broadcastToAll(
        JSON.stringify({
          type: 'event',
          data: {
            id: evaluated.id,
            timestamp: evaluated.timestamp,
            source: evaluated.source,
            action: actionForBroadcast(evaluated.action),
            decision: evaluated.decision,
            layers: evaluated.layers.map((l) => ({
              layer: l.layer,
              name: l.name,
              verdict: l.verdict,
            })),
          },
        }),
      );
      broadcastToAll(buildStatsMessage());
      recordEvent(evaluated);

      res.status(200).json({
        allow: evaluated.decision !== 'BLOCK' || deps.config.mode !== 'enforce',
        decision: evaluated.decision,
        event_id: evaluated.id,
        findings: evaluated.layers
          .flatMap((l) =>
            l.findings.map((f) => ({
              layer: l.name,
              type: f.type,
              severity: f.severity,
              value: f.value,
            })),
          )
          .slice(0, 10),
      });
    } catch (err) {
      logger.error(`Hook browser error: ${(err as Error).message}`);
      res.status(200).json({ allow: true, decision: 'ALLOW', findings: [] });
    }
  });

  /**
   * Extract broadcast-safe metadata (tokens, cost, model, rate limits).
   */
  function metadataForBroadcast(
    meta: PufferEvent['metadata'],
  ): Record<string, unknown> | undefined {
    const data: Record<string, unknown> = {};
    if (meta.inputTokens) data.inputTokens = meta.inputTokens;
    if (meta.outputTokens) data.outputTokens = meta.outputTokens;
    if (meta.totalTokens) data.totalTokens = meta.totalTokens;
    if (meta.costEstimate) data.costEstimate = meta.costEstimate;
    if (meta.model) data.model = meta.model;
    if (meta.rateLimits) data.rateLimits = meta.rateLimits;
    if (meta.debugInfo) data.debugInfo = meta.debugInfo;
    return Object.keys(data).length > 0 ? data : undefined;
  }

  /**
   * Extract broadcast-safe action data, including MCP fields when present.
   */
  function actionForBroadcast(action: PufferEvent['action']): Record<string, unknown> {
    const data: Record<string, unknown> = { type: action.type };
    if (action.type === 'mcp_tool_call') {
      data.server = action.server;
      data.tool = action.tool;
      if (typeof action.params === 'object' && action.params !== null) {
        const params = action.params as Record<string, unknown>;
        if (params.description) data.description = params.description;
        if (params.subagent_type) data.subagentType = params.subagent_type;
      }
    } else if (action.type === 'mcp_tool_result') {
      data.server = action.server;
      data.tool = action.tool;
    }
    return data;
  }

  // Fallback: serve index.html for SPA routing
  app.get('*', (_req, res) => {
    const indexPath = path.join(publicDir, 'index.html');
    res.sendFile(indexPath, (err) => {
      if (err) {
        res.status(200).send(`
          <html><body style="background:#0f172a;color:#e2e8f0;font-family:system-ui;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0">
          <div style="text-align:center"><h1>&#x1F421; Puffer Dashboard</h1><p style="color:#94a3b8">Build the dashboard first: <code style="background:#1e293b;padding:2px 8px;border-radius:4px">cd dashboard && npm install && npm run build</code></p></div>
          </body></html>
        `);
      }
    });
  });

  const httpServer = http.createServer(app);

  // Shutdown guard: prevents broadcasts after stop() is called
  let shuttingDown = false;

  // WebSocket for real-time updates (only from localhost)
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
  const clients = new Set<WebSocket>();

  wss.on('connection', (ws, req) => {
    const ip = req.socket.remoteAddress ?? '';
    const isLocal = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
    if (!isLocal) {
      ws.close(1008, 'Only localhost connections allowed');
      return;
    }
    clients.add(ws);
    ws.on('close', () => clients.delete(ws));
    ws.on('error', () => {
      clients.delete(ws);
      try {
        ws.close();
      } catch {
        /* already closed */
      }
    });
  });

  function buildStatsMessage(): string {
    const stats = deps.auditLogger.getStats();
    const agents = deps.discovery.getAgents();
    return JSON.stringify({
      type: 'stats',
      payload: {
        totalEvents: stats.total,
        blockedEvents: stats.blocked,
        allowedEvents: stats.allowed,
        auditEvents: stats.audit,
        escalatedEvents: stats.escalated,
        activeAgents: agents.length,
        totalCost: totalCostAccumulator,
        totalTokens: totalTokensAccumulator,
        eventsPerMinute: getEventsPerMinute(),
        mode: deps.config.mode,
      },
    });
  }

  function broadcastToAll(message: string): void {
    if (shuttingDown) return;
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    }
  }

  // Periodic stats broadcast every 2 seconds
  const statsInterval = setInterval(() => {
    broadcastToAll(buildStatsMessage());
  }, 2000);

  // Periodic agents broadcast every 10 seconds
  const agentsInterval = setInterval(() => {
    const agents = deps.discovery.getAgents();
    broadcastToAll(
      JSON.stringify({
        type: 'agents',
        payload: { agents },
      }),
    );
  }, 10000);

  let resolvedPort = preferredPort;

  return {
    async start(): Promise<void> {
      resolvedPort = await findAvailablePort(preferredPort);

      if (resolvedPort !== preferredPort) {
        logger.warn(`Port ${preferredPort} unavailable, using ${resolvedPort} instead`);
      }

      return new Promise((resolve, reject) => {
        httpServer.listen(resolvedPort, '127.0.0.1', () => {
          logger.info(`Dashboard available at http://127.0.0.1:${resolvedPort}`);
          resolve();
        });
        httpServer.on('error', (err) => {
          logger.error(`Dashboard failed to start: ${err.message}`);
          reject(err);
        });
      });
    },

    stop(): Promise<void> {
      shuttingDown = true;
      clearInterval(statsInterval);
      clearInterval(agentsInterval);
      return new Promise((resolve) => {
        for (const client of clients) {
          client.close();
        }
        wss.close();
        httpServer.close(() => resolve());
      });
    },

    broadcast(event: PufferEvent): void {
      recordEvent(event);

      const message = JSON.stringify({
        type: 'event',
        data: {
          id: event.id,
          timestamp: event.timestamp,
          source: event.source,
          action: actionForBroadcast(event.action),
          decision: event.decision,
          layers: event.layers.map((l) => ({
            layer: l.layer,
            name: l.name,
            verdict: l.verdict,
          })),
          metadata: metadataForBroadcast(event.metadata),
        },
      });

      broadcastToAll(message);

      // Immediately send updated stats after each event
      broadcastToAll(buildStatsMessage());
    },

    getPort(): number {
      return resolvedPort;
    },
  };
}
