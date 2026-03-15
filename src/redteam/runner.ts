import { createDefaultPipeline } from '../layers/index.js';
import { makeDecision } from '../engine/decision.js';
import type { PufferConfig, PufferEvent } from '../types.js';
import { SCENARIOS, type Scenario } from './scenarios.js';
import chalk from 'chalk';

export interface RedTeamResult {
  total: number;
  passed: number;
  failed: number;
  vulnerabilities: Array<{
    scenario: Scenario;
    expected: string;
    actual: string;
    details: string;
  }>;
  score: number; // 0-100
}

function buildEvent(scenario: Scenario): PufferEvent {
  let action: PufferEvent['action'];

  switch (scenario.eventType) {
    case 'llm_request':
      action = { type: 'llm_request', method: 'POST', endpoint: '/v1/messages', body: scenario.payload };
      break;
    case 'command_execute':
      action = { type: 'command_execute', command: scenario.payload.command as string, args: scenario.payload.args as string[] };
      break;
    case 'file_read':
      action = { type: 'file_read', path: scenario.payload.path as string };
      break;
    case 'file_write':
      action = { type: 'file_write', path: scenario.payload.path as string, content: scenario.payload.content as string };
      break;
    case 'network_request':
      action = { type: 'network_request', url: scenario.payload.url as string, method: scenario.payload.method as string };
      break;
    case 'mcp_tool_call':
      action = { type: 'mcp_tool_call', server: scenario.payload.server as string, tool: scenario.payload.tool as string, params: scenario.payload.params };
      break;
    case 'mcp_tool_result':
      action = { type: 'mcp_tool_result', server: scenario.payload.server as string, tool: scenario.payload.tool as string, result: scenario.payload.result };
      break;
  }

  return {
    id: `rt-${scenario.id}`,
    timestamp: new Date().toISOString(),
    source: { type: 'hook', agent: 'redteam', provider: 'test' },
    action,
    payload: null,
    metadata: { sessionId: `redteam-${Date.now()}`, sequenceNumber: 1 },
    layers: [],
    decision: null,
  };
}

export async function runRedTeam(config: PufferConfig): Promise<RedTeamResult> {
  // Always test in enforce mode — red team evaluates your RULES, not your mode
  const testConfig = { ...config, mode: 'enforce' as const };
  const pipeline = createDefaultPipeline(testConfig);
  const vulnerabilities: RedTeamResult['vulnerabilities'] = [];
  let passed = 0;

  for (const scenario of SCENARIOS) {
    const event = buildEvent(scenario);
    const evaluated = await pipeline.evaluate(event);
    evaluated.decision = makeDecision(evaluated, { mode: 'enforce' });

    const wasBlocked = evaluated.decision === 'BLOCK' || evaluated.decision === 'ESCALATE';

    if (scenario.expectedBlock && !wasBlocked) {
      // Attack should have been blocked but wasn't
      vulnerabilities.push({
        scenario,
        expected: 'BLOCK',
        actual: evaluated.decision ?? 'ALLOW',
        details: 'Attack was not detected — your configuration may be too permissive',
      });
    } else if (!scenario.expectedBlock && wasBlocked) {
      // Safe operation was blocked
      const blockingLayer = evaluated.layers.find(l => l.verdict === 'block');
      vulnerabilities.push({
        scenario,
        expected: 'ALLOW',
        actual: evaluated.decision ?? 'BLOCK',
        details: `False positive by ${blockingLayer?.name ?? 'unknown layer'}: ${blockingLayer?.details ?? ''}`,
      });
    } else {
      passed++;
    }
  }

  return {
    total: SCENARIOS.length,
    passed,
    failed: vulnerabilities.length,
    vulnerabilities,
    score: Math.round((passed / SCENARIOS.length) * 100),
  };
}

export function formatRedTeamReport(result: RedTeamResult): string {
  const lines: string[] = [];

  lines.push('');
  const scoreColor = result.score >= 80 ? chalk.green : result.score >= 60 ? chalk.yellow : chalk.red;
  lines.push(scoreColor.bold(`  🐡 RED TEAM REPORT: ${result.passed}/${result.total} attacks handled correctly (${result.score}%)`));
  lines.push('');

  if (result.vulnerabilities.length === 0) {
    lines.push(chalk.green.bold('  ✓ No vulnerabilities found! Your configuration is solid.'));
  } else {
    lines.push(chalk.red.bold(`  ✗ ${result.vulnerabilities.length} vulnerability(ies) found:\n`));

    for (const vuln of result.vulnerabilities) {
      const severityColor = vuln.scenario.severity === 'critical' ? chalk.red :
        vuln.scenario.severity === 'high' ? chalk.yellow : chalk.blue;

      lines.push(`  ${severityColor(`[${vuln.scenario.severity.toUpperCase()}]`)} ${chalk.white(vuln.scenario.name)}`);
      lines.push(chalk.gray(`    ${vuln.scenario.description}`));
      lines.push(chalk.gray(`    Expected: ${vuln.expected} → Got: ${vuln.actual}`));
      lines.push(chalk.yellow(`    Fix: ${vuln.details}`));
      lines.push('');
    }
  }

  return lines.join('\n');
}
