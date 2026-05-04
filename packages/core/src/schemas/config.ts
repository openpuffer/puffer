// Runtime validation for puffer config (~/.puffer/config.yaml).
//
// The schema MUST stay in sync with the `PufferConfig` interface in
// src/types.ts. We do not infer types from the schema (yet) because that
// would force every consumer of `PufferConfig` to import zod. Instead we
// assert structural compatibility with `satisfies` at the bottom of the
// file — if the interface drifts, TypeScript will complain.

import { z } from 'zod';
import type { PufferConfig } from '../types.js';

// -- Primitive enums --------------------------------------------------------

export const VerdictSchema = z.enum(['allow', 'block', 'audit', 'escalate']);
export const SeveritySchema = z.enum(['critical', 'high', 'medium', 'low']);
export const ModeSchema = z.enum(['monitor', 'enforce', 'paranoid', 'interactive']);
export const ApiFormatSchema = z.enum(['openai', 'anthropic', 'ollama', 'generic']);
export const ProviderStatusSchema = z.enum(['active', 'inactive', 'error']);
export const InjectionModeSchema = z.enum(['heuristic', 'model', 'hybrid']);
export const NetworkModeSchema = z.enum(['whitelist', 'blacklist']);
export const SensitivitySchema = z.enum(['low', 'medium', 'high']);

// -- Provider ---------------------------------------------------------------

export const ProviderConfigSchema = z.object({
  name: z.string().min(1),
  targetUrl: z.string().url(),
  proxyPort: z.number().int().min(0).max(65535),
  apiFormat: ApiFormatSchema,
  isLocal: z.boolean(),
  detected: z.boolean(),
  status: ProviderStatusSchema,
});

// -- Auto discovery ---------------------------------------------------------

export const AutoDiscoverySchema = z.object({
  enabled: z.boolean(),
  scanIntervalMs: z.number().int().positive(),
  processScanner: z.boolean(),
  portScanner: z.boolean(),
  networkScanner: z.boolean(),
});

// -- Layer configs ----------------------------------------------------------

export const PIIConfigSchema = z.object({
  enabled: z.boolean(),
  regions: z.array(z.string()),
  // We accept any string keys here (`critical`, `high`, ...) to match the
  // shape `Record<string, Verdict>` in src/types.ts. Severity coverage is
  // a runtime concern of layer-1-pii.ts, not the loader.
  actionBySeverity: z.record(z.string(), VerdictSchema),
  customPatterns: z.array(
    z.object({
      name: z.string(),
      pattern: z.string(),
      severity: z.string(),
    }),
  ),
  excludeContexts: z.array(z.string()),
});

export const InjectionConfigSchema = z.object({
  enabled: z.boolean(),
  mode: InjectionModeSchema,
  thresholds: z.object({
    directInput: z.object({
      block: z.number().min(0).max(1),
      audit: z.number().min(0).max(1),
    }),
    externalContent: z.object({
      block: z.number().min(0).max(1),
      audit: z.number().min(0).max(1),
    }),
  }),
  heuristics: z.array(z.string()),
});

export const CommandsConfigSchema = z.object({
  enabled: z.boolean(),
  blockedPatterns: z.array(z.string()),
  requireApproval: z.array(z.string()),
  maxCommandsPerMinute: z.number().int().nonnegative(),
  consecutiveBlockThreshold: z.number().int().nonnegative(),
});

export const NetworkConfigSchema = z.object({
  enabled: z.boolean(),
  mode: NetworkModeSchema,
  allowedDomains: z.array(z.string()),
  blockedDomains: z.array(z.string()),
  blockPrivateIps: z.boolean(),
  maxPayloadSizeMb: z.number().nonnegative(),
  scanPayloadForPii: z.boolean(),
});

export const FilesystemConfigSchema = z.object({
  enabled: z.boolean(),
  forbidden: z.array(z.string()),
  restricted: z.array(z.string()),
  workspace: z.array(z.string()),
  secretPatterns: z.array(z.string()),
});

export const BehaviorConfigSchema = z.object({
  enabled: z.boolean(),
  maxCostPerSessionUsd: z.number().nonnegative(),
  maxCostPerHourUsd: z.number().nonnegative(),
  loopDetection: z.object({
    windowSize: z.number().int().positive(),
    similarityThreshold: z.number().min(0).max(1),
    consecutiveMatches: z.number().int().positive(),
  }),
  sensitivity: SensitivitySchema,
});

export const MCPConfigSchema = z.object({
  enabled: z.boolean(),
  authorizedServers: z.array(
    z.object({
      url: z.string(),
      allowedTools: z.array(z.string()),
    }),
  ),
  blockUnauthorized: z.boolean(),
  scanToolResults: z.boolean(),
});

export const SkillsConfigSchema = z.object({
  enabled: z.boolean(),
  policy: z.enum(['monitor', 'enforce']).default('monitor'),
  allowlist: z.array(z.string()).default([]),
  denylist: z.array(z.string()).default([]),
  scan_interval_ms: z.number().int().positive().default(30000),
});

// -- Top-level config -------------------------------------------------------

export const PufferConfigSchema = z.object({
  version: z.string(),
  mode: ModeSchema,
  providers: z.array(ProviderConfigSchema),
  autoDiscovery: AutoDiscoverySchema,
  layers: z.object({
    pii: PIIConfigSchema,
    injection: InjectionConfigSchema,
    commands: CommandsConfigSchema,
    network: NetworkConfigSchema,
    filesystem: FilesystemConfigSchema,
    behavior: BehaviorConfigSchema,
    mcp: MCPConfigSchema,
    skills: SkillsConfigSchema.default({
      enabled: true,
      policy: 'monitor',
      allowlist: [],
      denylist: [],
      scan_interval_ms: 30000,
    }),
  }),
  dashboard: z.object({
    enabled: z.boolean(),
    port: z.number().int().min(0).max(65535),
  }),
  audit: z.object({
    logPath: z.string(),
    retentionDays: z.number().int().nonnegative(),
  }),
  alerts: z.object({
    webhook: z.string().url().optional(),
    desktop: z.boolean(),
  }),
  cloud: z
    .object({
      enabled: z.boolean(),
      url: z.string().url(),
      apiKey: z.string().min(1),
      batchSize: z.number().int().positive().optional(),
      flushIntervalMs: z.number().int().positive().optional(),
    })
    .optional(),
});

// Compile-time check: the schema's inferred type must be assignable to the
// public `PufferConfig` interface. If types.ts and config.ts drift, this
// `satisfies` clause turns into a TypeScript error.
export type ValidatedPufferConfig = z.infer<typeof PufferConfigSchema>;
const _typeCompat = null as unknown as ValidatedPufferConfig satisfies PufferConfig;
void _typeCompat;
