import fs from 'node:fs';
import http from 'node:http';
import { v4 as uuidv4 } from 'uuid';
import type { PufferConfig, PufferEvent, Decision } from './types.js';
import type { DaemonReadyMessage } from './types/ipc.js';
import { loadConfig, ensurePufferDir } from './utils/config.js';
import { DEFAULT_PROXY_PORT, PID_FILE_PATH } from './utils/constants.js';
import { logger } from './utils/logger.js';
import type { ProxyServer } from './proxy/index.js';
import { createProxyServer } from './proxy/index.js';
import type { DefensePipeline } from './layers/index.js';
import { createDefaultPipeline } from './layers/index.js';
import { DiscoveryEngine } from './discovery/index.js';
import { AuditLogger } from './audit/logger.js';
import { makeDecision } from './engine/decision.js';
import type { DashboardServer } from './dashboard/server.js';
import { createDashboardServer } from './dashboard/server.js';
import { HookManager } from './hooks/index.js';
import { ClaudeCodeHook } from './hooks/claude-code.js';
import { AiderHook } from './hooks/aider.js';
import { ContinueDevHook } from './hooks/continue-dev.js';
import { ClineHook } from './hooks/cline.js';
import { CursorHook } from './hooks/cursor.js';
import { OpenClawHook } from './hooks/openclaw.js';
import { GenericHook } from './hooks/generic.js';
import { VSCodeExtensionHook } from './hooks/vscode-extension.js';
import { AlertDispatcher } from './alerts/dispatcher.js';
import { WebhookChannel } from './alerts/channels/webhook.js';
import { DesktopChannel } from './alerts/channels/desktop.js';
import { CloudReporter } from './cloud/reporter.js';

export interface PufferDaemon {
  proxy: ProxyServer;
  dashboard: DashboardServer | null;
  pipeline: DefensePipeline;
  discovery: DiscoveryEngine;
  auditLogger: AuditLogger;
  hookManager: HookManager;
  stop(): Promise<void>;
}

/**
 * Check if a process with the given PID is alive.
 */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Verify that the proxy health endpoint responds.
 */
async function verifyProxyHealth(port: number, retries = 5, delayMs = 300): Promise<boolean> {
  for (let i = 0; i < retries; i++) {
    try {
      const ok = await new Promise<boolean>((resolve) => {
        const req = http.get(`http://127.0.0.1:${port}/__puffer/health`, (res) => {
          res.resume(); // drain
          resolve(res.statusCode === 200);
        });
        req.on('error', () => resolve(false));
        req.setTimeout(1000, () => {
          req.destroy();
          resolve(false);
        });
      });
      if (ok) return true;
    } catch {
      /* retry */
    }
    if (i < retries - 1) await new Promise((r) => setTimeout(r, delayMs));
  }
  return false;
}

/**
 * Force-uninstall all hooks that modify external configuration.
 * Does NOT check PID file — always runs. Used by stop command after killing.
 */
export async function forceCleanupHooks(): Promise<void> {
  const tempHookManager = new HookManager();
  const proxyPort = DEFAULT_PROXY_PORT;
  tempHookManager.registerHook(new ClaudeCodeHook(DEFAULT_PROXY_PORT, proxyPort));
  tempHookManager.registerHook(new GenericHook());
  tempHookManager.registerHook(new VSCodeExtensionHook(proxyPort));
  await tempHookManager.uninstallAll();
  logger.info('Hooks force-cleaned');
}

/**
 * Clean up stale config from a dead Puffer instance.
 * Call at startup to ensure settings.json and shell profiles are clean.
 */
export async function cleanupStaleConfig(): Promise<void> {
  if (!fs.existsSync(PID_FILE_PATH)) return;

  const pid = parseInt(fs.readFileSync(PID_FILE_PATH, 'utf-8').trim(), 10);
  if (isNaN(pid)) {
    fs.unlinkSync(PID_FILE_PATH);
    return;
  }

  if (isProcessAlive(pid)) {
    throw new Error(
      `Another Puffer instance is already running (PID ${pid}). Use 'puffer stop' first.`,
    );
  }

  // Dead process — clean up its hooks
  logger.warn(`Cleaning up stale config from dead Puffer instance (PID ${pid})`);
  await forceCleanupHooks();

  try {
    fs.unlinkSync(PID_FILE_PATH);
  } catch {
    /* ignore */
  }
  logger.info('Stale config cleaned up successfully');
}

export async function startDaemon(configOverride?: PufferConfig): Promise<PufferDaemon> {
  ensurePufferDir();

  // Clean up stale config from any dead previous instance
  await cleanupStaleConfig();

  const config = configOverride ?? loadConfig();

  logger.info(`Starting Puffer daemon in ${config.mode} mode`);

  // Initialize audit logger
  const auditLogger = new AuditLogger(config.audit.logPath);

  // Initialize alert dispatcher
  const alertDispatcher = new AlertDispatcher();
  if (config.alerts?.webhook) {
    alertDispatcher.addChannel(new WebhookChannel(config.alerts.webhook));
  }
  if (config.alerts?.desktop) {
    alertDispatcher.addChannel(new DesktopChannel());
  }

  // Initialize cloud reporter (optional)
  const cloudReporter = config.cloud?.enabled ? new CloudReporter(config.cloud) : null;
  cloudReporter?.start();

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
      {
        auditLogger,
        discovery,
        config,
        evaluatePipeline: async (event) => {
          const evaluated = await pipeline.evaluate(event);
          evaluated.decision = makeDecision(evaluated, { mode: config.mode });
          return evaluated;
        },
      },
      config.dashboard.port,
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
      // Alert dispatch is fire-and-forget so it doesn't block the proxy
      // pipeline, but a silent failure means an operator never finds out
      // their webhook/desktop notification stopped working. Log loudly.
      alertDispatcher.dispatch(event).catch((err: unknown) => {
        logger.error(`Alert dispatch failed for event ${event.id}: ${(err as Error).message}`);
      });
      cloudReporter?.enqueue(event);
    },
    getDiscoveredAgentNames: () => discovery.getAgents().map((a) => a.name),
  });

  await proxy.start();

  // Verify the proxy is actually accepting connections before installing hooks
  const healthy = await verifyProxyHealth(proxy.port);
  if (!healthy) {
    await proxy.stop();
    throw new Error(
      `Proxy started but health check failed on port ${proxy.port}. Aborting — hooks NOT installed.`,
    );
  }

  // Signal readiness to parent process (used in daemon fork mode)
  if (typeof process.send === 'function') {
    const readyMsg: DaemonReadyMessage = {
      type: 'ready',
      dashboardPort: dashboard?.getPort() ?? config.dashboard.port,
      proxyPort: proxy.port,
    };
    process.send(readyMsg);
  }

  // Initialize hook manager (uses resolved dashboard port + proxy port)
  const resolvedDashboardPort = dashboard?.getPort() ?? config.dashboard.port;
  const proxyPort = config.providers[0]?.proxyPort || DEFAULT_PROXY_PORT;
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
    // Same reasoning as the proxy logEvent path above: don't block hook
    // delivery on dispatch, but never swallow the failure.
    alertDispatcher.dispatch(evaluated).catch((err: unknown) => {
      logger.error(
        `Alert dispatch failed for hook event ${evaluated.id}: ${(err as Error).message}`,
      );
    });
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

  // SIGUSR1 = graceful drain mode: uninstall hooks, switch to passthrough,
  // and auto-exit after 2 minutes. Existing sessions keep working through
  // the transparent proxy while new sessions go direct to the API.
  process.on('SIGUSR1', async () => {
    logger.info('Entering drain mode — passthrough enabled, auto-exit in 120s');
    try {
      await hookManager.uninstallAll();
    } catch {
      /* best effort */
    }
    proxy.setPassthrough(true);
    // Keep PID file alive so `puffer stop --force` can still find us
    setTimeout(async () => {
      logger.info('Drain timeout reached — shutting down');
      discovery.stop();
      if (dashboard) await dashboard.stop();
      await proxy.stop();
      await auditLogger.flush();
      try {
        fs.unlinkSync(PID_FILE_PATH);
      } catch {
        /* ignore */
      }
      process.exit(0);
    }, 120_000);
  });

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
    try {
      await hookManager.uninstallAll();
    } catch {
      /* best effort */
    }
    process.exit(1);
  });

  process.on('unhandledRejection', async (reason) => {
    logger.error(`Unhandled rejection: ${reason}`);
    try {
      await hookManager.uninstallAll();
    } catch {
      /* best effort */
    }
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
