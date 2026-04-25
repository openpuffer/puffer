import type { AuditLogger } from '@puffer/audit';

export interface WeeklyReport {
  period: { start: string; end: string };
  score: { current: number; grade: string };
  summary: {
    totalEvents: number;
    threatsBlocked: number;
    piiLeaks: number;
    injectionAttempts: number;
    dangerousCommands: number;
    networkViolations: number;
    totalCost: number;
    totalTokens: number;
  };
  topAgents: Array<{ name: string; events: number; blocked: number }>;
  topThreats: Array<{ layer: string; count: number }>;
  timeline: Array<{ day: string; events: number; blocked: number }>;
}

export function generateWeeklyReport(
  auditLogger: AuditLogger,
  score?: { current: number; grade: string },
): WeeklyReport {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  // Read all recent entries (up to 10k)
  const allEntries = auditLogger.readEntries(10000);
  const entries = allEntries.filter((e) => new Date(e.timestamp) >= weekAgo);

  // Summary counts
  let piiLeaks = 0;
  let injectionAttempts = 0;
  let dangerousCommands = 0;
  let networkViolations = 0;
  let totalCost = 0;
  let totalTokens = 0;
  const blocked = entries.filter((e) => e.decision === 'BLOCK').length;

  // Per-agent tracking
  const agentMap = new Map<string, { events: number; blocked: number }>();

  // Per-layer block tracking
  const layerBlocks = new Map<string, number>();

  // Per-day timeline
  const dayMap = new Map<string, { events: number; blocked: number }>();

  for (const entry of entries) {
    // Agent stats
    const agent = entry.source.agent;
    const agentData = agentMap.get(agent) ?? { events: 0, blocked: 0 };
    agentData.events++;
    if (entry.decision === 'BLOCK') agentData.blocked++;
    agentMap.set(agent, agentData);

    // Layer stats
    for (const layer of entry.layers) {
      if (layer.verdict === 'block') {
        layerBlocks.set(layer.name, (layerBlocks.get(layer.name) ?? 0) + 1);
        if (layer.name === 'pii-scanner') piiLeaks++;
        if (layer.name === 'injection-detector') injectionAttempts++;
        if (layer.name === 'command-analyzer') dangerousCommands++;
        if (layer.name === 'network-guard') networkViolations++;
      }
    }

    // Cost/tokens
    if (entry.metadata.costEstimate) totalCost += entry.metadata.costEstimate;
    if (entry.metadata.totalTokens) totalTokens += entry.metadata.totalTokens;

    // Timeline
    const day = new Date(entry.timestamp).toISOString().split('T')[0] ?? '';
    const dayData = dayMap.get(day) ?? { events: 0, blocked: 0 };
    dayData.events++;
    if (entry.decision === 'BLOCK') dayData.blocked++;
    dayMap.set(day, dayData);
  }

  return {
    period: {
      start: weekAgo.toISOString().split('T')[0] ?? '',
      end: now.toISOString().split('T')[0] ?? '',
    },
    score: score ?? { current: 0, grade: 'N/A' },
    summary: {
      totalEvents: entries.length,
      threatsBlocked: blocked,
      piiLeaks,
      injectionAttempts,
      dangerousCommands,
      networkViolations,
      totalCost,
      totalTokens,
    },
    topAgents: [...agentMap.entries()]
      .sort((a, b) => b[1].events - a[1].events)
      .slice(0, 5)
      .map(([name, data]) => ({ name, ...data })),
    topThreats: [...layerBlocks.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([layer, count]) => ({ layer, count })),
    timeline: [...dayMap.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([day, data]) => ({ day, ...data })),
  };
}

export function formatWeeklyMarkdown(report: WeeklyReport): string {
  const lines: string[] = [];

  lines.push(`# 🐡 Puffer Weekly Report`);
  lines.push(`**Period:** ${report.period.start} — ${report.period.end}`);
  lines.push(`**Puffer Score:** ${report.score.current}/100 (${report.score.grade})`);
  lines.push('');

  lines.push('## Summary');
  lines.push(`- **${report.summary.totalEvents}** events scanned`);
  lines.push(`- **${report.summary.threatsBlocked}** threats blocked`);
  if (report.summary.piiLeaks > 0)
    lines.push(`  - ${report.summary.piiLeaks} PII leak(s) prevented`);
  if (report.summary.injectionAttempts > 0)
    lines.push(`  - ${report.summary.injectionAttempts} injection attempt(s) blocked`);
  if (report.summary.dangerousCommands > 0)
    lines.push(`  - ${report.summary.dangerousCommands} dangerous command(s) stopped`);
  if (report.summary.networkViolations > 0)
    lines.push(`  - ${report.summary.networkViolations} network violation(s) caught`);
  lines.push(`- **$${report.summary.totalCost.toFixed(2)}** in AI costs tracked`);
  if (report.summary.totalTokens > 0) {
    lines.push(`- **${(report.summary.totalTokens / 1000).toFixed(1)}K** tokens processed`);
  }
  lines.push('');

  if (report.topAgents.length > 0) {
    lines.push('## Agent Activity');
    lines.push('| Agent | Events | Blocked |');
    lines.push('|-------|--------|---------|');
    for (const agent of report.topAgents) {
      lines.push(`| ${agent.name} | ${agent.events} | ${agent.blocked} |`);
    }
    lines.push('');
  }

  if (report.topThreats.length > 0) {
    lines.push('## Top Threat Layers');
    for (const threat of report.topThreats) {
      lines.push(`- **${threat.layer}**: ${threat.count} block(s)`);
    }
    lines.push('');
  }

  if (report.timeline.length > 0) {
    lines.push('## Daily Activity');
    lines.push('| Date | Events | Blocked |');
    lines.push('|------|--------|---------|');
    for (const day of report.timeline) {
      const bar = '█'.repeat(Math.min(Math.ceil(day.events / 10), 20));
      lines.push(`| ${day.day} | ${day.events} ${bar} | ${day.blocked} |`);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push(
    '*Generated by [Puffer](https://github.com/puffer-fish/puffer) — The autonomous immune system for AI agents*',
  );

  return lines.join('\n');
}

export function formatWeeklyHTML(report: WeeklyReport): string {
  const md = formatWeeklyMarkdown(report);
  // Simple HTML wrapper with styling
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Puffer Weekly Report — ${report.period.start} to ${report.period.end}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 700px; margin: 40px auto; padding: 20px; background: #0a0a0a; color: #e0e0e0; }
  h1 { color: #f59e0b; border-bottom: 2px solid #333; padding-bottom: 10px; }
  h2 { color: #f59e0b; margin-top: 24px; }
  table { border-collapse: collapse; width: 100%; margin: 12px 0; }
  th, td { border: 1px solid #333; padding: 8px 12px; text-align: left; }
  th { background: #1a1a1a; color: #f59e0b; }
  tr:nth-child(even) { background: #111; }
  strong { color: #fbbf24; }
  ul { padding-left: 20px; }
  li { margin: 4px 0; }
  hr { border-color: #333; margin: 24px 0; }
  em { color: #666; }
</style>
</head>
<body>
${markdownToHTML(md)}
</body>
</html>`;
}

function markdownToHTML(md: string): string {
  return md
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^\| (.+) \|$/gm, (_, row) => {
      const cells = row.split(' | ').map((c: string) => c.trim());
      if (cells.every((c: string) => /^-+$/.test(c))) return '';
      const tag = cells.every((c: string) => /^[A-Z]/.test(c)) ? 'th' : 'td';
      return `<tr>${cells.map((c: string) => `<${tag}>${c}</${tag}>`).join('')}</tr>`;
    })
    .replace(/(<tr>.*<\/tr>\n?)+/g, '<table>$&</table>')
    .replace(/^- \*\*(.+?)\*\*:? (.*)$/gm, '<li><strong>$1</strong> $2</li>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^---$/gm, '<hr>')
    .replace(/\n\n/g, '\n');
}
