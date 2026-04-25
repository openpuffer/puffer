import { describe, it, expect } from 'vitest';
import { networkEgressGuard } from '@puffer/layer-network';
import { makeNetworkEvent, DEFAULT_NETWORK_CONFIG } from './helpers.js';

describe('Network Egress Guard - Adversarial Bypass Tests', () => {
  describe('SSRF bypass via alternative IP representations', () => {
    it('FIXED: decimal IP (2130706433 = 127.0.0.1) now blocked', async () => {
      const event = makeNetworkEvent('http://2130706433/admin');
      const result = await networkEgressGuard(event, DEFAULT_NETWORK_CONFIG);
      expect(result.findings.some((f) => f.type === 'private_ip')).toBe(true);
      expect(result.verdict).toBe('block');
    });

    it('FIXED: octal IP (0177.0.0.1 = 127.0.0.1) blocked', async () => {
      const event = makeNetworkEvent('http://0177.0.0.1/admin');
      const result = await networkEgressGuard(event, DEFAULT_NETWORK_CONFIG);
      expect(result.findings.some((f) => f.type === 'private_ip')).toBe(true);
      expect(result.verdict).toBe('block');
    });

    it('FIXED: IPv6 longform (0:0:0:0:0:0:0:1 = ::1) now blocked', async () => {
      const event = makeNetworkEvent('http://[0:0:0:0:0:0:0:1]:8080/');
      const result = await networkEgressGuard(event, DEFAULT_NETWORK_CONFIG);
      expect(result.findings.some((f) => f.type === 'private_ip')).toBe(true);
      expect(result.verdict).toBe('block');
    });

    it('FIXED: shorthand 127.1 now blocked', async () => {
      const event = makeNetworkEvent('http://127.1/admin');
      const result = await networkEgressGuard(event, DEFAULT_NETWORK_CONFIG);
      expect(result.findings.some((f) => f.type === 'private_ip')).toBe(true);
      expect(result.verdict).toBe('block');
    });
  });

  describe('Standard private IPs still blocked', () => {
    it('should block 127.0.0.1', async () => {
      const event = makeNetworkEvent('http://127.0.0.1:8080/api');
      const result = await networkEgressGuard(event, DEFAULT_NETWORK_CONFIG);
      expect(result.verdict).toBe('block');
      expect(result.findings.some((f) => f.type === 'private_ip')).toBe(true);
    });

    it('should block 10.x.x.x', async () => {
      const event = makeNetworkEvent('http://10.0.0.1/internal');
      const result = await networkEgressGuard(event, DEFAULT_NETWORK_CONFIG);
      expect(result.verdict).toBe('block');
    });

    it('should block 192.168.x.x', async () => {
      const event = makeNetworkEvent('http://192.168.1.1/router');
      const result = await networkEgressGuard(event, DEFAULT_NETWORK_CONFIG);
      expect(result.verdict).toBe('block');
    });

    it('should block 169.254.169.254 (AWS metadata)', async () => {
      const event = makeNetworkEvent('http://169.254.169.254/latest/meta-data/');
      const result = await networkEgressGuard(event, DEFAULT_NETWORK_CONFIG);
      expect(result.verdict).toBe('block');
    });
  });

  describe('DGA detection', () => {
    it('should not flag legitimate domains as DGA', async () => {
      const domains = ['api.github.com', 'stackoverflow.com', 'npmjs.org', 'google.com'];
      for (const domain of domains) {
        const event = makeNetworkEvent(`https://${domain}/path`);
        const result = await networkEgressGuard(event, DEFAULT_NETWORK_CONFIG);
        expect(result.findings.some((f) => f.type === 'dga_domain')).toBe(false);
      }
    });

    it('GAP: short DGA domains (< 8 chars) not detected', async () => {
      const event = makeNetworkEvent('https://xk7mq.com/c2');
      const result = await networkEgressGuard(event, DEFAULT_NETWORK_CONFIG);
      expect(result.findings.some((f) => f.type === 'dga_domain')).toBe(false);
    });
  });

  describe('Domain filtering', () => {
    it('should block blacklisted domains', async () => {
      const config = { ...DEFAULT_NETWORK_CONFIG, blockedDomains: ['evil.com', '*.malware.net'] };
      const event = makeNetworkEvent('https://evil.com/steal');
      const result = await networkEgressGuard(event, config);
      expect(result.verdict).toBe('block');
    });

    it('should block wildcard blacklisted subdomains', async () => {
      const config = { ...DEFAULT_NETWORK_CONFIG, blockedDomains: ['*.malware.net'] };
      const event = makeNetworkEvent('https://c2.malware.net/beacon');
      const result = await networkEgressGuard(event, config);
      expect(result.verdict).toBe('block');
    });
  });

  describe('Payload PII scanning', () => {
    it('should detect PII in outgoing payloads', async () => {
      const event = makeNetworkEvent('https://api.example.com/data', 'POST', {
        message: 'My SSN is 123-45-6789',
      });
      const result = await networkEgressGuard(event, DEFAULT_NETWORK_CONFIG);
      expect(result.findings.some((f) => f.type === 'pii_in_payload')).toBe(true);
    });
  });
});
