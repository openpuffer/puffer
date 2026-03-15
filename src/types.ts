// === CORE EVENT TYPE ===
// Every intercepted action becomes a PufferEvent
export interface PufferEvent {
  id: string;
  timestamp: string;
  source: EventSource;
  action: EventAction;
  payload: unknown;
  metadata: EventMetadata;
  layers: LayerResult[];
  decision: Decision | null;
}

export interface EventSource {
  type: 'proxy' | 'hook' | 'manual';
  agent: string;
  pid?: number;
  provider: string;
  model?: string;
}

export type EventAction =
  | { type: 'llm_request'; method: string; endpoint: string; body: unknown }
  | { type: 'llm_response'; status: number; body: unknown }
  | { type: 'command_execute'; command: string; args: string[] }
  | { type: 'file_read'; path: string }
  | { type: 'file_write'; path: string; content?: string }
  | { type: 'network_request'; url: string; method: string; body?: unknown }
  | { type: 'mcp_tool_call'; server: string; tool: string; params: unknown }
  | { type: 'mcp_tool_result'; server: string; tool: string; result: unknown }
  | { type: 'notification'; category: string; message: string }
  | { type: 'agent_activity_summary'; agent: string; summary: string; connections: number };

export interface RateLimitInfo {
  limitTokens?: number;
  limitRequests?: number;
  remainingTokens?: number;
  remainingRequests?: number;
}

export interface EventMetadata {
  sessionId: string;
  sequenceNumber: number;
  tokenEstimate?: number;
  costEstimate?: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  model?: string;
  rateLimits?: RateLimitInfo;
  /** Captured when agent is "unknown" — raw headers and request info for debugging */
  debugInfo?: {
    userAgent?: string;
    headers?: Record<string, string>;
    method?: string;
    endpoint?: string;
  };
}

// === LAYER TYPES ===
export type Verdict = 'allow' | 'block' | 'audit' | 'escalate';

export interface LayerResult {
  layer: number;
  name: string;
  verdict: Verdict;
  confidence: number;
  details: string;
  findings: Finding[];
  durationMs: number;
}

export interface Finding {
  type: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  location: string;
  value?: string;
  suggestion?: string;
}

// === DECISION ===
export type Decision = 'ALLOW' | 'BLOCK' | 'AUDIT' | 'ESCALATE';

// === LAYER FUNCTION SIGNATURE ===
export type LayerFunction = (event: PufferEvent, config: unknown) => Promise<LayerResult>;

// === PROVIDER CONFIG ===
export interface ProviderConfig {
  name: string;
  targetUrl: string;
  proxyPort: number;
  apiFormat: 'openai' | 'anthropic' | 'ollama' | 'generic';
  isLocal: boolean;
  detected: boolean;
  status: 'active' | 'inactive' | 'error';
}

// === DISCOVERED AGENT ===
export interface DiscoveredAgent {
  name: string;
  pid: number;
  command: string;
  detectedVia: 'process' | 'port' | 'network';
  provider?: string;
  port?: number;
  ppid?: number;
  hostProgram?: string;
  protectionStatus: 'protected' | 'unprotected' | 'partial';
}

// === DISCOVERY RESULT ===
export interface DiscoveryResult {
  agents: DiscoveredAgent[];
  providers: ProviderConfig[];
  securityWarnings: string[];
  newSinceLastScan: DiscoveredAgent[];
  removedSinceLastScan: DiscoveredAgent[];
}

// === PORT SCAN RESULT ===
export interface PortScanResult {
  agent: DiscoveredAgent;
  provider: ProviderConfig;
  securityWarnings: string[];
}

// === PROVIDER ADAPTER ===
export interface Message {
  role: string;
  content: string | unknown[];
}

export interface ToolCall {
  name: string;
  arguments: unknown;
}

export interface ProviderAdapter {
  name: string;
  extractMessages(body: unknown): Message[];
  extractModel(body: unknown, url: string): string;
  extractSystemPrompt(body: unknown): string | null;
  extractToolCalls(body: unknown): ToolCall[];
  estimateTokens(body: unknown): number;
  estimateCost(body: unknown): number;
  formatBlockResponse(reason: string): unknown;
}

// === CONFIGURATION ===
export interface PufferConfig {
  version: string;
  mode: 'monitor' | 'enforce' | 'paranoid' | 'interactive';
  providers: ProviderConfig[];
  autoDiscovery: {
    enabled: boolean;
    scanIntervalMs: number;
    processScanner: boolean;
    portScanner: boolean;
    networkScanner: boolean;
  };
  layers: {
    pii: PIIConfig;
    injection: InjectionConfig;
    commands: CommandsConfig;
    network: NetworkConfig;
    filesystem: FilesystemConfig;
    behavior: BehaviorConfig;
    mcp: MCPConfig;
  };
  dashboard: {
    enabled: boolean;
    port: number;
  };
  audit: {
    logPath: string;
    retentionDays: number;
  };
  alerts: {
    webhook?: string;
    desktop: boolean;
  };
  cloud?: {
    enabled: boolean;
    url: string;
    apiKey: string;
    batchSize?: number;
    flushIntervalMs?: number;
  };
}

// === PII PATTERN ===
export interface PIIPattern {
  name: string;
  pattern: RegExp;
  severity: 'critical' | 'high' | 'medium' | 'low';
  region: string;
  validate?: (match: string) => boolean;
}

// === LAYER-SPECIFIC CONFIGS ===
export interface PIIConfig {
  enabled: boolean;
  regions: string[];
  actionBySeverity: Record<string, Verdict>;
  customPatterns: { name: string; pattern: string; severity: string }[];
  excludeContexts: string[];
}

export interface InjectionConfig {
  enabled: boolean;
  mode: 'heuristic' | 'model' | 'hybrid';
  thresholds: {
    directInput: { block: number; audit: number };
    externalContent: { block: number; audit: number };
  };
  heuristics: string[];
}

export interface CommandsConfig {
  enabled: boolean;
  blockedPatterns: string[];
  requireApproval: string[];
  maxCommandsPerMinute: number;
  consecutiveBlockThreshold: number;
}

export interface NetworkConfig {
  enabled: boolean;
  mode: 'whitelist' | 'blacklist';
  allowedDomains: string[];
  blockedDomains: string[];
  blockPrivateIPs: boolean;
  maxPayloadSizeMb: number;
  scanPayloadForPII: boolean;
}

export interface FilesystemConfig {
  enabled: boolean;
  forbidden: string[];
  restricted: string[];
  workspace: string[];
  secretPatterns: string[];
}

export interface BehaviorConfig {
  enabled: boolean;
  maxCostPerSessionUsd: number;
  maxCostPerHourUsd: number;
  loopDetection: {
    windowSize: number;
    similarityThreshold: number;
    consecutiveMatches: number;
  };
  sensitivity: 'low' | 'medium' | 'high';
}

export interface MCPConfig {
  enabled: boolean;
  authorizedServers: { url: string; allowedTools: string[] }[];
  blockUnauthorized: boolean;
  scanToolResults: boolean;
}

export interface OllamaConfig {
  blockedModels: string[];
  allowedModels: string[];
}

// === AUDIT LOG ENTRY ===
export interface AuditLogEntry {
  id: string;
  timestamp: string;
  source: EventSource;
  action: { type: string; [key: string]: unknown };
  decision: Decision;
  layers: Pick<LayerResult, 'layer' | 'name' | 'verdict' | 'confidence' | 'details' | 'durationMs'>[];
  metadata: EventMetadata;
}

// === DASHBOARD STATS ===
export interface DashboardStats {
  totalEvents: number;
  blockedEvents: number;
  allowedEvents: number;
  auditEvents: number;
  escalatedEvents: number;
  activeAgents: number;
  totalCost: number;
  eventsPerMinute: number;
}
