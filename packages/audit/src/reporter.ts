import type { AuditLogger } from './logger.js';
import chalk from 'chalk';

export interface AuditReport {
  period: string;
  totalEvents: number;
  decisions: Record<string, number>;
  topLayers: { name: string; blocks: number }[];
  topAgents: { name: string; events: number }[];
  estimatedCost: number;
}

export function generateReport(auditLogger: AuditLogger, lastN = 1000): AuditReport {
  const entries = auditLogger.readEntries(lastN);

  const decisions: Record<string, number> = { ALLOW: 0, BLOCK: 0, AUDIT: 0, ESCALATE: 0 };
  const layerBlocks = new Map<string, number>();
  const agentEvents = new Map<string, number>();
  let totalCost = 0;

  for (const entry of entries) {
    decisions[entry.decision] = (decisions[entry.decision] || 0) + 1;

    // Count blocks per layer
    for (const layer of entry.layers) {
      if (layer.verdict === 'block') {
        layerBlocks.set(layer.name, (layerBlocks.get(layer.name) || 0) + 1);
      }
    }

    // Count events per agent
    const agent = entry.source.agent;
    agentEvents.set(agent, (agentEvents.get(agent) || 0) + 1);

    // Sum cost
    if (entry.metadata.costEstimate) {
      totalCost += entry.metadata.costEstimate;
    }
  }

  const topLayers = [...layerBlocks.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, blocks]) => ({ name, blocks }));

  const topAgents = [...agentEvents.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, events]) => ({ name, events }));

  const firstTimestamp = entries[entries.length - 1]?.timestamp ?? 'N/A';
  const lastTimestamp = entries[0]?.timestamp ?? 'N/A';

  return {
    period: `${firstTimestamp} — ${lastTimestamp}`,
    totalEvents: entries.length,
    decisions,
    topLayers,
    topAgents,
    estimatedCost: totalCost,
  };
}

export function formatReport(report: AuditReport): string {
  const lines: string[] = [];

  lines.push(chalk.cyan('\n  PUFFER AUDIT REPORT'));
  lines.push(chalk.gray(`  Period: ${report.period}`));
  lines.push(chalk.gray(`  Total events: ${report.totalEvents}`));
  lines.push('');

  lines.push('  Decisions:');
  lines.push(`    ${chalk.green(`ALLOW: ${report.decisions.ALLOW || 0}`)}`);
  lines.push(`    ${chalk.red(`BLOCK: ${report.decisions.BLOCK || 0}`)}`);
  lines.push(`    ${chalk.yellow(`AUDIT: ${report.decisions.AUDIT || 0}`)}`);
  lines.push(`    ${chalk.magenta(`ESCALATE: ${report.decisions.ESCALATE || 0}`)}`);
  lines.push('');

  if (report.topLayers.length > 0) {
    lines.push('  Top blocking layers:');
    for (const layer of report.topLayers) {
      lines.push(`    ${layer.name}: ${layer.blocks} blocks`);
    }
    lines.push('');
  }

  if (report.topAgents.length > 0) {
    lines.push('  Top agents:');
    for (const agent of report.topAgents) {
      lines.push(`    ${agent.name}: ${agent.events} events`);
    }
    lines.push('');
  }

  lines.push(`  Estimated cost: $${report.estimatedCost.toFixed(2)}`);

  return lines.join('\n');
}
