import type { PufferEvent } from '@puffer/core';
import { logger } from '../utils/logger.js';

export interface AlertChannel {
  name: string;
  send(alert: AlertPayload): Promise<void>;
}

export interface AlertPayload {
  severity: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  message: string;
  event: {
    id: string;
    agent: string;
    action: string;
    decision: string;
    layer?: string | undefined;
    details?: string | undefined;
  };
  timestamp: string;
}

export class AlertDispatcher {
  private channels: AlertChannel[] = [];
  private minSeverity: 'critical' | 'high' | 'medium' | 'low' = 'high';

  private static readonly SEVERITY_ORDER = ['low', 'medium', 'high', 'critical'] as const;

  addChannel(channel: AlertChannel): void {
    this.channels.push(channel);
    logger.info(`Alert channel registered: ${channel.name}`);
  }

  setMinSeverity(severity: 'critical' | 'high' | 'medium' | 'low'): void {
    this.minSeverity = severity;
  }

  async dispatch(event: PufferEvent): Promise<void> {
    if (!event.decision || event.decision === 'ALLOW') return;
    if (this.channels.length === 0) return;

    // Determine severity from findings
    const blockingLayer = event.layers.find(
      (l) => l.verdict === 'block' || l.verdict === 'escalate',
    );
    const maxSeverity = this.getMaxSeverity(event);

    if (!this.meetsThreshold(maxSeverity)) return;

    const payload: AlertPayload = {
      severity: maxSeverity,
      title: `Puffer ${event.decision}: ${event.action.type}`,
      message: blockingLayer?.details ?? `${event.decision} by defense pipeline`,
      event: {
        id: event.id,
        agent: event.source.agent,
        action: event.action.type,
        decision: event.decision,
        layer: blockingLayer?.name,
        details: blockingLayer?.details,
      },
      timestamp: event.timestamp,
    };

    // Send to all channels in parallel
    const results = await Promise.allSettled(this.channels.map((ch) => ch.send(payload)));

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const channel = this.channels[i];
      if (result?.status === 'rejected') {
        logger.warn(
          `Alert channel ${channel?.name ?? 'unknown'} failed: ${(result as PromiseRejectedResult).reason}`,
        );
      }
    }
  }

  private getMaxSeverity(event: PufferEvent): 'critical' | 'high' | 'medium' | 'low' {
    let max: 'critical' | 'high' | 'medium' | 'low' = 'low';
    for (const layer of event.layers) {
      for (const finding of layer.findings) {
        if (
          AlertDispatcher.SEVERITY_ORDER.indexOf(finding.severity) >
          AlertDispatcher.SEVERITY_ORDER.indexOf(max)
        ) {
          max = finding.severity;
        }
      }
    }
    // BLOCK without findings = at least high
    if (event.decision === 'BLOCK' && max === 'low') max = 'high';
    return max;
  }

  private meetsThreshold(severity: 'critical' | 'high' | 'medium' | 'low'): boolean {
    return (
      AlertDispatcher.SEVERITY_ORDER.indexOf(severity) >=
      AlertDispatcher.SEVERITY_ORDER.indexOf(this.minSeverity)
    );
  }
}
