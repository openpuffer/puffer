import type { PufferEvent, LayerResult, SkillsConfig } from '@puffer/core';
import { allowResult } from '@puffer/core';
import type { SkillManifest } from '@puffer/core';
import { matchesPattern } from './match.js';

const LAYER_NUMBER = 8;
const LAYER_NAME = 'skill_governance';

/**
 * Layer 8: Skill Governance.
 *
 * Applies allowlist / denylist policy to `skill_invoke` events.
 *
 * - Denylist is checked FIRST; a match always blocks regardless of allowlist.
 * - Allowlist, if non-empty, acts as a whitelist: anything not in it is blocked.
 * - Both lists support exact name/id match, glob `*` patterns, and `sha256:<hex>` prefix.
 *
 * The layer always returns its true verdict. The engine's mode handling
 * (monitor vs enforce) decides whether BLOCK verdicts are actually enforced —
 * this mirrors how every other layer works in the pipeline.
 */
export async function skillGovernanceLayer(
  event: PufferEvent,
  config: SkillsConfig,
): Promise<LayerResult> {
  const start = Date.now();

  if (event.action.type !== 'skill_invoke') {
    return allowResult(LAYER_NUMBER, LAYER_NAME);
  }

  const { skill } = event.action;

  // Build a minimal SkillManifest from the action fields so we can reuse matchesPattern.
  // contentHash is optional — matchesPattern handles missing hash gracefully.
  const manifest: SkillManifest = {
    id: skill.id,
    name: skill.name,
    source: 'unknown',
    rootPath: '',
    manifestPath: null,
    description: '',
    contentHash: skill.contentHash ?? '',
    lastModified: '',
    sizeBytes: 0,
    fileCount: 0,
  };

  const durationMs = (): number => Date.now() - start;

  // 1. Denylist check (before allowlist)
  for (const pattern of config.denylist) {
    // Skip sha256 checks if the skill has no hash
    if (pattern.startsWith('sha256:') && !skill.contentHash) continue;
    if (matchesPattern(manifest, pattern)) {
      return {
        layer: LAYER_NUMBER,
        name: LAYER_NAME,
        verdict: 'block',
        confidence: 1,
        details: `skill in denylist: ${pattern}`,
        findings: [],
        durationMs: durationMs(),
      };
    }
  }

  // 2. Allowlist check (only when non-empty)
  if (config.allowlist.length > 0) {
    const permitted = config.allowlist.some((pattern) => {
      if (pattern.startsWith('sha256:') && !skill.contentHash) return false;
      return matchesPattern(manifest, pattern);
    });

    if (!permitted) {
      return {
        layer: LAYER_NUMBER,
        name: LAYER_NAME,
        verdict: 'block',
        confidence: 1,
        details: 'skill not in allowlist',
        findings: [],
        durationMs: durationMs(),
      };
    }
  }

  // 3. Allow
  return {
    layer: LAYER_NUMBER,
    name: LAYER_NAME,
    verdict: 'allow',
    confidence: 1,
    details: `skill permitted by policy (${config.policy})`,
    findings: [],
    durationMs: durationMs(),
  };
}
