import type { PufferEvent, Decision, LayerResult } from '@puffer/core';
import { logger } from '../utils/logger.js';

export interface DecisionContext {
  mode: 'monitor' | 'enforce' | 'paranoid' | 'interactive';
}

/**
 * Makes the final decision based on layer results and operating mode.
 * In most cases the pipeline already sets the decision, but this
 * engine applies mode-specific overrides and logging.
 */
export function makeDecision(event: PufferEvent, context: DecisionContext): Decision {
  const decision = event.decision;

  if (!decision) {
    // Pipeline didn't set a decision — this shouldn't happen, but default to ALLOW
    logger.warn(`No decision set for event ${event.id}, defaulting to ALLOW`);
    return 'ALLOW';
  }

  // Mode overrides
  switch (context.mode) {
    case 'monitor':
      // In monitor mode, never block — just audit everything
      if (decision === 'BLOCK') {
        logger.info(`[MONITOR MODE] Would have blocked event ${event.id}, allowing instead`);
        return 'AUDIT';
      }
      return decision;

    case 'paranoid':
      // In paranoid mode, escalate anything that's auditable
      if (decision === 'AUDIT') return 'ESCALATE';
      return decision;

    case 'interactive':
      // In interactive mode, escalate blocks for user confirmation
      if (decision === 'BLOCK') return 'ESCALATE';
      return decision;

    case 'enforce':
    default:
      return decision;
  }
}

/**
 * Generates a human-readable summary of why a decision was made.
 */
export function explainDecision(event: PufferEvent): string {
  const parts: string[] = [];
  const blockingLayers = event.layers.filter((l) => l.verdict === 'block');
  const auditLayers = event.layers.filter((l) => l.verdict === 'audit');
  const escalateLayers = event.layers.filter((l) => l.verdict === 'escalate');

  if (blockingLayers.length > 0) {
    parts.push(`BLOCKED by: ${blockingLayers.map(formatLayer).join(', ')}`);
  }
  if (escalateLayers.length > 0) {
    parts.push(`ESCALATED by: ${escalateLayers.map(formatLayer).join(', ')}`);
  }
  if (auditLayers.length > 0) {
    parts.push(`Audited by: ${auditLayers.map(formatLayer).join(', ')}`);
  }

  if (parts.length === 0) {
    parts.push('All 7 layers passed — ALLOW');
  }

  const totalMs = event.layers.reduce((sum, l) => sum + l.durationMs, 0);
  parts.push(`Total pipeline time: ${totalMs}ms`);

  return parts.join(' | ');
}

function formatLayer(layer: LayerResult): string {
  return `L${layer.layer} ${layer.name} (${(layer.confidence * 100).toFixed(0)}%: ${layer.details})`;
}
