import * as fs from 'fs/promises';
import * as path from 'path';
import type { SkillInventory, SkillManifest, SkillChangeEvent } from '@puffer/core';
import { resolveSkillRoots, listSkillDirs } from './locations.js';
import { parseFrontmatter } from './frontmatter.js';
import { hashSkillDirectory } from './hasher.js';

export interface ScanOptions {
  homedir?: string;
  cwd?: string;
  openclawSearchHints?: string[];
}

/**
 * Scan all skill roots and return a full inventory.
 *
 * Flow:
 * 1. `resolveSkillRoots(opts)` → full list of roots (including non-existent ones)
 * 2. For each existing root, `listSkillDirs(root.path)` → skill directories
 * 3. For each skill dir: read SKILL.md (if present), hash directory, build SkillManifest
 * 4. Return SkillInventory with timestamp, skills, and roots (all with `existed` flags)
 */
export async function scanSkills(opts?: ScanOptions): Promise<SkillInventory> {
  const scannedAt = new Date().toISOString();
  const roots = await resolveSkillRoots(opts);
  const skills: SkillManifest[] = [];

  for (const root of roots) {
    if (!root.existed) continue;

    const skillDirs = await listSkillDirs(root.path);
    for (const skillDir of skillDirs) {
      const manifest = await buildManifest(skillDir, root.source);
      skills.push(manifest);
    }
  }

  return {
    scannedAt,
    skills,
    roots: roots.map((r) => ({ path: r.path, source: r.source, existed: r.existed })),
  };
}

async function buildManifest(
  skillDir: string,
  source: SkillManifest['source'],
): Promise<SkillManifest> {
  const name = path.basename(skillDir);
  const id = `${source}/${name}`;

  // Try to read SKILL.md
  const manifestFile = path.join(skillDir, 'SKILL.md');
  let manifestPath: string | null = null;
  let description = '';

  try {
    const raw = await fs.readFile(manifestFile, 'utf-8');
    manifestPath = manifestFile;
    const { frontmatter, body } = parseFrontmatter(raw);

    if (frontmatter['description']) {
      description = frontmatter['description'];
    } else {
      // Fall back to first non-empty paragraph in body
      const firstLine = body
        .split('\n')
        .map((l) => l.trim())
        .find((l) => l.length > 0 && !l.startsWith('#'));
      description = firstLine ?? '';
    }
  } catch {
    // No SKILL.md present — manifestPath stays null, description stays ''
  }

  const { hash, sizeBytes, fileCount, lastModified } = await hashSkillDirectory(skillDir);

  return {
    id,
    name,
    source,
    rootPath: skillDir,
    manifestPath,
    description,
    contentHash: hash,
    lastModified,
    sizeBytes,
    fileCount,
  };
}

/**
 * Diff two inventories and return change events.
 *
 * - `skill_added`: present in curr but not prev
 * - `skill_removed`: present in prev but not curr
 * - `skill_modified`: present in both but contentHash differs
 */
export function diffInventories(prev: SkillInventory, curr: SkillInventory): SkillChangeEvent[] {
  const prevMap = new Map<string, SkillManifest>(prev.skills.map((s) => [s.id, s]));
  const currMap = new Map<string, SkillManifest>(curr.skills.map((s) => [s.id, s]));

  const events: SkillChangeEvent[] = [];

  for (const [id, currSkill] of currMap) {
    const prevSkill = prevMap.get(id);
    if (!prevSkill) {
      events.push({ type: 'skill_added', skill: currSkill });
    } else if (prevSkill.contentHash !== currSkill.contentHash) {
      events.push({
        type: 'skill_modified',
        skill: currSkill,
        previousHash: prevSkill.contentHash,
      });
    }
  }

  for (const [id, prevSkill] of prevMap) {
    if (!currMap.has(id)) {
      events.push({ type: 'skill_removed', skill: prevSkill });
    }
  }

  return events;
}
