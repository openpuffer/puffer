import type { SkillManifest } from '@puffer/core';
import type { SkillSource } from '@puffer/core';

export type SkillSortKey = 'modified' | 'alpha' | 'size' | 'source';

/**
 * Pure filtering + sorting helper for the skills inventory table.
 * Extracted here so it can be unit-tested without a React environment.
 */
export function filterAndSortSkills(
  skills: SkillManifest[],
  query: string,
  activeSources: Set<SkillSource>,
  sortKey: SkillSortKey,
): SkillManifest[] {
  const q = query.trim().toLowerCase();

  let result = skills.filter((s) => {
    // Source filter — empty set means "all".
    if (activeSources.size > 0 && !activeSources.has(s.source)) return false;

    // Text filter — matches name or description, case-insensitive.
    if (q) {
      const nameMatch = s.name.toLowerCase().includes(q);
      const descMatch = s.description.toLowerCase().includes(q);
      if (!nameMatch && !descMatch) return false;
    }

    return true;
  });

  switch (sortKey) {
    case 'alpha':
      result = [...result].sort((a, b) => a.name.localeCompare(b.name));
      break;
    case 'size':
      result = [...result].sort((a, b) => b.sizeBytes - a.sizeBytes);
      break;
    case 'source':
      result = [...result].sort(
        (a, b) => a.source.localeCompare(b.source) || a.name.localeCompare(b.name),
      );
      break;
    case 'modified':
    default:
      result = [...result].sort(
        (a, b) => new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime(),
      );
  }

  return result;
}

/**
 * Given an agent name, return the SkillSource values that are relevant
 * for the "Installed Skills" section in AgentDetailPanel.
 *
 * Rules:
 * - claude-code / claude-code-* agents → global + project Claude Code skills.
 * - openclaw agent → bundled + user OpenClaw skills.
 * - anything else → empty (no skills tracking available).
 */
export function agentSourceFilter(agentName: string): SkillSource[] {
  const lower = agentName.toLowerCase();
  if (lower.includes('claude-code') || lower === 'claude') {
    return ['claude-code-global', 'claude-code-project'];
  }
  if (lower.includes('openclaw')) {
    return ['openclaw-bundled', 'openclaw-user'];
  }
  return [];
}
