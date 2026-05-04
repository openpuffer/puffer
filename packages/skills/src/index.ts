// @puffer/skills barrel — skill discovery and governance
export { parseFrontmatter } from './frontmatter.js';
export { hashSkillDirectory } from './hasher.js';
export { resolveSkillRoots, listSkillDirs } from './locations.js';
export type { SkillRoot } from './locations.js';
export { scanSkills, diffInventories } from './scanner.js';
export type { ScanOptions } from './scanner.js';

// Re-export the types from core for consumer convenience
export type { SkillSource, SkillManifest, SkillInventory, SkillChangeEvent } from '@puffer/core';
