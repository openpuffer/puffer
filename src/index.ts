import fs from 'node:fs';
import { v4 as uuidv4 } from 'uuid';
import { PufferConfig, PufferEvent, Decision } from './types.js';
import { loadConfig, ensurePufferDir } from './utils/config.js';
import { PID_FILE_PATH } from './utils/constants.js';
import { logger } from './utils/logger.js';
import { createProxyServer, ProxyServer } from './proxy/index.js';
import { createDefaultPipeline, DefensePipeline } from './layers/index.js';
import { DiscoveryEngine } from './discovery/index.js';
import { AuditLogger } from './audit/logger.js';
import { makeDecision } from './engine/decision.js';
import { createDashboardServer, DashboardServer } from './dashboard/server.js';
import { HookManager } from './hooks/index.js';
import { ClaudeCodeHook } from './hooks/claude-code.js';
import { AiderHook } from './hooks/aider.js';
import { ContinueDevHook } from './hooks/continue-dev.js';
import { ClineHook } from './hooks/cline.js';
import { CursorHook } from './hooks/cursor.js';
import { OpenClawHook } from './hooks/openclaw.js';
import { GenericHook } from './hooks/generic.js';
import { VSCodeExtensionHook } from './hooks/vscode-extension.js';

export interface PufferDaemon {
  proxy: ProxyServer;
  dashboard: DashboardServer | null;
  pipeline: DefensePipeline;
  discovery: DiscoveryEngine;
  auditLogger: AuditLogger;
  hookManager: HookManager;
  stop(): Promise<void>;
}

export async function startDaemon(configOverride?: PufferConfig): Promise<PufferDaemon> {
  ensurePufferDir();

  const config = configOverride ?? loadConfig();

  logger.info(`Starting Puffer daemon in ${config.mode} mode`);

  // Initialize audit logger
  const auditLogger = new AuditLogger(config.audit.logPath);

  // Initialize defense pipeline
  const pipeline = createDefaultPipeline(config);

  // Initialize discovery engine
  const discovery = new DiscoveryEngine();
  if (config.autoDiscovery.enabled) {
    discovery.start(config.autoDiscovery.scanIntervalMs);
  }

  // Start dashboard first so we know the resolved port for hooks
  let dashboard: DashboardServer | null = null;
  if (config.dashboard.enabled) {
    dashboard = createDashboardServer(
      { auditLogger, discovery, config, evaluatePipeline: async (event) => {
        const evaluated = await pipeline.evaluate(event);
        evaluated.decision = makeDecision(evaluated, { mode: config.mode });
        return evaluated;
      }},
      config.dashboard.port
    );
    await dashboard.start();
  }

  // Create and start proxy BEFORE installing hooks, so the proxy port is
  // listening before ANTHROPIC_BASE_URL is set in agent configurations.
  const proxy = createProxyServer({
    config,
    evaluatePipeline: async (event) => {
      const evaluated = await pipeline.evaluate(event);
      evaluated.decision = makeDecision(evaluated, { mode: config.mode });
      return evaluated;
    },
    logEvent: (event) => {
      auditLogger.log(event);
      if (dashboard) dashboard.broadcast(event);
    },
  });

  await proxy.start();

  // Initialize hook manager (uses resolved dashboard port + proxy port)
  const resolvedDashboardPort = dashboard?.getPort() ?? config.dashboard.port;
  const proxyPort = config.providers[0]?.proxyPort ?? 8787;
  const hookManager = new HookManager();
  hookManager.registerHook(new ClaudeCodeHook(resolvedDashboardPort, proxyPort));
  hookManager.registerHook(new AiderHook());
  hookManager.registerHook(new ContinueDevHook());
  hookManager.registerHook(new ClineHook());
  hookManager.registerHook(new CursorHook());
  hookManager.registerHook(new OpenClawHook(resolvedDashboardPort));
  hookManager.registerHook(new VSCodeExtensionHook(proxyPort));
  hookManager.registerHook(new GenericHook());

  // Install hooks AFTER proxy is listening
  await hookManager.installAll();

  // Pass hook manager to discovery for protection status resolution
  discovery.setHookManager(hookManager);

  hookManager.setEventCallback(async (event) => {
    const evaluated = await pipeline.evaluate(event);
    evaluated.decision = makeDecision(evaluated, { mode: config.mode });
    auditLogger.log(evaluated);
    return evaluated;
  });

  // Generate passive events when discovery finds active network connections
  discovery.onDiscoveryUpdate((result) => {
    for (const agent of result.agents) {
      if (agent.detectedVia !== 'network') continue;

      const event: PufferEvent = {
        id: uuidv4(),
        timestamp: new Date().toISOString(),
        source: {
          type: 'proxy',
          agent: agent.name,
          provider: agent.provider ?? agent.name,
          pid: agent.pid,
        },
        action: {
          type: 'llm_request',
          method: 'NETWORK',
          endpoint: `${agent.provider ?? agent.name}:443`,
          body: { pid: agent.pid, command: agent.command },
        },
        payload: { detectedVia: 'network', provider: agent.provider },
        metadata: { sessionId: 'network-monitor', sequenceNumber: 0 },
        layers: [],
        decision: 'ALLOW' as Decision,
      };

      auditLogger.log(event);
      if (dashboard) dashboard.broadcast(event);
    }
  });

  // Write PID file
  fs.writeFileSync(PID_FILE_PATH, String(process.pid));

  // Handle graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down...');
    await hookManager.uninstallAll();
    discovery.stop();
    if (dashboard) await dashboard.stop();
    await proxy.stop();
    await auditLogger.flush();

    // Remove PID file
    try {
      fs.unlinkSync(PID_FILE_PATH);
    } catch {
      // Ignore if already removed
    }

    logger.info('Puffer daemon stopped');
  };

  process.on('SIGTERM', async () => {
    await shutdown();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    await shutdown();
    process.exit(0);
  });

  // Crash resilience: clean up hooks even on unexpected errors so
  // ANTHROPIC_BASE_URL doesn't point to a dead port.
  process.on('uncaughtException', async (err) => {
    logger.error(`Uncaught exception: ${err.message}`);
    try { await hookManager.uninstallAll(); } catch { /* best effort */ }
    process.exit(1);
  });

  process.on('unhandledRejection', async (reason) => {
    logger.error(`Unhandled rejection: ${reason}`);
    try { await hookManager.uninstallAll(); } catch { /* best effort */ }
    process.exit(1);
  });

  logger.info('Puffer daemon is running');

  return {
    proxy,
    dashboard,
    pipeline,
    discovery,
    auditLogger,
    hookManager,
    stop: shutdown,
  };
}
