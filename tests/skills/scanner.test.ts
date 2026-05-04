import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { scanSkills, diffInventories } from '@puffer/skills';
import type { SkillInventory, SkillManifest } from '@puffer/core';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'puffer-scanner-test-'));
}

function removeDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

function makeSkill(
  parent: string,
  name: string,
  opts?: { description?: string; frontmatter?: boolean },
): void {
  const skillDir = path.join(parent, name);
  fs.mkdirSync(skillDir, { recursive: true });
  if (opts?.frontmatter !== false) {
    const fm = opts?.description
      ? `---\nname: ${name}\ndescription: ${opts.description}\n---\n# ${name}\nSkill body.`
      : `# ${name}\nSkill body without frontmatter.`;
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), fm);
  }
}

describe('scanSkills', () => {
  let homeDir: string;
  let cwdDir: string;

  beforeEach(() => {
    homeDir = makeTmpDir();
    cwdDir = makeTmpDir();
  });

  afterEach(() => {
    removeDir(homeDir);
    removeDir(cwdDir);
  });

  it('discovers 2 skills under ~/.claude/skills/ and returns correct sources', async () => {
    const skillsDir = path.join(homeDir, '.claude', 'skills');
    fs.mkdirSync(skillsDir, { recursive: true });
    makeSkill(skillsDir, 'simplify', { description: 'Simplifies code' });
    makeSkill(skillsDir, 'review', { description: 'Reviews code' });

    const inventory = await scanSkills({
      homedir: homeDir,
      cwd: cwdDir,
      openclawSearchHints: [],
    });

    const globalSkills = inventory.skills.filter((s) => s.source === 'claude-code-global');
    expect(globalSkills).toHaveLength(2);
    for (const skill of globalSkills) {
      expect(skill.source).toBe('claude-code-global');
    }
  });

  it('includes parsed description from frontmatter', async () => {
    const skillsDir = path.join(homeDir, '.claude', 'skills');
    fs.mkdirSync(skillsDir, { recursive: true });
    makeSkill(skillsDir, 'my-skill', { description: 'Does cool stuff' });

    const inventory = await scanSkills({
      homedir: homeDir,
      cwd: cwdDir,
      openclawSearchHints: [],
    });

    const skill = inventory.skills.find((s) => s.name === 'my-skill');
    expect(skill).toBeDefined();
    expect(skill!.description).toBe('Does cool stuff');
  });

  it('manifest ID is "<source>/<name>"', async () => {
    const skillsDir = path.join(homeDir, '.claude', 'skills');
    fs.mkdirSync(skillsDir, { recursive: true });
    makeSkill(skillsDir, 'test-skill');

    const inventory = await scanSkills({
      homedir: homeDir,
      cwd: cwdDir,
      openclawSearchHints: [],
    });

    const skill = inventory.skills.find((s) => s.name === 'test-skill');
    expect(skill).toBeDefined();
    expect(skill!.id).toBe('claude-code-global/test-skill');
  });

  it('skill dir without SKILL.md still gets a manifest with manifestPath: null and description: ""', async () => {
    const skillsDir = path.join(homeDir, '.claude', 'skills');
    fs.mkdirSync(skillsDir, { recursive: true });
    const skillDir = path.join(skillsDir, 'no-manifest');
    fs.mkdirSync(skillDir);
    fs.writeFileSync(path.join(skillDir, 'config.json'), '{"key":"value"}');

    const inventory = await scanSkills({
      homedir: homeDir,
      cwd: cwdDir,
      openclawSearchHints: [],
    });

    const skill = inventory.skills.find((s) => s.name === 'no-manifest');
    expect(skill).toBeDefined();
    expect(skill!.manifestPath).toBeNull();
    expect(skill!.description).toBe('');
  });

  it('concurrent scans of same fixture return identical hashes (determinism)', async () => {
    const skillsDir = path.join(homeDir, '.claude', 'skills');
    fs.mkdirSync(skillsDir, { recursive: true });
    makeSkill(skillsDir, 'concurrent-skill', { description: 'Tested concurrently' });

    const [inv1, inv2] = await Promise.all([
      scanSkills({ homedir: homeDir, cwd: cwdDir, openclawSearchHints: [] }),
      scanSkills({ homedir: homeDir, cwd: cwdDir, openclawSearchHints: [] }),
    ]);

    expect(inv1.skills[0]!.contentHash).toBe(inv2.skills[0]!.contentHash);
  });

  it('merges skills from multiple roots (Claude Code global + project)', async () => {
    const globalSkillsDir = path.join(homeDir, '.claude', 'skills');
    const projectSkillsDir = path.join(cwdDir, '.claude', 'skills');
    fs.mkdirSync(globalSkillsDir, { recursive: true });
    fs.mkdirSync(projectSkillsDir, { recursive: true });
    makeSkill(globalSkillsDir, 'global-skill', { description: 'Global' });
    makeSkill(projectSkillsDir, 'project-skill', { description: 'Project' });

    const inventory = await scanSkills({
      homedir: homeDir,
      cwd: cwdDir,
      openclawSearchHints: [],
    });

    const globalSkill = inventory.skills.find((s) => s.name === 'global-skill');
    const projectSkill = inventory.skills.find((s) => s.name === 'project-skill');
    expect(globalSkill).toBeDefined();
    expect(globalSkill!.source).toBe('claude-code-global');
    expect(projectSkill).toBeDefined();
    expect(projectSkill!.source).toBe('claude-code-project');
  });

  it('roots array includes non-existent roots with existed=false', async () => {
    // Don't create any skill directories
    const inventory = await scanSkills({
      homedir: homeDir,
      cwd: cwdDir,
      openclawSearchHints: [],
    });

    const globalRoot = inventory.roots.find((r) => r.source === 'claude-code-global');
    expect(globalRoot).toBeDefined();
    expect(globalRoot!.existed).toBe(false);
  });
});

describe('diffInventories', () => {
  function makeManifest(id: string, hash: string): SkillManifest {
    const [source, name] = id.split('/') as [string, string];
    return {
      id,
      name,
      source: source as SkillManifest['source'],
      rootPath: `/fake/${name}`,
      manifestPath: `/fake/${name}/SKILL.md`,
      description: 'Test skill',
      contentHash: hash,
      lastModified: new Date().toISOString(),
      sizeBytes: 100,
      fileCount: 1,
    };
  }

  function makeInventory(skills: SkillManifest[]): SkillInventory {
    return {
      scannedAt: new Date().toISOString(),
      skills,
      roots: [],
    };
  }

  it('detects added skill', () => {
    const prev = makeInventory([]);
    const curr = makeInventory([makeManifest('claude-code-global/new-skill', 'abc123')]);

    const events = diffInventories(prev, curr);
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('skill_added');
    expect(events[0]!.skill.id).toBe('claude-code-global/new-skill');
  });

  it('detects removed skill', () => {
    const prev = makeInventory([makeManifest('claude-code-global/old-skill', 'abc123')]);
    const curr = makeInventory([]);

    const events = diffInventories(prev, curr);
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('skill_removed');
    expect(events[0]!.skill.id).toBe('claude-code-global/old-skill');
  });

  it('detects modified skill (contentHash changed)', () => {
    const prev = makeInventory([makeManifest('claude-code-global/changed-skill', 'hash-before')]);
    const curr = makeInventory([makeManifest('claude-code-global/changed-skill', 'hash-after')]);

    const events = diffInventories(prev, curr);
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('skill_modified');
    expect(events[0]!.skill.id).toBe('claude-code-global/changed-skill');
    expect(events[0]!.previousHash).toBe('hash-before');
  });

  it('handles combined add, remove, and modify in same diff', () => {
    const prev = makeInventory([
      makeManifest('claude-code-global/to-remove', 'hash-remove'),
      makeManifest('claude-code-global/to-modify', 'hash-old'),
    ]);
    const curr = makeInventory([
      makeManifest('claude-code-global/to-modify', 'hash-new'),
      makeManifest('claude-code-global/to-add', 'hash-add'),
    ]);

    const events = diffInventories(prev, curr);
    expect(events).toHaveLength(3);
    const types = events.map((e) => e.type);
    expect(types).toContain('skill_added');
    expect(types).toContain('skill_removed');
    expect(types).toContain('skill_modified');
  });

  it('returns empty diff for identical inventories', () => {
    const skills = [makeManifest('claude-code-global/stable', 'same-hash')];
    const prev = makeInventory(skills);
    const curr = makeInventory([makeManifest('claude-code-global/stable', 'same-hash')]);

    const events = diffInventories(prev, curr);
    expect(events).toHaveLength(0);
  });
});
