import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import type { Dirent, Stats } from 'fs';
import * as path from 'path';

/** Maximum file size (in bytes) included in hash and sizeBytes. Files larger than this are
 * counted in fileCount but their content is NOT hashed and their size is NOT added to sizeBytes. */
const MAX_FILE_SIZE_BYTES = 1 * 1024 * 1024; // 1 MB

interface FileEntry {
  relativePath: string;
  absolutePath: string;
  sizeBytes: number;
}

/**
 * Recursively collect all non-symlink files under `dir`.
 * Returns entries sorted by relativePath for deterministic hashing.
 */
async function collectFiles(dir: string, base: string): Promise<FileEntry[]> {
  const entries: FileEntry[] = [];
  let children: Dirent[];

  try {
    children = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return entries;
  }

  for (const child of children) {
    // Skip symlinks
    if (child.isSymbolicLink()) continue;

    const abs = path.join(dir, child.name);
    const rel = path.relative(base, abs);

    if (child.isDirectory()) {
      const nested = await collectFiles(abs, base);
      entries.push(...nested);
    } else if (child.isFile()) {
      let stat: Stats;
      try {
        stat = await fs.stat(abs);
      } catch {
        continue;
      }
      entries.push({ relativePath: rel, absolutePath: abs, sizeBytes: stat.size });
    }
  }

  return entries;
}

/**
 * Compute sha256 of all files in `dir` recursively.
 *
 * Files are sorted by relative path to ensure the hash is deterministic
 * regardless of filesystem ordering.
 *
 * Hash formula per file: `relativePath + '\0' + fileContents + '\0'`,
 * concatenated for all files.
 *
 * Files > 1 MB are counted in `fileCount` but are NOT hashed and their
 * size is NOT added to `sizeBytes`.
 *
 * Symlinks are skipped entirely (not counted in fileCount).
 *
 * Returns:
 * - `hash`: 64-char hex sha256 string
 * - `sizeBytes`: total size of files <= 1MB
 * - `fileCount`: total number of regular files (including those > 1MB; symlinks excluded)
 * - `lastModified`: ISO timestamp of the most recent mtime among all files
 */
export async function hashSkillDirectory(dir: string): Promise<{
  hash: string;
  sizeBytes: number;
  fileCount: number;
  lastModified: string;
}> {
  const files = await collectFiles(dir, dir);
  // Sort for deterministic order
  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));

  const hasher = crypto.createHash('sha256');
  let sizeBytes = 0;
  let fileCount = 0;
  let latestMtime = 0;

  for (const file of files) {
    fileCount++;

    // Track mtime for all files (including large ones)
    try {
      const stat = await fs.stat(file.absolutePath);
      const mtime = stat.mtimeMs;
      if (mtime > latestMtime) latestMtime = mtime;
    } catch {
      // best-effort mtime tracking
    }

    if (file.sizeBytes > MAX_FILE_SIZE_BYTES) {
      // Large file: counted but not hashed, size not included
      continue;
    }

    sizeBytes += file.sizeBytes;

    // Stream the file content into the hasher
    hasher.update(file.relativePath + '\0');
    const content = await fs.readFile(file.absolutePath);
    hasher.update(content);
    hasher.update('\0');
  }

  const hash = hasher.digest('hex');
  const lastModified =
    latestMtime > 0 ? new Date(latestMtime).toISOString() : new Date(0).toISOString();

  return { hash, sizeBytes, fileCount, lastModified };
}
