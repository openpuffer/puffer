import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveSkillRoots, listSkillDirs } from '@puffer/skills';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'puffer-locations-test-'));
}

function removeDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

describe('resolveSkillRoots', () => {
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

  it('returns 4 roots when all directories exist', async () => {
    // Create all directories
    fs.mkdirSync(path.join(homeDir, '.claude', 'skills'), { recursive: true });
    fs.mkdirSync(path.join(cwdDir, '.claude', 'skills'), { recursive: true });
    const openclawHint = path.join(homeDir, 'fake-openclaw-skills');
    fs.mkdirSync(openclawHint, { recursive: true });
    fs.mkdirSync(path.join(homeDir, '.openclaw', 'skills'), { recursive: true });

    const roots = await resolveSkillRoots({
      homedir: homeDir,
      cwd: cwdDir,
      openclawSearchHints: [openclawHint],
    });

    expect(roots.length).toBe(4);
    const sources = roots.map((r) => r.source);
    expect(sources).toContain('claude-code-global');
    expect(sources).toContain('claude-code-project');
    expect(sources).toContain('openclaw-bundled');
    expect(sources).toContain('openclaw-user');
  });

  it('includes non-existent roots with existed=false (returns all candidates)', async () => {
    // Create only the global claude-code directory
    fs.mkdirSync(path.join(homeDir, '.claude', 'skills'), { recursive: true });

    const roots = await resolveSkillRoots({
      homedir: homeDir,
      cwd: cwdDir,
      openclawSearchHints: ['/nonexistent/path/openclaw/skills'],
    });

    // All 4 sources should be present (some with existed: false)
    expect(roots.length).toBe(4);
    const globalRoot = roots.find((r) => r.source === 'claude-code-global');
    expect(globalRoot).toBeDefined();
    expect(globalRoot!.existed).toBe(true);

    const projectRoot = roots.find((r) => r.source === 'claude-code-project');
    expect(projectRoot!.existed).toBe(false);
  });

  it('uses second hint when first OpenClaw hint does not exist', async () => {
    const realHint = path.join(homeDir, 'real-openclaw-skills');
    fs.mkdirSync(realHint, { recursive: true });

    const roots = await resolveSkillRoots({
      homedir: homeDir,
      cwd: cwdDir,
      openclawSearchHints: ['/nonexistent/first/hint', realHint],
    });

    const openclawRoot = roots.find((r) => r.source === 'openclaw-bundled');
    expect(openclawRoot).toBeDefined();
    expect(openclawRoot!.path).toBe(realHint);
    expect(openclawRoot!.existed).toBe(true);
  });

  it('handles glob-style OpenClaw hint with wildcard node version', async () => {
    // Simulate ~/.nvm/versions/node/<version>/lib/node_modules/openclaw/skills
    const nvmBase = path.join(homeDir, '.nvm', 'versions', 'node');
    const nodeVersionDir = path.join(nvmBase, 'v24.0.0');
    const openclawSkillsDir = path.join(
      nodeVersionDir,
      'lib',
      'node_modules',
      'openclaw',
      'skills',
    );
    fs.mkdirSync(openclawSkillsDir, { recursive: true });

    // The glob hint uses * for the version
    const globHint = path.join(
      homeDir,
      '.nvm',
      'versions',
      'node',
      '*',
      'lib',
      'node_modules',
      'openclaw',
      'skills',
    );

    const roots = await resolveSkillRoots({
      homedir: homeDir,
      cwd: cwdDir,
      openclawSearchHints: [globHint],
    });

    const openclawRoot = roots.find((r) => r.source === 'openclaw-bundled');
    expect(openclawRoot).toBeDefined();
    expect(openclawRoot!.existed).toBe(true);
    expect(openclawRoot!.path).toBe(openclawSkillsDir);
  });
});

describe('listSkillDirs', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    removeDir(tmpDir);
  });

  it('returns only immediate child directories (files at parent level are skipped)', async () => {
    fs.mkdirSync(path.join(tmpDir, 'skill-a'));
    fs.mkdirSync(path.join(tmpDir, 'skill-b'));
    fs.writeFileSync(path.join(tmpDir, 'random-file.txt'), 'not a skill');

    const dirs = await listSkillDirs(tmpDir);
    expect(dirs).toHaveLength(2);
    expect(dirs).toContain(path.join(tmpDir, 'skill-a'));
    expect(dirs).toContain(path.join(tmpDir, 'skill-b'));
  });

  it('returns empty array for non-existent parent (graceful)', async () => {
    const dirs = await listSkillDirs('/nonexistent/path/that/does/not/exist');
    expect(dirs).toEqual([]);
  });
});
