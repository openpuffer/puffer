import { describe, it, expect } from 'vitest';
import { piiScanner, luhnCheck, validateIBAN, redactValue } from '../../src/layers/layer-1-pii.js';
import { PufferEvent, PIIConfig } from '@puffer/core';

function makeEvent(text: string, type: 'llm_request' | 'file_write' = 'llm_request'): PufferEvent {
  if (type === 'file_write') {
    return {
      id: 'test-1',
      timestamp: new Date().toISOString(),
      source: { type: 'proxy', agent: 'test-agent', provider: 'openai' },
      action: { type: 'file_write', path: '/tmp/test.txt', content: text },
      metadata: { sessionId: 'sess-1', sequenceNumber: 1 },
      layers: [],
      decision: null,
    };
  }
  return {
    id: 'test-1',
    timestamp: new Date().toISOString(),
    source: { type: 'proxy', agent: 'test-agent', provider: 'openai' },
    action: {
      type: 'llm_request',
      method: 'POST',
      endpoint: '/v1/chat/completions',
      body: { messages: [{ role: 'user', content: text }], model: 'gpt-4', max_tokens: 4096 },
    },
    metadata: { sessionId: 'sess-1', sequenceNumber: 1 },
    layers: [],
    decision: null,
  };
}

function makeRawBodyEvent(body: unknown): PufferEvent {
  return {
    id: 'test-1',
    timestamp: new Date().toISOString(),
    source: { type: 'proxy', agent: 'test-agent', provider: 'anthropic' },
    action: { type: 'llm_request', method: 'POST', endpoint: '/v1/messages', body },
    metadata: { sessionId: 'sess-1', sequenceNumber: 1 },
    layers: [],
    decision: null,
  };
}

const defaultConfig: PIIConfig = {
  enabled: true,
  regions: ['us', 'global', 'mx', 'eu'],
  actionBySeverity: {
    critical: 'block',
    high: 'escalate',
    medium: 'audit',
    low: 'allow',
  },
  customPatterns: [],
  excludeContexts: [],
};

describe('PII Scanner', () => {
  describe('SSN detection', () => {
    it('should detect valid US SSN', async () => {
      const event = makeEvent('My SSN is 123-45-6789');
      const result = await piiScanner(event, defaultConfig);
      expect(result.verdict).not.toBe('allow');
      expect(result.findings.length).toBeGreaterThan(0);
      expect(result.findings.some((f) => f.type === 'ssn_us')).toBe(true);
    });

    it('should not detect invalid SSN starting with 000', async () => {
      const event = makeEvent('Not a SSN: 000-45-6789');
      const result = await piiScanner(event, defaultConfig);
      expect(result.findings.some((f) => f.type === 'ssn_us')).toBe(false);
    });

    it('should not detect invalid SSN starting with 666', async () => {
      const event = makeEvent('Not a SSN: 666-45-6789');
      const result = await piiScanner(event, defaultConfig);
      expect(result.findings.some((f) => f.type === 'ssn_us')).toBe(false);
    });
  });

  describe('Credit card detection', () => {
    it('should detect valid Visa card with Luhn check', async () => {
      const event = makeEvent('Card: 4532015112830366');
      const result = await piiScanner(event, defaultConfig);
      expect(result.findings.some((f) => f.type === 'credit_card')).toBe(true);
    });

    it('should reject card failing Luhn check', async () => {
      const event = makeEvent('Card: 4532015112830367');
      const result = await piiScanner(event, defaultConfig);
      expect(result.findings.some((f) => f.type === 'credit_card')).toBe(false);
    });
  });

  describe('Email detection', () => {
    it('should detect email addresses', async () => {
      const event = makeEvent('Contact me at user@example.com please');
      const result = await piiScanner(event, defaultConfig);
      expect(result.findings.some((f) => f.type === 'email')).toBe(true);
    });
  });

  describe('API key detection', () => {
    it('should detect OpenAI API key', async () => {
      const event = makeEvent('key: sk-abc123def456ghi789jklmnopqrst');
      const result = await piiScanner(event, defaultConfig);
      expect(result.findings.some((f) => f.type === 'openai_api_key')).toBe(true);
    });

    it('should detect AWS access key', async () => {
      const event = makeEvent('aws key: AKIAIOSFODNN7EXAMPLE');
      const result = await piiScanner(event, defaultConfig);
      expect(result.findings.some((f) => f.type === 'aws_access_key')).toBe(true);
    });

    it('should detect GitHub PAT', async () => {
      const event = makeEvent('token: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij');
      const result = await piiScanner(event, defaultConfig);
      expect(result.findings.some((f) => f.type === 'github_pat')).toBe(true);
    });

    it('should detect Anthropic API key', async () => {
      const event = makeEvent('key: sk-ant-abcdefghijklmnopqrstuvwx');
      const result = await piiScanner(event, defaultConfig);
      expect(result.findings.some((f) => f.type === 'anthropic_api_key')).toBe(true);
    });
  });

  describe('Private key detection', () => {
    it('should detect RSA private key header', async () => {
      const event = makeEvent('-----BEGIN RSA PRIVATE KEY-----\nMIIE...');
      const result = await piiScanner(event, defaultConfig);
      expect(result.findings.some((f) => f.type === 'private_key')).toBe(true);
    });
  });

  describe('No false positives', () => {
    it('should allow clean text with no PII', async () => {
      const event = makeEvent('This is a normal message with no sensitive data.');
      const result = await piiScanner(event, defaultConfig);
      expect(result.verdict).toBe('allow');
      expect(result.findings.length).toBe(0);
    });
  });

  describe('Redaction', () => {
    it('should redact value showing first 2 and last 2 chars', () => {
      expect(redactValue('123-45-6789')).toBe('12*******89');
    });

    it('should redact short values', () => {
      expect(redactValue('ab')).toBe('****');
    });
  });

  describe('Luhn check', () => {
    it('should validate correct Luhn number', () => {
      expect(luhnCheck('4532015112830366')).toBe(true);
    });

    it('should reject incorrect Luhn number', () => {
      expect(luhnCheck('4532015112830367')).toBe(false);
    });
  });

  describe('IBAN validation', () => {
    it('should validate correct IBAN', () => {
      expect(validateIBAN('GB29NWBK60161331926819')).toBe(true);
    });

    it('should reject invalid IBAN', () => {
      expect(validateIBAN('GB29NWBK60161331926810')).toBe(false);
    });
  });

  describe('False positive regression - Claude Code requests', () => {
    it('should NOT block a realistic Claude Code request body', async () => {
      const event = makeRawBodyEvent({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        system: 'You are a helpful assistant.',
        messages: [
          { role: 'user', content: 'Please read the file src/config.ts and explain it.' },
          { role: 'assistant', content: [{ type: 'text', text: "I'll read that file for you." }] },
          {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                content:
                  'export const DEFAULT_TOKEN_LIMIT = 8192;\nexport const SECRET_STORE_PATH = "~/.config/secrets";\nconst password_hash_rounds = 12;',
              },
            ],
          },
        ],
        tools: [
          { name: 'read_file', description: 'Read a file', input_schema: { type: 'object' } },
        ],
        stream: true,
      });
      const result = await piiScanner(event, defaultConfig);
      expect(result.verdict).toBe('allow');
    });

    it('should NOT trigger on JSON keys like "token", "secret" in body metadata', async () => {
      const event = makeRawBodyEvent({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        messages: [{ role: 'user', content: 'Hello, how are you?' }],
      });
      const result = await piiScanner(event, defaultConfig);
      expect(result.verdict).toBe('allow');
      expect(result.findings.length).toBe(0);
    });

    it('should still detect real passwords in file_write events', async () => {
      const event = makeEvent('password=MyS3cretP@ssw0rd123', 'file_write');
      const result = await piiScanner(event, defaultConfig);
      expect(result.findings.some((f) => f.type === 'password_field')).toBe(true);
      expect(result.verdict).not.toBe('allow');
    });

    it('should still detect real passwords in message content', async () => {
      const event = makeEvent('Here is my password: MyS3cretP@ssw0rd');
      const result = await piiScanner(event, defaultConfig);
      expect(result.findings.some((f) => f.type === 'password_field')).toBe(true);
    });
  });

  describe('excludeContexts', () => {
    it('should skip scanning when event type is in excludeContexts', async () => {
      const configWithExclude: PIIConfig = { ...defaultConfig, excludeContexts: ['llm_request'] };
      const event = makeEvent('My SSN is 123-45-6789');
      const result = await piiScanner(event, configWithExclude);
      expect(result.verdict).toBe('allow');
      expect(result.findings.length).toBe(0);
    });

    it('should still scan non-excluded event types', async () => {
      const configWithExclude: PIIConfig = { ...defaultConfig, excludeContexts: ['llm_request'] };
      const event = makeEvent('My SSN is 123-45-6789', 'file_write');
      const result = await piiScanner(event, configWithExclude);
      expect(result.findings.some((f) => f.type === 'ssn_us')).toBe(true);
    });
  });
});
