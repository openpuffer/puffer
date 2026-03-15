// Puffer Rule Format — community-contributed detection rules

export interface PufferRule {
  id: string;                    // e.g., PUFFER-INJ-001
  name: string;                  // Human-readable name
  description: string;           // What it detects
  author: string;                // Contributor
  severity: 'critical' | 'high' | 'medium' | 'low';
  layer: 'injection' | 'pii' | 'commands' | 'network' | 'filesystem' | 'behavior' | 'mcp';
  action: 'block' | 'audit' | 'escalate';
  tags: string[];
  // Detection criteria (at least one required)
  pattern?: string;              // Regex pattern to match
  patterns?: string[];           // Multiple patterns (OR logic)
  command?: string;              // Command name to match
  path?: string;                 // File path pattern (glob)
  domain?: string;               // Domain pattern (glob)
  // Optional metadata
  references?: string[];         // Links to advisories, CVEs, etc.
  created?: string;              // ISO date
  modified?: string;
}
