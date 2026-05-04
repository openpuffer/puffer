import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { hashSkillDirectory } from '@puffer/skills';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'puffer-hasher-test-'));
}

function removeDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

describe('hashSkillDirectory', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    removeDir(tmpDir);
  });

  it('handles empty directory: fileCount=0, sizeBytes=0, returns deterministic hash', async () => {
    const result = await hashSkillDirectory(tmpDir);
    expect(result.fileCount).toBe(0);
    expect(result.sizeBytes).toBe(0);
    expect(result.hash).toHaveLength(64);
    // Deterministic: same result on second call
    const result2 = await hashSkillDirectory(tmpDir);
    expect(result.hash).toBe(result2.hash);
  });

  it('single-file dir produces known hash for known content', async () => {
    const content = 'hello world\n';
    fs.writeFileSync(path.join(tmpDir, 'SKILL.md'), content);

    const result = await hashSkillDirectory(tmpDir);
    expect(result.fileCount).toBe(1);
    expect(result.sizeBytes).toBe(Buffer.byteLength(content));
    expect(result.hash).toHaveLength(64);

    // Manually compute expected hash: "SKILL.md\0hello world\n\0"
    const expected = crypto
      .createHash('sha256')
      .update('SKILL.md\0' + content + '\0')
      .digest('hex');
    expect(result.hash).toBe(expected);
  });

  it('hash is order-independent (sorting by relative path)', async () => {
    fs.writeFileSync(path.join(tmpDir, 'z-file.md'), 'zzz content');
    fs.writeFileSync(path.join(tmpDir, 'a-file.md'), 'aaa content');
    fs.writeFileSync(path.join(tmpDir, 'SKILL.md'), 'skill content');

    const result1 = await hashSkillDirectory(tmpDir);

    // Recreate in reverse order in a new dir
    const tmpDir2 = makeTmpDir();
    try {
      fs.writeFileSync(path.join(tmpDir2, 'SKILL.md'), 'skill content');
      fs.writeFileSync(path.join(tmpDir2, 'a-file.md'), 'aaa content');
      fs.writeFileSync(path.join(tmpDir2, 'z-file.md'), 'zzz content');

      const result2 = await hashSkillDirectory(tmpDir2);
      expect(result1.hash).toBe(result2.hash);
    } finally {
      removeDir(tmpDir2);
    }
  });

  it('adding a file changes the hash', async () => {
    fs.writeFileSync(path.join(tmpDir, 'SKILL.md'), 'original content');
    const before = await hashSkillDirectory(tmpDir);

    fs.writeFileSync(path.join(tmpDir, 'extra.md'), 'new file');
    const after = await hashSkillDirectory(tmpDir);

    expect(before.hash).not.toBe(after.hash);
  });

  it('modifying a file changes the hash', async () => {
    const filePath = path.join(tmpDir, 'SKILL.md');
    fs.writeFileSync(filePath, 'original content');
    const before = await hashSkillDirectory(tmpDir);

    fs.writeFileSync(filePath, 'modified content');
    const after = await hashSkillDirectory(tmpDir);

    expect(before.hash).not.toBe(after.hash);
  });

  it('files > 1MB are counted in fileCount but not included in hash or sizeBytes', async () => {
    const smallContent = 'small file content';
    fs.writeFileSync(path.join(tmpDir, 'SKILL.md'), smallContent);

    // Create a 1.5MB file
    const bigContent = Buffer.alloc(1.5 * 1024 * 1024, 'x');
    fs.writeFileSync(path.join(tmpDir, 'big-file.bin'), bigContent);

    const result = await hashSkillDirectory(tmpDir);

    // Both files counted
    expect(result.fileCount).toBe(2);
    // sizeBytes only counts the small file (large file skipped)
    expect(result.sizeBytes).toBe(Buffer.byteLength(smallContent));

    // Hash should equal what we'd get for just the small file
    const expectedHash = crypto
      .createHash('sha256')
      .update('SKILL.md\0' + smallContent + '\0')
      .digest('hex');
    expect(result.hash).toBe(expectedHash);
  });

  it('symlinks are skipped (not counted in fileCount)', async () => {
    const realFile = path.join(tmpDir, 'real.md');
    const symlink = path.join(tmpDir, 'link.md');
    fs.writeFileSync(realFile, 'real content');
    fs.symlinkSync(realFile, symlink);

    const result = await hashSkillDirectory(tmpDir);

    // Only the real file counts
    expect(result.fileCount).toBe(1);
  });
});
