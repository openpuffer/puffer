import fs from 'node:fs';
import { PufferConfig } from './types.js';
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

  // Initialize hook manager
  const hookManager = new HookManager();
  hookManager.registerHook(new ClaudeCodeHook());
  hookManager.registerHook(new AiderHook());
  hookManager.registerHook(new ContinueDevHook());
  hookManager.registerHook(new ClineHook());
  hookManager.registerHook(new CursorHook());
  hookManager.registerHook(new OpenClawHook());
  hookManager.registerHook(new GenericHook());

  // Install hooks into agent configurations
  await hookManager.installAll();

  hookManager.setEventCallback(async (event) => {
    const evaluated = await pipeline.evaluate(event);
    evaluated.decision = makeDecision(evaluated, { mode: config.mode });
    auditLogger.log(evaluated);
    return evaluated;
  });

  // Create proxy server
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

  // Start proxy
  await proxy.start();

  // Start dashboard if enabled
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
