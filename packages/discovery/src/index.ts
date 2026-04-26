import type { DiscoveredAgent, ProviderConfig, DiscoveryResult } from '@puffer/core';
import { scanProcesses } from './process-scanner.js';
import { scanPorts } from './port-scanner.js';
import { scanNetworkConnections } from './network-scanner.js';
import { logger } from '@puffer/core';
import type { HookManager } from '@puffer/hooks';
import { agentsActive } from '@puffer/observability';

/**
 * Resolve the actual protection status for a discovered agent.
 */
function resolveProtectionStatus(
  agent: DiscoveredAgent,
  installedHookNames: string[],
): 'protected' | 'partial' | 'unprotected' {
  // Agents matched by their name against installed hooks
  const hookInstalled = installedHookNames.some((hookName) => {
    if (hookName === 'claude-code' && agent.name === 'claude-code') return true;
    if (hookName === 'openclaw' && agent.name === 'openclaw') return true;
    if (
      hookName === 'vscode-extension' &&
      ['github-copilot', 'cursor', 'cline', 'continue-dev', 'windsurf', 'codeium'].includes(
        agent.name,
      )
    )
      return true;
    if (hookName === agent.name) return true;
    return false;
  });

  // Copilot is always partial at best (proprietary protocol)
  if (agent.name === 'github-copilot') {
    return hookInstalled ? 'partial' : 'unprotected';
  }

  // Claude Code with hooks = fully protected
  if (agent.name === 'claude-code' && hookInstalled) {
    return 'protected';
  }

  // Other agents with hooks
  if (hookInstalled) return 'partial';

  return 'unprotected';
}

/**
 * DiscoveryEngine continuously scans for AI agents, local LLM servers,
 * and outbound API connections. It tracks known agents across scans
 * and notifies listeners of changes.
 */
export class DiscoveryEngine {
  private knownAgents: Map<string, DiscoveredAgent> = new Map();
  private knownProviders: Map<string, ProviderConfig> = new Map();
  private interval: NodeJS.Timeout | null = null;
  private onUpdate: ((result: DiscoveryResult) => void) | null = null;
  private hookManager: HookManager | null = null;

  /**
   * Set a hook manager reference to resolve protection status.
   */
  setHookManager(hookManager: HookManager): void {
    this.hookManager = hookManager;
  }

  /**
   * Generates a stable key for deduplicating agents.
   */
  private agentKey(agent: DiscoveredAgent): string {
    if (agent.pid > 0) return `pid:${agent.pid}`;
    if (agent.port) return `port:${agent.port}`;
    return `${agent.detectedVia}:${agent.name}`;
  }

  /**
   * Runs all three scanners, merges and deduplicates results,
   * and tracks new/removed agents since the last scan.
   */
  async scan(): Promise<DiscoveryResult> {
    logger.debug('Discovery scan starting...');

    // Run all scanners
    const [processAgents, portResults, networkAgents] = await Promise.all([
      Promise.resolve(scanProcesses()),
      scanPorts(),
      scanNetworkConnections(),
    ]);

    // Collect all agents and providers from this scan
    const currentAgents = new Map<string, DiscoveredAgent>();
    const currentProviders = new Map<string, ProviderConfig>();
    const securityWarnings: string[] = [];

    // Process scanner results
    for (const agent of processAgents) {
      const key = this.agentKey(agent);
      if (!currentAgents.has(key)) {
        currentAgents.set(key, agent);
      }
    }

    // Port scanner results
    for (const result of portResults) {
      const key = this.agentKey(result.agent);
      if (!currentAgents.has(key)) {
        currentAgents.set(key, result.agent);
      }
      currentProviders.set(result.provider.name, result.provider);
      securityWarnings.push(...result.securityWarnings);
    }

    // Network scanner results
    for (const agent of networkAgents) {
      const key = this.agentKey(agent);
      if (!currentAgents.has(key)) {
        currentAgents.set(key, agent);
      }
    }

    // Resolve protection status for each agent
    if (this.hookManager) {
      const installedHookNames = this.hookManager.getInstalledHookNames();
      for (const [, agent] of currentAgents) {
        agent.protectionStatus = resolveProtectionStatus(agent, installedHookNames);
      }
    }

    // Determine new and removed agents
    const newSinceLastScan: DiscoveredAgent[] = [];
    const removedSinceLastScan: DiscoveredAgent[] = [];

    for (const [key, agent] of currentAgents) {
      if (!this.knownAgents.has(key)) {
        newSinceLastScan.push(agent);
        logger.info(`Discovered new agent: ${agent.name} (via ${agent.detectedVia})`);
      }
    }

    for (const [key, agent] of this.knownAgents) {
      if (!currentAgents.has(key)) {
        removedSinceLastScan.push(agent);
        logger.info(`Agent no longer detected: ${agent.name}`);
      }
    }

    // Update known state
    this.knownAgents = currentAgents;
    this.knownProviders = currentProviders;

    const result: DiscoveryResult = {
      agents: Array.from(currentAgents.values()),
      providers: Array.from(currentProviders.values()),
      securityWarnings,
      newSinceLastScan,
      removedSinceLastScan,
    };

    logger.debug(
      `Discovery scan complete: ${result.agents.length} agent(s), ` +
        `${result.providers.length} provider(s), ` +
        `${newSinceLastScan.length} new, ${removedSinceLastScan.length} removed`,
    );

    // Update the agents_active gauge so /metrics scrapers see the
    // current discovery snapshot bucketed by protection status. We set
    // every status to 0 first to avoid stale labels lingering after an
    // agent disappears.
    agentsActive.labels('protected').set(0);
    agentsActive.labels('partial').set(0);
    agentsActive.labels('unprotected').set(0);
    for (const agent of result.agents) {
      agentsActive.labels(agent.protectionStatus).inc();
    }

    // Notify listener
    if (this.onUpdate) {
      this.onUpdate(result);
    }

    return result;
  }

  /**
   * Starts periodic discovery scanning.
   * Runs an initial scan immediately, then repeats at the given interval.
   */
  start(intervalMs: number): void {
    if (this.interval) {
      logger.warn('Discovery engine is already running');
      return;
    }

    logger.info(`Discovery engine starting (interval: ${intervalMs}ms)`);

    // Set up periodic scanning first to ensure it runs even if initial scan fails
    this.interval = setInterval(() => {
      this.scan().catch((err) => {
        try {
          logger.error('Discovery scan failed', err);
        } catch {
          /* swallow */
        }
      });
    }, intervalMs);

    // Run initial scan (non-blocking)
    this.scan().catch((err) => {
      try {
        logger.error('Initial discovery scan failed', err);
      } catch {
        /* swallow */
      }
    });
  }

  /**
   * Stops periodic discovery scanning.
   */
  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
      logger.info('Discovery engine stopped');
    }
  }

  /**
   * Returns the currently known agents.
   */
  getAgents(): DiscoveredAgent[] {
    return Array.from(this.knownAgents.values());
  }

  /**
   * Returns the currently known providers.
   */
  getProviders(): ProviderConfig[] {
    return Array.from(this.knownProviders.values());
  }

  /**
   * Registers a callback to be invoked after each discovery scan.
   */
  onDiscoveryUpdate(callback: (result: DiscoveryResult) => void): void {
    this.onUpdate = callback;
  }
}
