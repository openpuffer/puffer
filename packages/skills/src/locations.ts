import * as fs from 'fs/promises';
import type { Dirent } from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { SkillSource } from '@puffer/core';

export interface SkillRoot {
  path: string;
  source: SkillSource;
  /** Whether the directory actually exists on disk. */
  existed: boolean;
}

/** Default OpenClaw search hints (in resolution order). */
const DEFAULT_OPENCLAW_HINTS = [
  // NVM-based node installations (glob segment: *)
  path.join(
    os.homedir(),
    '.nvm',
    'versions',
    'node',
    '*',
    'lib',
    'node_modules',
    'openclaw',
    'skills',
  ),
  // System-wide installations
  '/usr/local/lib/node_modules/openclaw/skills',
  '/usr/lib/node_modules/openclaw/skills',
];

/**
 * Expand a single hint that may contain a `*` wildcard in one segment.
 * Only the FIRST matching directory is returned (or null if none found).
 *
 * Supports exactly one `*` wildcard segment (for NVM-style paths).
 */
async function expandGlobHint(hint: string): Promise<string | null> {
  const parts = hint.split(path.sep);
  const starIndex = parts.findIndex((p) => p === '*');

  if (starIndex === -1) {
    // No wildcard — check directly
    try {
      await fs.access(hint);
      return hint;
    } catch {
      return null;
    }
  }

  // Build the prefix up to the wildcard
  const prefix = parts.slice(0, starIndex).join(path.sep) || path.sep;
  const suffix = parts.slice(starIndex + 1).join(path.sep);

  let entries: string[];
  try {
    entries = await fs.readdir(prefix);
  } catch {
    return null;
  }

  // Sort for deterministic resolution (newest version last alphabetically for semver)
  entries.sort();

  for (const entry of entries) {
    const candidate = path.join(prefix, entry, suffix);
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Not found, try next
    }
  }

  return null;
}

/**
 * Resolve all skill roots for the current user, returning ALL candidates
 * (including non-existent ones). The `existed` flag signals whether the
 * directory was found on disk. `scanSkills` uses this to populate
 * `SkillInventory.roots`.
 *
 * Resolution order:
 * 1. Claude Code global:   `${homedir}/.claude/skills`         → `claude-code-global`
 * 2. Claude Code project:  `${cwd}/.claude/skills`             → `claude-code-project`
 * 3. OpenClaw bundled:     first hint in `openclawSearchHints` that exists → `openclaw-bundled`
 * 4. OpenClaw user:        `${homedir}/.openclaw/skills`        → `openclaw-user`
 */
export async function resolveSkillRoots(opts?: {
  homedir?: string;
  cwd?: string;
  openclawSearchHints?: string[];
}): Promise<SkillRoot[]> {
  const home = opts?.homedir ?? os.homedir();
  const cwd = opts?.cwd ?? process.cwd();
  const hints = opts?.openclawSearchHints ?? DEFAULT_OPENCLAW_HINTS;

  const roots: SkillRoot[] = [];

  // 1. Claude Code global
  const globalPath = path.join(home, '.claude', 'skills');
  roots.push({
    path: globalPath,
    source: 'claude-code-global',
    existed: await dirExists(globalPath),
  });

  // 2. Claude Code project
  const projectPath = path.join(cwd, '.claude', 'skills');
  roots.push({
    path: projectPath,
    source: 'claude-code-project',
    existed: await dirExists(projectPath),
  });

  // 3. OpenClaw bundled — try hints in order, first existing one wins
  let openclawPath: string | null = null;
  for (const hint of hints) {
    const resolved = await expandGlobHint(hint);
    if (resolved !== null) {
      openclawPath = resolved;
      break;
    }
  }

  if (openclawPath !== null) {
    roots.push({ path: openclawPath, source: 'openclaw-bundled', existed: true });
  } else {
    // Report as non-existent using the first hint as the canonical path for reporting
    const firstHint = hints[0] ?? '/usr/local/lib/node_modules/openclaw/skills';
    // For reporting purposes, use first hint (non-glob version for readability)
    const reportPath = firstHint.includes('*')
      ? firstHint.replace('*', '<node-version>')
      : firstHint;
    roots.push({ path: reportPath, source: 'openclaw-bundled', existed: false });
  }

  // 4. OpenClaw user
  const userOpenclawPath = path.join(home, '.openclaw', 'skills');
  roots.push({
    path: userOpenclawPath,
    source: 'openclaw-user',
    existed: await dirExists(userOpenclawPath),
  });

  return roots;
}

/**
 * List all immediate child directories of `parent`.
 * Files at the parent level are skipped.
 * Returns [] if the parent does not exist (graceful).
 */
export async function listSkillDirs(parent: string): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(parent, { withFileTypes: true });
  } catch {
    return [];
  }

  const dirs: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      dirs.push(path.join(parent, entry.name));
    }
  }

  return dirs;
}

async function dirExists(dirPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(dirPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}
