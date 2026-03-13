import express from 'express';
import cors from 'cors';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { PufferEvent, PufferConfig, DashboardStats, AuditLogEntry } from '../types.js';
import { AuditLogger } from '../audit/logger.js';
import { DiscoveryEngine } from '../discovery/index.js';
import { makeDecision } from '../engine/decision.js';
import { logger } from '../utils/logger.js';
import { saveConfig } from '../utils/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Common dev ports to avoid
const DEV_PORTS_TO_AVOID = new Set([
  3000, 3001, 3002, 3003,  // React, Next.js
  4200,                      // Angular
  5173, 5174,                // Vite
  8000,                      // Django, vLLM
  8080, 8081,                // LocalAI, generic
  8888,                      // Jupyter
  9000, 9090,                // Various
  11434,                     // Ollama
  1234,                      // LM Studio
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
    const tester = net.createServer()
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
  if (!DEV_PORTS_TO_AVOID.has(preferred) && await isPortAvailable(preferred)) {
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

export function createDashboardServer(deps: DashboardDependencies, preferredPort: number): DashboardServer {
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
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://127.0.0.1:*");
    next();
  });

  app.use(cors({ origin: /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/ }));
  app.use(express.json());

  // Serve static dashboard files
  const publicDir = path.resolve(__dirname, '../../dashboard/dist');
  app.use(express.static(publicDir));

  // === Event rate & cost tracking ===
  const eventTimestamps: number[] = [];
  let totalCostAccumulator = 0;

  function recordEvent(event?: PufferEvent): void {
    eventTimestamps.push(Date.now());
    // Keep only last 5 minutes of timestamps
    const fiveMinAgo = Date.now() - 5 * 60 * 1000;
    while (eventTimestamps.length > 0 && eventTimestamps[0] < fiveMinAgo) {
      eventTimestamps.shift();
    }
    if (event?.metadata.costEstimate) {
      totalCostAccumulator += event.metadata.costEstimate;
    }
  }

  function getEventsPerMinute(): number {
    const oneMinAgo = Date.now() - 60 * 1000;
    return eventTimestamps.filter((t) => t >= oneMinAgo).length;
  }

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
      eventsPerMinute: getEventsPerMinute(),
      mode: deps.config.mode,
    };
    res.json(response);
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

  app.get('/api/alerts', (_req, res) => {
    const entries = deps.auditLogger.readEntries(100);
    const alerts = entries.filter((e: AuditLogEntry) => e.decision === 'BLOCK' || e.decision === 'ESCALATE');
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
  function toolNameToAction(toolName: string, toolInput: Record<string, unknown>): PufferEvent['action'] {
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
          params: toolInput,
        };
      default:
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
        provider: 'claude-code',
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
      broadcastToAll(JSON.stringify({
        type: 'event',
        data: {
          id: evaluated.id,
          timestamp: evaluated.timestamp,
          source: evaluated.source,
          action: { type: evaluated.action.type },
          decision: evaluated.decision,
          layers: evaluated.layers.map((l) => ({
            layer: l.layer,
            name: l.name,
            verdict: l.verdict,
          })),
        },
      }));
      broadcastToAll(buildStatsMessage());
      recordEvent(evaluated);

      const isBlocked = evaluated.decision === 'BLOCK' && deps.config.mode === 'enforce';
      res.status(isBlocked ? 403 : 200).json({
        decision: evaluated.decision,
        event_id: evaluated.id,
      });
    } catch (err) {
      logger.error(`Hook claude-code error: ${(err as Error).message}`);
      res.status(500).json({ error: (err as Error).message });
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
      broadcastToAll(JSON.stringify({
        type: 'event',
        data: {
          id: evaluated.id,
          timestamp: evaluated.timestamp,
          source: evaluated.source,
          action: { type: evaluated.action.type },
          decision: evaluated.decision,
          layers: evaluated.layers.map((l) => ({
            layer: l.layer,
            name: l.name,
            verdict: l.verdict,
          })),
        },
      }));
      broadcastToAll(buildStatsMessage());
      recordEvent(evaluated);

      const isBlocked = evaluated.decision === 'BLOCK' && deps.config.mode === 'enforce';
      res.status(isBlocked ? 403 : 200).json({
        decision: evaluated.decision,
        event_id: evaluated.id,
      });
    } catch (err) {
      logger.error(`Hook generic error: ${(err as Error).message}`);
      res.status(500).json({ error: (err as Error).message });
    }
  });

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
    ws.on('error', () => clients.delete(ws));
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
        eventsPerMinute: getEventsPerMinute(),
        mode: deps.config.mode,
      },
    });
  }

  function broadcastToAll(message: string): void {
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
    broadcastToAll(JSON.stringify({
      type: 'agents',
      payload: { agents },
    }));
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
          action: { type: event.action.type },
          decision: event.decision,
          layers: event.layers.map((l) => ({
            layer: l.layer,
            name: l.name,
            verdict: l.verdict,
          })),
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
