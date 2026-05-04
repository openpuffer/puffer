import type { SkillManifest } from '@puffer/core';

/**
 * Convert a simple glob pattern (supports `*` wildcard only) to a RegExp.
 * We escape all regex-special chars except `*`, then replace `*` with `.*`.
 */
function globToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}

/**
 * Check whether a skill manifest matches a single pattern string.
 *
 * Matching rules (first match wins):
 *  1. `sha256:<hex>` prefix → compare against skill.contentHash
 *  2. Exact match against skill.name OR skill.id
 *  3. Glob `*` pattern against skill.name OR skill.id
 *
 * Case-sensitive (skill names and IDs are case-sensitive on disk).
 */
export function matchesPattern(skill: SkillManifest, pattern: string): boolean {
  // SHA-256 prefix match
  if (pattern.startsWith('sha256:')) {
    const expectedHash = pattern.slice('sha256:'.length);
    return skill.contentHash === expectedHash;
  }

  // Exact match against name or id
  if (skill.name === pattern || skill.id === pattern) {
    return true;
  }

  // Glob match (only if the pattern contains *)
  if (pattern.includes('*')) {
    const regex = globToRegex(pattern);
    return regex.test(skill.name) || regex.test(skill.id);
  }

  return false;
}
