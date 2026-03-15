import { describe, it, expect } from 'vitest';
import { scanForPII, redactText, redactValue } from '../../extension/src/scanner/pii.js';

describe('Extension PII Scanner', () => {
  describe('US SSN Detection', () => {
    it('detects SSN with dashes', () => {
      const matches = scanForPII('My SSN is 123-45-6789');
      expect(matches.some(m => m.type === 'US SSN')).toBe(true);
    });

    it('detects SSN with spaces', () => {
      const matches = scanForPII('SSN: 123 45 6789');
      expect(matches.some(m => m.type === 'US SSN (spaces)')).toBe(true);
    });

    it('rejects invalid SSN (000 area)', () => {
      const matches = scanForPII('000-12-3456');
      expect(matches.filter(m => m.type.startsWith('US SSN'))).toHaveLength(0);
    });
  });

  describe('Credit Card Detection', () => {
    it('detects valid Visa', () => {
      const matches = scanForPII('Card: 4111111111111111');
      expect(matches.some(m => m.type === 'Credit Card')).toBe(true);
    });

    it('detects formatted Visa', () => {
      const matches = scanForPII('Card: 4111 1111 1111 1111');
      expect(matches.some(m => m.type.startsWith('Credit Card'))).toBe(true);
    });

    it('rejects invalid Luhn', () => {
      const matches = scanForPII('4111111111111112');
      expect(matches.filter(m => m.type === 'Credit Card')).toHaveLength(0);
    });
  });

  describe('API Key Detection', () => {
    it('detects OpenAI API key', () => {
      const matches = scanForPII('key: sk-abc123def456ghi789jkl012');
      expect(matches.some(m => m.type === 'OpenAI API Key')).toBe(true);
    });

    it('detects Anthropic API key', () => {
      const matches = scanForPII('key: sk-ant-abc123-def456-ghi789-jkl012');
      expect(matches.some(m => m.type === 'Anthropic API Key')).toBe(true);
    });

    it('detects GitHub PAT', () => {
      const matches = scanForPII('token: ghp_abcdefghijklmnopqrstuvwxyz0123456789');
      expect(matches.some(m => m.type === 'GitHub PAT')).toBe(true);
    });

    it('detects AWS access key', () => {
      const matches = scanForPII('AWS key: AKIAIOSFODNN7EXAMPLE');
      expect(matches.some(m => m.type === 'AWS Access Key')).toBe(true);
    });
  });

  describe('Other PII', () => {
    it('detects email', () => {
      const matches = scanForPII('Contact: user@example.com');
      expect(matches.some(m => m.type === 'Email')).toBe(true);
    });

    it('detects private key header', () => {
      const matches = scanForPII('-----BEGIN RSA PRIVATE KEY-----');
      expect(matches.some(m => m.type === 'Private Key')).toBe(true);
    });

    it('detects JWT token', () => {
      const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc123def456';
      const matches = scanForPII(jwt);
      expect(matches.some(m => m.type === 'JWT Token')).toBe(true);
    });

    it('detects password fields', () => {
      const matches = scanForPII('password=SuperSecret123!');
      expect(matches.some(m => m.type === 'Password')).toBe(true);
    });
  });

  describe('Redaction', () => {
    it('redacts PII in text', () => {
      const text = 'My SSN is 123-45-6789 and email is user@test.com';
      const matches = scanForPII(text);
      const redacted = redactText(text, matches);
      expect(redacted).not.toContain('123-45-6789');
      expect(redacted).toContain('[REDACTED:');
    });

    it('redactValue masks middle', () => {
      expect(redactValue('1234567890')).toBe('12******90');
    });

    it('redactValue handles short strings', () => {
      expect(redactValue('abc')).toBe('****');
    });
  });

  describe('Multiple findings', () => {
    it('detects multiple PII types in one text', () => {
      const text = 'SSN: 123-45-6789, Card: 4111111111111111, Email: test@test.com';
      const matches = scanForPII(text);
      const types = new Set(matches.map(m => m.type));
      expect(types.size).toBeGreaterThanOrEqual(3);
    });
  });
});
