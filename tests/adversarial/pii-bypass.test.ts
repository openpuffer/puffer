import { describe, it, expect } from 'vitest';
import { piiScanner } from '../../src/layers/layer-1-pii.js';
import { makeLLMRequestEvent, DEFAULT_PII_CONFIG } from './helpers.js';

describe('PII Scanner - Adversarial Bypass Tests', () => {
  describe('Credit card format variations', () => {
    it('FIXED: should detect credit card with spaces', async () => {
      const event = makeLLMRequestEvent('Card: 4532 0151 1283 0366');
      const result = await piiScanner(event, DEFAULT_PII_CONFIG);
      expect(result.findings.some((f) => f.type === 'credit_card')).toBe(true);
    });

    it('FIXED: should detect credit card with dashes', async () => {
      const event = makeLLMRequestEvent('Card: 4532-0151-1283-0366');
      const result = await piiScanner(event, DEFAULT_PII_CONFIG);
      expect(result.findings.some((f) => f.type === 'credit_card')).toBe(true);
    });
  });

  describe('SSN format variations', () => {
    it('GAP: should miss SSN without dashes', async () => {
      const event = makeLLMRequestEvent('SSN: 123456789');
      const result = await piiScanner(event, DEFAULT_PII_CONFIG);
      expect(result.findings.some((f) => f.type === 'ssn_us')).toBe(false);
    });

    it('FIXED: should detect SSN with spaces instead of dashes', async () => {
      const event = makeLLMRequestEvent('SSN: 123 45 6789');
      const result = await piiScanner(event, DEFAULT_PII_CONFIG);
      expect(result.findings.some((f) => f.type === 'ssn_us')).toBe(true);
    });
  });

  describe('Unicode homoglyph bypass', () => {
    it('GAP: should miss SSN with fullwidth digits', async () => {
      // Fullwidth digits: \uFF11\uFF12\uFF13 etc.
      const event = makeLLMRequestEvent(
        'SSN: \uFF11\uFF12\uFF13-\uFF14\uFF15-\uFF16\uFF17\uFF18\uFF19',
      );
      const result = await piiScanner(event, DEFAULT_PII_CONFIG);
      expect(result.findings.some((f) => f.type === 'ssn_us')).toBe(false);
    });
  });

  describe('Obfuscated PII', () => {
    it('GAP: should miss email in obfuscated format', async () => {
      const event = makeLLMRequestEvent('Contact: user [at] example [dot] com');
      const result = await piiScanner(event, DEFAULT_PII_CONFIG);
      expect(result.findings.some((f) => f.type === 'email')).toBe(false);
    });

    it('GAP: should miss API key embedded in base64', async () => {
      const key = 'sk-abc123def456ghi789jklmnopqrst';
      const encoded = Buffer.from(key).toString('base64');
      const event = makeLLMRequestEvent(`Encoded data: ${encoded}`);
      const result = await piiScanner(event, DEFAULT_PII_CONFIG);
      expect(result.findings.some((f) => f.type === 'openai_api_key')).toBe(false);
    });

    it('GAP: should miss short password (7 chars)', async () => {
      const event = makeLLMRequestEvent('password = pa$$w0r');
      const result = await piiScanner(event, DEFAULT_PII_CONFIG);
      expect(result.findings.some((f) => f.type === 'password_field')).toBe(false);
    });
  });

  describe('Existing detection still works', () => {
    it('should detect SSN in standard format', async () => {
      const event = makeLLMRequestEvent('My SSN is 123-45-6789');
      const result = await piiScanner(event, DEFAULT_PII_CONFIG);
      expect(result.findings.some((f) => f.type === 'ssn_us')).toBe(true);
      expect(result.verdict).toBe('block');
    });

    it('should detect credit card as contiguous digits', async () => {
      const event = makeLLMRequestEvent('Card: 4532015112830366');
      const result = await piiScanner(event, DEFAULT_PII_CONFIG);
      expect(result.findings.some((f) => f.type === 'credit_card')).toBe(true);
    });

    it('should detect password with 8+ chars', async () => {
      const event = makeLLMRequestEvent('password = MyStr0ngP@ss');
      const result = await piiScanner(event, DEFAULT_PII_CONFIG);
      expect(result.findings.some((f) => f.type === 'password_field')).toBe(true);
    });
  });
});
