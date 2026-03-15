import { PufferEvent, PufferConfig } from '../../src/types.js';

export function makeLLMRequestEvent(body: unknown, sessionId = 'adv-sess-1'): PufferEvent {
  return {
    id: 'adv-test-1',
    timestamp: new Date().toISOString(),
    source: { type: 'proxy', agent: 'test-agent', provider: 'openai' },
    action: { type: 'llm_request', method: 'POST', endpoint: '/v1/chat/completions', body },
    metadata: { sessionId, sequenceNumber: 1 },
    layers: [],
    decision: null,
  };
}

export function makeLLMResponseEvent(body: unknown, sessionId = 'adv-sess-1'): PufferEvent {
  return {
    id: 'adv-test-resp-1',
    timestamp: new Date().toISOString(),
    source: { type: 'proxy', agent: 'test-agent', provider: 'openai' },
    action: { type: 'llm_response', status: 200, body },
    metadata: { sessionId, sequenceNumber: 2 },
    layers: [],
    decision: null,
  };
}

export function makeCommandEvent(command: string, args: string[] = [], sessionId = 'adv-sess-1'): PufferEvent {
  return {
    id: 'adv-test-cmd-1',
    timestamp: new Date().toISOString(),
    source: { type: 'proxy', agent: 'test-agent', provider: 'openai' },
    action: { type: 'command_execute', command, args },
    metadata: { sessionId, sequenceNumber: 1 },
    layers: [],
    decision: null,
  };
}

export function makeNetworkEvent(url: string, method = 'GET', body?: unknown): PufferEvent {
  return {
    id: 'adv-test-net-1',
    timestamp: new Date().toISOString(),
    source: { type: 'proxy', agent: 'test-agent', provider: 'openai' },
    action: { type: 'network_request', url, method, body },
    metadata: { sessionId: 'adv-sess-1', sequenceNumber: 1 },
    layers: [],
    decision: null,
  };
}

export function makeFileEvent(
  path: string,
  type: 'file_read' | 'file_write' = 'file_read',
  content?: string,
): PufferEvent {
  const action = type === 'file_write'
    ? { type: 'file_write' as const, path, content }
    : { type: 'file_read' as const, path };

  return {
    id: 'adv-test-fs-1',
    timestamp: new Date().toISOString(),
    source: { type: 'proxy', agent: 'test-agent', provider: 'openai' },
    action,
    metadata: { sessionId: 'adv-sess-1', sequenceNumber: 1 },
    layers: [],
    decision: null,
  };
}

export function makeMCPToolCallEvent(server: string, tool: string, params: unknown = {}): PufferEvent {
  return {
    id: 'adv-test-mcp-1',
    timestamp: new Date().toISOString(),
    source: { type: 'proxy', agent: 'test-agent', provider: 'openai' },
    action: { type: 'mcp_tool_call', server, tool, params },
    metadata: { sessionId: 'adv-sess-1', sequenceNumber: 1 },
    layers: [],
    decision: null,
  };
}

export function makeMCPToolResultEvent(server: string, tool: string, result: unknown): PufferEvent {
  return {
    id: 'adv-test-mcp-res-1',
    timestamp: new Date().toISOString(),
    source: { type: 'proxy', agent: 'test-agent', provider: 'openai' },
    action: { type: 'mcp_tool_result', server, tool, result },
    metadata: { sessionId: 'adv-sess-1', sequenceNumber: 1 },
    layers: [],
    decision: null,
  };
}

export const DEFAULT_INJECTION_CONFIG = {
  enabled: true,
  mode: 'heuristic' as const,
  thresholds: {
    directInput: { block: 0.65, audit: 0.3 },
    externalContent: { block: 0.5, audit: 0.25 },
  },
  heuristics: [],
};

export const DEFAULT_PII_CONFIG = {
  enabled: true,
  regions: ['us', 'global', 'mx', 'eu'] as string[],
  actionBySeverity: {
    critical: 'block' as const,
    high: 'escalate' as const,
    medium: 'audit' as const,
    low: 'allow' as const,
  },
  customPatterns: [],
  excludeContexts: [],
};

export const DEFAULT_NETWORK_CONFIG = {
  enabled: true,
  mode: 'blacklist' as const,
  allowedDomains: [] as string[],
  blockedDomains: [] as string[],
  blockPrivateIPs: true,
  maxPayloadSizeMb: 50,
  scanPayloadForPII: true,
};

export const DEFAULT_FILESYSTEM_CONFIG = {
  enabled: true,
  forbidden: ['~/.ssh/', '~/.gnupg/', '~/.aws/', '/etc/shadow', '/etc/sudoers'],
  restricted: ['~/.config/', '/etc/', '~/.env'],
  workspace: ['/home/user/project', '/tmp/puffer'],
  secretPatterns: [
    'AKIA[A-Z0-9]{16}',
    'sk-[a-zA-Z0-9]{20,}',
    '-----BEGIN.*PRIVATE KEY-----',
    'ghp_[a-zA-Z0-9]{36}',
    'sk-ant-[a-zA-Z0-9-]{20,}',
  ],
};

export const DEFAULT_COMMANDS_CONFIG = {
  enabled: true,
  blockedPatterns: [
    'rm\\s+(-[rRf]+\\s+)*\\/',
    ':(\\)\\s*\\{\\s*:|\\:&\\s*\\})',
    'curl.*\\|.*sh',
    'wget.*\\|.*sh',
  ],
  requireApproval: ['npm publish', 'git push.*main', 'git push.*master'],
  maxCommandsPerMinute: 60,
  consecutiveBlockThreshold: 3,
};

export const DEFAULT_BEHAVIOR_CONFIG = {
  enabled: true,
  maxCostPerSessionUsd: 10,
  maxCostPerHourUsd: 20,
  loopDetection: {
    windowSize: 20,
    similarityThreshold: 0.85,
    consecutiveMatches: 5,
  },
  sensitivity: 'medium' as const,
};

export const DEFAULT_MCP_CONFIG = {
  enabled: true,
  authorizedServers: [
    { url: 'https://mcp.trusted.com', allowedTools: ['search', 'read'] },
  ],
  blockUnauthorized: true,
  scanToolResults: true,
};
