import { describe, it, expect } from 'vitest';
import { networkEgressGuard } from '../../src/layers/layer-4-network.js';
import { PufferEvent, NetworkConfig } from '@puffer/core';

function makeEvent(
  url: string,
  provider = 'openai',
  type: 'network_request' | 'llm_request' = 'network_request',
  body?: unknown,
): PufferEvent {
  const action =
    type === 'network_request'
      ? { type: 'network_request' as const, url, method: 'GET', body }
      : { type: 'llm_request' as const, method: 'POST', endpoint: url, body: body ?? {} };

  return {
    id: 'test-1',
    timestamp: new Date().toISOString(),
    source: { type: 'proxy', agent: 'test-agent', provider },
    action,
    metadata: { sessionId: 'sess-1', sequenceNumber: 1 },
    layers: [],
    decision: null,
  };
}

const defaultConfig: NetworkConfig = {
  enabled: true,
  mode: 'blacklist',
  allowedDomains: [],
  blockedDomains: [],
  blockPrivateIps: true,
  maxPayloadSizeMb: 10,
  scanPayloadForPii: false,
};

describe('Network Egress Guard', () => {
  describe('Private IP blocking', () => {
    it('should block 10.x private IPs', async () => {
      const event = makeEvent('http://10.0.0.1/api/data');
      const result = await networkEgressGuard(event, defaultConfig);
      expect(result.verdict).toBe('block');
      expect(result.findings.some((f) => f.type === 'private_ip')).toBe(true);
    });

    it('should block 192.168.x private IPs', async () => {
      const event = makeEvent('http://192.168.1.1/admin');
      const result = await networkEgressGuard(event, defaultConfig);
      expect(result.verdict).toBe('block');
      expect(result.findings.some((f) => f.type === 'private_ip')).toBe(true);
    });

    it('should block 127.x loopback IPs', async () => {
      const event = makeEvent('http://127.0.0.1:8080/secret');
      const result = await networkEgressGuard(event, defaultConfig);
      expect(result.verdict).toBe('block');
      expect(result.findings.some((f) => f.type === 'private_ip')).toBe(true);
    });

    it('should allow private IPs for local providers', async () => {
      const event = makeEvent('http://127.0.0.1:11434/api/generate', 'ollama-local');
      const result = await networkEgressGuard(event, defaultConfig);
      expect(result.verdict).toBe('allow');
    });
  });

  describe('Whitelist mode', () => {
    it('should block domains not in whitelist', async () => {
      const config: NetworkConfig = {
        ...defaultConfig,
        mode: 'whitelist',
        allowedDomains: ['api.openai.com', '*.anthropic.com'],
      };
      const event = makeEvent('https://evil.com/exfil');
      const result = await networkEgressGuard(event, config);
      expect(result.verdict).toBe('block');
      expect(result.findings.some((f) => f.type === 'domain_not_whitelisted')).toBe(true);
    });

    it('should allow whitelisted domains', async () => {
      const config: NetworkConfig = {
        ...defaultConfig,
        mode: 'whitelist',
        allowedDomains: ['api.openai.com'],
        blockPrivateIps: false,
      };
      const event = makeEvent('https://api.openai.com/v1/chat/completions');
      const result = await networkEgressGuard(event, config);
      expect(result.verdict).toBe('allow');
    });
  });

  describe('Blacklist mode', () => {
    it('should block blacklisted domains', async () => {
      const config: NetworkConfig = {
        ...defaultConfig,
        mode: 'blacklist',
        blockedDomains: ['evil.com', '*.malware.org'],
        blockPrivateIps: false,
      };
      const event = makeEvent('https://evil.com/payload');
      const result = await networkEgressGuard(event, config);
      expect(result.verdict).toBe('block');
      expect(result.findings.some((f) => f.type === 'domain_blacklisted')).toBe(true);
    });

    it('should allow non-blacklisted domains', async () => {
      const config: NetworkConfig = {
        ...defaultConfig,
        mode: 'blacklist',
        blockedDomains: ['evil.com'],
        blockPrivateIps: false,
      };
      const event = makeEvent('https://api.openai.com/v1/chat');
      const result = await networkEgressGuard(event, config);
      expect(result.verdict).toBe('allow');
    });
  });

  describe('DGA domain detection', () => {
    it('should detect DGA-like domains', async () => {
      const config: NetworkConfig = { ...defaultConfig, blockPrivateIps: false };
      const event = makeEvent('https://xk7mq9brt3np.com/callback');
      const result = await networkEgressGuard(event, config);
      expect(result.findings.some((f) => f.type === 'dga_domain')).toBe(true);
    });
  });

  describe('Clean requests', () => {
    it('should allow clean requests', async () => {
      const config: NetworkConfig = { ...defaultConfig, blockPrivateIps: false };
      const event = makeEvent('https://api.github.com/repos');
      const result = await networkEgressGuard(event, config);
      expect(result.verdict).toBe('allow');
    });
  });

  describe('Non-network events', () => {
    it('should pass through non-network events', async () => {
      const event: PufferEvent = {
        id: 'test-1',
        timestamp: new Date().toISOString(),
        source: { type: 'hook', agent: 'test-agent', provider: 'local' },
        action: { type: 'command_execute', command: 'ls', args: ['-la'] },
        metadata: { sessionId: 'sess-1', sequenceNumber: 1 },
        layers: [],
        decision: null,
      };
      const result = await networkEgressGuard(event, defaultConfig);
      expect(result.verdict).toBe('allow');
      expect(result.details).toBe('Not applicable to this event type');
    });
  });
});
