// Puffer Rule Format — community-contributed detection rules

export interface PufferRule {
  id: string; // e.g., PUFFER-INJ-001
  name: string; // Human-readable name
  description: string; // What it detects
  author: string; // Contributor
  severity: 'critical' | 'high' | 'medium' | 'low';
  layer: 'injection' | 'pii' | 'commands' | 'network' | 'filesystem' | 'behavior' | 'mcp';
  action: 'block' | 'audit' | 'escalate';
  tags: string[];
  // Detection criteria (at least one required)
  pattern?: string | undefined; // Regex pattern to match
  patterns?: string[] | undefined; // Multiple patterns (OR logic)
  command?: string | undefined; // Command name to match
  path?: string | undefined; // File path pattern (glob)
  domain?: string | undefined; // Domain pattern (glob)
  // Optional metadata
  version?: string | undefined; // SemVer used by the update checker
  references?: string[] | undefined; // Links to advisories, CVEs, etc.
  created?: string | undefined; // ISO date
  modified?: string | undefined;
}

// Remote registry manifest format consumed by src/rules/updater.ts.
// Each entry describes one rule available on the registry; `file` is the
// relative path under the registry base URL, and `version` is the SemVer
// used to detect upgrades against the local copies of the rule.
export interface RuleManifestEntry {
  id: string;
  version: string;
  file: string;
}

export interface RuleManifest {
  rules: RuleManifestEntry[];
}
