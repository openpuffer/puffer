import { LayerResult, Verdict, PufferEvent, Finding } from '../types.js';

export function allowResult(layer: number, name: string): LayerResult {
  return {
    layer,
    name,
    verdict: 'allow',
    confidence: 1.0,
    details: 'Not applicable to this event type',
    findings: [],
    durationMs: 0,
  };
}

export function blockResult(layer: number, name: string, details: string, findings: Finding[]): LayerResult {
  return {
    layer,
    name,
    verdict: 'block',
    confidence: 1.0,
    details,
    findings,
    durationMs: 0,
  };
}

export function extractTextFromEvent(event: PufferEvent): string {
  const parts: string[] = [];

  if (event.action.type === 'llm_request') {
    parts.push(JSON.stringify(event.action.body));
  } else if (event.action.type === 'llm_response') {
    parts.push(JSON.stringify(event.action.body));
  } else if (event.action.type === 'command_execute') {
    parts.push(event.action.command);
    parts.push(event.action.args.join(' '));
  } else if (event.action.type === 'file_write' && event.action.content) {
    parts.push(event.action.content);
  } else if (event.action.type === 'mcp_tool_call') {
    parts.push(JSON.stringify(event.action.params));
  } else if (event.action.type === 'mcp_tool_result') {
    parts.push(JSON.stringify(event.action.result));
  } else if (event.action.type === 'network_request') {
    parts.push(event.action.url);
    if (event.action.body) parts.push(JSON.stringify(event.action.body));
  }

  return parts.join(' ');
}

export function getMaxSeverity(findings: Finding[]): string | null {
  const order = ['critical', 'high', 'medium', 'low'];
  for (const severity of order) {
    if (findings.some((f) => f.severity === severity)) return severity;
  }
  return null;
}

export function calculateEntropy(text: string): number {
  if (text.length === 0) return 0;
  const freq: Record<string, number> = {};
  for (const char of text) freq[char] = (freq[char] || 0) + 1;
  const len = text.length;
  return -Object.values(freq).reduce((sum, count) => {
    const p = count / len;
    return sum + p * Math.log2(p);
  }, 0);
}
