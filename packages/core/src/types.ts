// === CORE EVENT TYPE ===
// Every intercepted action becomes a PufferEvent
export interface PufferEvent {
  id: string;
  timestamp: string;
  source: EventSource;
  action: EventAction;
  /** Original request body or arbitrary side-channel data. Optional because
   * many call sites construct events from `action` alone. */
  payload?: unknown;
  metadata: EventMetadata;
  layers: LayerResult[];
  decision: Decision | null;
}

export interface EventSource {
  type: 'proxy' | 'hook' | 'manual';
  agent: string;
  pid?: number | undefined;
  provider: string;
  model?: string | undefined;
}

export type EventAction =
  | { type: 'llm_request'; method: string; endpoint: string; body: unknown }
  | { type: 'llm_response'; status: number; body: unknown }
  | { type: 'command_execute'; command: string; args: string[] }
  | { type: 'file_read'; path: string }
  | { type: 'file_write'; path: string; content?: string | undefined }
  | { type: 'network_request'; url: string; method: string; body?: unknown }
  | { type: 'mcp_tool_call'; server: string; tool: string; params: unknown }
  | { type: 'mcp_tool_result'; server: string; tool: string; result: unknown }
  | { type: 'notification'; category: string; message: string }
  | { type: 'agent_activity_summary'; agent: string; summary: string; connections: number }
  | {
      type: 'skill_invoke';
      skill: { id: string; name: string; contentHash?: string | undefined };
      args?: Record<string, unknown> | undefined;
    }
  | { type: 'skill_added'; skill: SkillManifest }
  | { type: 'skill_modified'; skill: SkillManifest; previousHash?: string | undefined }
  | { type: 'skill_removed'; skill: SkillManifest };

export interface RateLimitInfo {
  limitTokens?: number | undefined;
  limitRequests?: number | undefined;
  remainingTokens?: number | undefined;
  remainingRequests?: number | undefined;
}

export interface EventMetadata {
  sessionId: string;
  sequenceNumber: number;
  tokenEstimate?: number | undefined;
  costEstimate?: number | undefined;
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
  totalTokens?: number | undefined;
  model?: string | undefined;
  rateLimits?: RateLimitInfo | undefined;
  /** Captured when agent is "unknown" — raw headers and request info for debugging */
  debugInfo?:
    | {
        userAgent?: string | undefined;
        headers?: Record<string, string> | undefined;
        method?: string | undefined;
        endpoint?: string | undefined;
      }
    | undefined;
  /** Short human-readable preview of the request/response body. Max 150 chars.
   *  Extracted at proxy time; safe to broadcast (no auth headers, no debugInfo). */
  snippet?:
    | {
        text: string;
        originalLength: number;
      }
    | undefined;
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
  value?: string | undefined;
  suggestion?: string | undefined;
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
  provider?: string | undefined;
  port?: number | undefined;
  ppid?: number | undefined;
  hostProgram?: string | undefined;
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
    skills: SkillsConfig;
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
    webhook?: string | undefined;
    desktop: boolean;
  };
  cloud?:
    | {
        enabled: boolean;
        url: string;
        apiKey: string;
        batchSize?: number | undefined;
        flushIntervalMs?: number | undefined;
      }
    | undefined;
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
  blockPrivateIps: boolean;
  maxPayloadSizeMb: number;
  scanPayloadForPii: boolean;
  /** Pattern set used by the PII payload scan. Injected by the pipeline
   * factory so the network layer doesn't import the PII layer directly —
   * keeps the L4↔L1 boundary clean. Empty/missing means "no scanning". */
  piiPatterns?: PIIPattern[] | undefined;
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

export interface SkillsConfig {
  enabled: boolean;
  /** 'monitor' = log but don't block; 'enforce' = block on deny/not-in-allowlist */
  policy: 'monitor' | 'enforce';
  /** If non-empty, only these names/ids/hashes are permitted. Others blocked. */
  allowlist: string[];
  /** Always denied; checked before allowlist. */
  denylist: string[];
  /** How often to re-scan disk for skill changes (ms). Default: 30000. */
  scan_interval_ms: number;
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
  layers: Pick<
    LayerResult,
    'layer' | 'name' | 'verdict' | 'confidence' | 'details' | 'durationMs'
  >[];
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

// === SKILL GOVERNANCE TYPES ===

/** Logical category that identifies where a skill originates. */
export type SkillSource =
  | 'claude-code-global'
  | 'claude-code-project'
  | 'openclaw-bundled'
  | 'openclaw-user'
  | 'unknown';

export interface SkillManifest {
  /** Stable identifier: "<source>/<name>". Example: "claude-code-global/simplify". */
  id: string;
  /** Skill name as derived from directory or frontmatter. */
  name: string;
  /** Where this skill lives (logical category). */
  source: SkillSource;
  /** Absolute path to the skill's root directory. */
  rootPath: string;
  /** Path to the manifest file (SKILL.md) if present. */
  manifestPath: string | null;
  /** Free-text description from frontmatter or first paragraph. May be empty string. */
  description: string;
  /** sha256 of the concatenated content of all files in the skill directory (sorted by relative path). 64 hex chars. */
  contentHash: string;
  /** ISO timestamp of the most recent mtime among the skill's files. */
  lastModified: string;
  /** Total size in bytes of all files in the skill (large files excluded). */
  sizeBytes: number;
  /** Number of files in the skill directory (recursive), including large files that are skipped from hashing. */
  fileCount: number;
}

export interface SkillInventory {
  /** ISO timestamp the scan was performed. */
  scannedAt: string;
  /** All skills discovered in this scan. */
  skills: SkillManifest[];
  /** Roots actually scanned (with whether they existed). */
  roots: { path: string; source: SkillSource; existed: boolean }[];
}

export interface SkillChangeEvent {
  type: 'skill_added' | 'skill_modified' | 'skill_removed';
  skill: SkillManifest;
  /** For 'skill_modified', the previous content hash. */
  previousHash?: string | undefined;
}
