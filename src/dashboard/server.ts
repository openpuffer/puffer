import express from 'express';
import cors from 'cors';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { PufferEvent, PufferConfig, DashboardStats } from '../types.js';
import { AuditLogger } from '../audit/logger.js';
import { DiscoveryEngine } from '../discovery/index.js';
import { logger } from '../utils/logger.js';
import { loadConfig, saveConfig } from '../utils/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface DashboardDependencies {
  auditLogger: AuditLogger;
  discovery: DiscoveryEngine;
  config: PufferConfig;
}

export interface DashboardServer {
  start(): Promise<void>;
  stop(): Promise<void>;
  broadcast(event: PufferEvent): void;
}

export function createDashboardServer(deps: DashboardDependencies, port: number): DashboardServer {
  const app = express();
  app.use(cors());
  app.use(express.json());

  // Serve static dashboard files
  const publicDir = path.resolve(__dirname, '../../dashboard/dist');
  app.use(express.static(publicDir));

  // API endpoints
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
      totalCost: 0,
      eventsPerMinute: 0,
    };
    res.json(response);
  });

  app.get('/api/events', (req, res) => {
    const limit = parseInt(req.query.limit as string) || 50;
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
    const alerts = entries.filter((e) => e.decision === 'BLOCK' || e.decision === 'ESCALATE');
    res.json({ alerts: alerts.slice(0, 50) });
  });

  app.get('/api/config', (_req, res) => {
    res.json(deps.config);
  });

  app.put('/api/config', (req, res) => {
    try {
      const newConfig = req.body as PufferConfig;
      Object.assign(deps.config, newConfig);
      saveConfig(deps.config);
      res.json({ success: true });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // Fallback: serve index.html for SPA routing
  app.get('*', (_req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  const server = http.createServer(app);

  // WebSocket for real-time updates
  const wss = new WebSocketServer({ server, path: '/ws' });
  const clients = new Set<WebSocket>();

  wss.on('connection', (ws) => {
    clients.add(ws);
    ws.on('close', () => clients.delete(ws));
    ws.on('error', () => clients.delete(ws));
  });

  return {
    start(): Promise<void> {
      return new Promise((resolve) => {
        server.listen(port, '127.0.0.1', () => {
          logger.info(`Dashboard available at http://127.0.0.1:${port}`);
          resolve();
        });
      });
    },

    stop(): Promise<void> {
      return new Promise((resolve) => {
        for (const client of clients) {
          client.close();
        }
        wss.close();
        server.close(() => resolve());
      });
    },

    broadcast(event: PufferEvent): void {
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
  };
}
