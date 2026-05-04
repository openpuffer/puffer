import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import type { SkillInventory } from '@puffer/core';
import { registerSkillsApiRoutes } from '@puffer/dashboard';

// Create a temp file to serve as a real manifest on disk.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'puffer-skill-test-'));
const manifestContent = '# Test Skill\n\nA test SKILL.md manifest.';
const manifestFilePath = path.join(tmpDir, 'SKILL.md');
fs.writeFileSync(manifestFilePath, manifestContent, 'utf-8');

const testInventory: SkillInventory = {
  scannedAt: new Date().toISOString(),
  skills: [
    {
      id: 'claude-code-global/test-skill',
      name: 'test-skill',
      source: 'claude-code-global',
      rootPath: tmpDir,
      manifestPath: manifestFilePath,
      description: 'A test skill',
      contentHash: 'abc123abc123abc123abc123abc123abc123abc123abc123abc123abc123abc1',
      lastModified: new Date().toISOString(),
      sizeBytes: 200,
      fileCount: 2,
    },
    {
      id: 'claude-code-global/no-manifest-skill',
      name: 'no-manifest-skill',
      source: 'claude-code-global',
      rootPath: tmpDir,
      manifestPath: null,
      description: 'A skill without a manifest',
      contentHash: 'def456def456def456def456def456def456def456def456def456def456def4',
      lastModified: new Date().toISOString(),
      sizeBytes: 100,
      fileCount: 1,
    },
  ],
  roots: [{ path: tmpDir, source: 'claude-code-global', existed: true }],
};

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());

  registerSkillsApiRoutes(app, () => testInventory);

  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });

  const addr = server.address() as { port: number };
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function get(path: string): Promise<{ status: number; body: unknown; text?: string }> {
  const res = await fetch(`${baseUrl}${path}`);
  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('text/plain') || contentType.includes('text/markdown')) {
    const text = await res.text();
    return { status: res.status, body: text, text };
  }
  const body = await res.json();
  return { status: res.status, body };
}

describe('GET /api/skills', () => {
  it('should return 200 with skill array', async () => {
    const { status, body } = await get('/api/skills');
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect((body as unknown[]).length).toBe(2);
  });
});

describe('GET /api/skills/:id', () => {
  it('should return manifest for known skill id', async () => {
    const { status, body } = await get('/api/skills/claude-code-global%2Ftest-skill');
    expect(status).toBe(200);
    expect((body as { name: string }).name).toBe('test-skill');
  });

  it('should return 404 for unknown skill id', async () => {
    const { status } = await get('/api/skills/does-not-exist');
    expect(status).toBe(404);
  });
});

describe('GET /api/skills/:id/manifest', () => {
  it('should return 200 with manifest text for a known skill', async () => {
    const { status, text } = await get('/api/skills/claude-code-global%2Ftest-skill/manifest');
    expect(status).toBe(200);
    expect(text).toContain('# Test Skill');
    expect(text).toContain('A test SKILL.md manifest.');
  });

  it('should return 404 for an unknown skill id', async () => {
    const { status } = await get('/api/skills/does-not-exist/manifest');
    expect(status).toBe(404);
  });

  it('should return 404 for a skill whose manifestPath is null', async () => {
    const { status } = await get('/api/skills/claude-code-global%2Fno-manifest-skill/manifest');
    expect(status).toBe(404);
  });

  it('should return 404 for an id crafted to traverse outside skill roots', async () => {
    // An attacker creates a skill id that after URL-decode would point outside roots.
    // We create a fake inventory with a manifest path that escapes tmpDir.
    const maliciousApp = express();
    maliciousApp.use(express.json());

    const maliciousInventory: SkillInventory = {
      scannedAt: new Date().toISOString(),
      skills: [
        {
          id: 'evil/traversal',
          name: 'traversal',
          source: 'unknown',
          rootPath: tmpDir,
          // Try to read /etc/passwd via a path that is NOT under tmpDir
          manifestPath: '/etc/passwd',
          description: 'malicious',
          contentHash: 'aaa',
          lastModified: new Date().toISOString(),
          sizeBytes: 0,
          fileCount: 0,
        },
      ],
      roots: [{ path: tmpDir, source: 'claude-code-global', existed: true }],
    };

    registerSkillsApiRoutes(maliciousApp, () => maliciousInventory);

    const maliciousServer = await new Promise<http.Server>((resolve) => {
      const s = maliciousApp.listen(0, '127.0.0.1', () => resolve(s));
    });

    const maliciousPort = (maliciousServer.address() as { port: number }).port;
    const res = await fetch(
      `http://127.0.0.1:${maliciousPort}/api/skills/evil%2Ftraversal/manifest`,
    );
    expect(res.status).toBe(404);

    await new Promise<void>((resolve) => maliciousServer.close(() => resolve()));
  });
});
