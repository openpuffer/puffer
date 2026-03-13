import express from 'express';
import cors from 'cors';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { PufferEvent, PufferConfig, DashboardStats, AuditLogEntry } from '../types.js';
import { AuditLogger } from '../audit/logger.js';
import { DiscoveryEngine } from '../discovery/index.js';
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
    const response: DashboardStats = {
      totalEvents: stats.total,
      blockedEvents: stats.blocked,
      allowedEvents: stats.allowed,
      auditEvents: stats.audit,
      escalatedEvents: stats.escalated,
      activeAgents: agents.length,
      totalCost: totalCostAccumulator,
      eventsPerMinute: getEventsPerMinute(),
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

      for (const client of clients) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(message);
        }
      }
    },

    getPort(): number {
      return resolvedPort;
    },
  };
}
