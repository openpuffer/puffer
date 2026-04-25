import { describe, it, expect } from 'vitest';
import { filesystemSentinel } from '@puffer/layer-filesystem';
import { PufferEvent, FilesystemConfig } from '@puffer/core';

function makeEvent(
  type: 'file_read' | 'file_write',
  filePath: string,
  content?: string,
): PufferEvent {
  const action =
    type === 'file_read'
      ? { type: 'file_read' as const, path: filePath }
      : { type: 'file_write' as const, path: filePath, content };

  return {
    id: 'test-1',
    timestamp: new Date().toISOString(),
    source: { type: 'hook', agent: 'test-agent', provider: 'local' },
    action,
    metadata: { sessionId: 'sess-1', sequenceNumber: 1 },
    layers: [],
    decision: null,
  };
}

const defaultConfig: FilesystemConfig = {
  enabled: true,
  forbidden: ['~/.ssh/', '~/.aws/', '~/.gnupg/'],
  restricted: ['~/.config/', '/etc/'],
  workspace: ['~/projects/'],
  secretPatterns: [
    'AKIA[0-9A-Z]{16}',
    'sk-[a-zA-Z0-9]{48}',
    '-----BEGIN (?:RSA |EC )?PRIVATE KEY-----',
  ],
};

describe('Filesystem Sentinel', () => {
  describe('Forbidden paths', () => {
    it('should block access to ~/.ssh/', async () => {
      const event = makeEvent('file_read', '~/.ssh/id_rsa');
      const result = await filesystemSentinel(event, defaultConfig);
      expect(result.verdict).toBe('block');
      expect(result.findings.some((f) => f.type === 'forbidden_path')).toBe(true);
    });

    it('should block access to ~/.aws/', async () => {
      const event = makeEvent('file_read', '~/.aws/credentials');
      const result = await filesystemSentinel(event, defaultConfig);
      expect(result.verdict).toBe('block');
      expect(result.findings.some((f) => f.type === 'forbidden_path')).toBe(true);
    });
  });

  describe('Restricted paths', () => {
    it('should escalate writes to restricted paths', async () => {
      const event = makeEvent('file_write', '~/.config/something.json', '{}');
      const result = await filesystemSentinel(event, defaultConfig);
      expect(result.verdict).toBe('escalate');
      expect(result.findings.some((f) => f.type === 'restricted_path_write')).toBe(true);
    });
  });

  describe('Path traversal', () => {
    it('should detect path traversal with ..', async () => {
      const event = makeEvent('file_read', '/tmp/../../etc/passwd');
      const result = await filesystemSentinel(event, defaultConfig);
      expect(result.findings.some((f) => f.type === 'path_traversal')).toBe(true);
    });
  });

  describe('Secret detection', () => {
    it('should detect AWS keys in written content', async () => {
      const event = makeEvent('file_write', '/tmp/config.txt', 'aws_key=AKIAIOSFODNN7EXAMPLE');
      const result = await filesystemSentinel(event, defaultConfig);
      expect(result.findings.some((f) => f.type === 'secret_in_content')).toBe(true);
    });

    it('should detect private keys in written content', async () => {
      const event = makeEvent(
        'file_write',
        '/tmp/key.pem',
        '-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----',
      );
      const result = await filesystemSentinel(event, defaultConfig);
      expect(result.findings.some((f) => f.type === 'secret_in_content')).toBe(true);
    });
  });

  describe('Non-file events', () => {
    it('should pass through non-file events', async () => {
      const event: PufferEvent = {
        id: 'test-1',
        timestamp: new Date().toISOString(),
        source: { type: 'proxy', agent: 'test-agent', provider: 'openai' },
        action: {
          type: 'llm_request',
          method: 'POST',
          endpoint: '/v1/chat/completions',
          body: 'hello',
        },
        metadata: { sessionId: 'sess-1', sequenceNumber: 1 },
        layers: [],
        decision: null,
      };
      const result = await filesystemSentinel(event, defaultConfig);
      expect(result.verdict).toBe('allow');
      expect(result.details).toBe('Not applicable to this event type');
    });
  });
});
