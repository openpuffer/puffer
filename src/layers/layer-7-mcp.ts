import { PufferEvent, LayerResult, Finding, MCPConfig } from '../types.js';
import { allowResult } from './helpers.js';

const INJECTION_PATTERNS: RegExp[] = [
  /(?:you are now|act as|pretend to be|forget (?:your|all|previous)|ignore (?:previous|above|all)|disregard (?:your|all|previous)|override (?:your|all)|new instructions?:)/gi,
  /(?:\[INST\]|\[\/INST\]|<\|system\|>|<\|user\|>|<\|assistant\|>|###\s*(?:system|instruction|human|assistant)|<\/?(?:system|instruction)>)/gi,
  /(?:send (?:all|this|the) (?:data|info|content|text|conversation|history) to|forward (?:everything|all|this) to|(?:curl|wget|fetch|post)\s+https?:\/\/)/gi,
  /(?:(?:call|invoke|use|execute|run)\s+(?:the\s+)?(?:tool|function|bash|shell|terminal|command)|execute\s+(?:system|shell)\s+command)/gi,
];

function scanForInjection(text: string): string[] {
  const matches: string[] = [];
  for (const pattern of INJECTION_PATTERNS) {
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
      if (injectionMatches.length > 0) {
        findings.push({
          type: 'injection_in_result',
          severity: 'critical',
          location: `${event.action.server}/${event.action.tool}`,
          value: injectionMatches[0].slice(0, 100),
          suggestion: `MCP tool result contains injection pattern: ${injectionMatches[0].slice(0, 50)}`,
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
