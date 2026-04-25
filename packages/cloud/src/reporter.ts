// Cloud reporter — sends events and heartbeats to Puffer Server
// 100% optional. Only activates if config.cloud.enabled is true.

import type { PufferEvent } from '@puffer/core';
import { logger } from '@puffer/core';
import { VERSION } from '@puffer/core';
import os from 'node:os';

export interface CloudConfig {
  enabled: boolean;
  url: string; // e.g., https://puffer-server.example.com
  apiKey: string; // Agent API key
  batchSize?: number | undefined; // Events per batch (default 50)
  flushIntervalMs?: number | undefined; // Flush interval (default 60s)
}

export class CloudReporter {
  private config: CloudConfig;
  private queue: Array<Record<string, unknown>> = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private offline: boolean = false;

  constructor(config: CloudConfig) {
    this.config = config;
  }

  start(): void {
    if (!this.config.enabled) return;

    const interval = this.config.flushIntervalMs ?? 60_000;
    this.flushTimer = setInterval(() => this.flush(), interval);

    // Send initial heartbeat. Failures here are non-fatal — the heartbeat
    // path uses the same offline-flag pattern as flush(), so a noisy log on
    // every retry would spam the daemon log. Log once at debug detail.
    this.sendHeartbeat().catch((err: unknown) => {
      logger.warn(`Cloud reporter: initial heartbeat failed: ${(err as Error).message}`);
    });
    logger.info(`Cloud reporter started → ${this.config.url}`);
  }

  stop(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    // Final flush — daemon is shutting down, so we log but do not retry.
    // Anything still in the queue is intentionally lost; flush() already
    // re-queues on transient failure but here we have no second chance.
    this.flush().catch((err: unknown) => {
      logger.warn(
        `Cloud reporter: final flush dropped ${this.queue.length} event(s): ${(err as Error).message}`,
      );
    });
  }

  enqueue(event: PufferEvent): void {
    if (!this.config.enabled) return;

    this.queue.push({
      id: event.id,
      timestamp: event.timestamp,
      source_agent: event.source.agent,
      action_type: event.action.type,
      decision: event.decision ?? 'ALLOW',
      severity: event.layers
        .flatMap((l) => l.findings)
        .reduce<
          string | null
        >((max, f) => (!max || ['low', 'medium', 'high', 'critical'].indexOf(f.severity) > ['low', 'medium', 'high', 'critical'].indexOf(max) ? f.severity : max), null),
      layer: event.layers.find((l) => l.verdict === 'block')?.name,
      details: event.layers.find((l) => l.verdict === 'block')?.details,
      cost: event.metadata.costEstimate ?? 0,
      tokens: event.metadata.totalTokens ?? 0,
    });

    // Auto-flush if batch is full. flush() already handles network errors
    // by re-queuing and toggling the offline flag, so an unhandled rejection
    // here would only happen for a genuine bug — surface it loudly.
    const batchSize = this.config.batchSize ?? 50;
    if (this.queue.length >= batchSize) {
      this.flush().catch((err: unknown) => {
        logger.error(`Cloud reporter: auto-flush bug: ${(err as Error).message}`);
      });
    }
  }

  async flush(): Promise<void> {
    if (this.queue.length === 0) return;

    const batch = this.queue.splice(0, this.config.batchSize ?? 50);

    try {
      const resp = await fetch(`${this.config.url}/api/ingest`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-puffer-api-key': this.config.apiKey,
        },
        body: JSON.stringify({ events: batch }),
        signal: AbortSignal.timeout(10_000),
      });

      if (!resp.ok) {
        // Put events back in queue for retry
        this.queue.unshift(...batch);
        if (!this.offline) {
          logger.warn(`Cloud reporter: server returned ${resp.status}`);
          this.offline = true;
        }
      } else {
        if (this.offline) {
          logger.info('Cloud reporter: connection restored');
          this.offline = false;
        }
      }
    } catch (err) {
      // Network error — put events back for retry. We only log on the
      // transition to offline; subsequent failures are silent until the
      // server is reachable again to avoid a flood.
      this.queue.unshift(...batch);
      if (!this.offline) {
        logger.warn(
          `Cloud reporter: server unreachable, queuing events: ${(err as Error).message}`,
        );
        this.offline = true;
      }
    }

    // Cap offline queue at 10,000 events
    if (this.queue.length > 10_000) {
      this.queue = this.queue.slice(-10_000);
    }
  }

  async sendHeartbeat(
    score?: number,
    activeAgents?: number,
    totalEvents?: number,
    blockedEvents?: number,
    mode?: string,
  ): Promise<void> {
    if (!this.config.enabled) return;

    try {
      await fetch(`${this.config.url}/api/heartbeat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-puffer-api-key': this.config.apiKey,
        },
        body: JSON.stringify({
          score,
          active_agents: activeAgents,
          total_events: totalEvents,
          blocked_events: blockedEvents,
          mode,
          hostname: os.hostname(),
          version: VERSION,
        }),
        signal: AbortSignal.timeout(5_000),
      });
    } catch (err) {
      // Heartbeats are best-effort — they re-fire on every interval, so a
      // permanent failure would create log noise. Demote to debug-style
      // single warn the first time it fails and nothing thereafter.
      if (!this.offline) {
        logger.warn(`Cloud reporter: heartbeat failed: ${(err as Error).message}`);
        this.offline = true;
      }
    }
  }
}
