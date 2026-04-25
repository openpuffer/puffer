import type { PufferEvent, LayerResult, Finding, MCPConfig } from '@puffer/core';
import { allowResult } from './helpers.js';
import { HEURISTICS } from './layer-2-injection.js';

// Reuse injection heuristics from Layer 2 for MCP tool result scanning
const MCP_INJECTION_PATTERNS: RegExp[] = HEURISTICS.filter((h) =>
  ['role_switching', 'system_delimiters', 'data_exfil_instruction', 'tool_abuse'].includes(h.name),
).map((h) => h.pattern);

function scanForInjection(text: string): string[] {
  const matches: string[] = [];
  for (const pattern of MCP_INJECTION_PATTERNS) {
    const regex = new RegExp(pattern.source, pattern.flags);
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      matches.push(match[0]);
    }
  }
  return matches;
}

export async function mcpPoisoningDetector(
  event: PufferEvent,
  config: MCPConfig,
): Promise<LayerResult> {
  const start = Date.now();

  if (event.action.type !== 'mcp_tool_call' && event.action.type !== 'mcp_tool_result') {
    return allowResult(7, 'mcp_detector');
  }

  const findings: Finding[] = [];

  if (event.action.type === 'mcp_tool_call') {
    const { server, tool } = event.action;

    if (config.blockUnauthorized) {
      const authorizedServer = config.authorizedServers.find((s) => s.url === server);

      if (!authorizedServer) {
        findings.push({
          type: 'unauthorized_server',
          severity: 'critical',
          location: server,
          value: server,
          suggestion: `MCP server ${server} is not in the authorized list`,
        });
      } else if (!authorizedServer.allowedTools.includes(tool)) {
        findings.push({
          type: 'unauthorized_tool',
          severity: 'high',
          location: `${server}/${tool}`,
          value: tool,
          suggestion: `Tool ${tool} is not in the allowed list for server ${server}`,
        });
      }
    }
  }

  if (event.action.type === 'mcp_tool_result') {
    if (config.scanToolResults) {
      const resultText =
        typeof event.action.result === 'string'
          ? event.action.result
          : JSON.stringify(event.action.result);

      const injectionMatches = scanForInjection(resultText);
      const firstMatch = injectionMatches[0];
      if (firstMatch !== undefined) {
        findings.push({
          type: 'injection_in_result',
          severity: 'critical',
          location: `${event.action.server}/${event.action.tool}`,
          value: firstMatch.slice(0, 100),
          suggestion: `MCP tool result contains injection pattern: ${firstMatch.slice(0, 50)}`,
        });
      }
    }
  }

  const durationMs = Date.now() - start;

  if (findings.length === 0) {
    return {
      layer: 7,
      name: 'mcp_detector',
      verdict: 'allow',
      confidence: 1.0,
      details: 'MCP operation authorized',
      findings: [],
      durationMs,
    };
  }

  const hasCritical = findings.some((f) => f.severity === 'critical');

  return {
    layer: 7,
    name: 'mcp_detector',
    verdict: hasCritical ? 'block' : 'escalate',
    confidence: hasCritical ? 1.0 : 0.9,
    details: `MCP check: ${findings.length} finding(s)`,
    findings,
    durationMs,
  };
}
