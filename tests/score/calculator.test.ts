import { describe, it, expect } from 'vitest';
import { calculateScore, type AuditStats } from '../../src/score/calculator.js';
import type { PufferConfig, DiscoveryResult, DiscoveredAgent } from '../../src/types.js';

function makeConfig(overrides: Partial<PufferConfig> = {}): PufferConfig {
  return {
    version: '0.1.0',
    mode: 'enforce',
    providers: [],
    autoDiscovery: { enabled: true, scanIntervalMs: 30000, processScanner: true, portScanner: true, networkScanner: true },
    layers: {
      pii: { enabled: true, regions: ['us'], actionBySeverity: {}, customPatterns: [], excludeContexts: [] },
      injection: { enabled: true, mode: 'heuristic', thresholds: { directInput: { block: 0.65, audit: 0.4 }, externalContent: { block: 0.5, audit: 0.3 } }, heuristics: [] },
      commands: { enabled: true, blockedPatterns: [], requireApproval: [], maxCommandsPerMinute: 60, consecutiveBlockThreshold: 3 },
      network: { enabled: true, mode: 'blacklist', allowedDomains: [], blockedDomains: [], blockPrivateIPs: true, maxPayloadSizeMb: 50, scanPayloadForPII: true },
      filesystem: { enabled: true, forbidden: [], restricted: [], workspace: [], secretPatterns: [] },
      behavior: { enabled: true, maxCostPerSessionUsd: 10, maxCostPerHourUsd: 20, loopDetection: { windowSize: 20, similarityThreshold: 0.85, consecutiveMatches: 5 }, sensitivity: 'medium' },
      mcp: { enabled: true, authorizedServers: [], blockUnauthorized: false, scanToolResults: true },
    },
    dashboard: { enabled: true, port: 8788 },
    audit: { logPath: '~/.puffer/audit.jsonl', retentionDays: 30 },
    alerts: { desktop: true },
    ...overrides,
  } as PufferConfig;
}

function makeAgent(name: string, status: 'protected' | 'unprotected' | 'partial'): DiscoveredAgent {
  return { name, pid: 1000, command: name, detectedVia: 'process', protectionStatus: status };
}

function makeDiscovery(agents: DiscoveredAgent[] = [], warnings: string[] = []): DiscoveryResult {
  return { agents, providers: [], securityWarnings: warnings, newSinceLastScan: [], removedSinceLastScan: [] };
}

const emptyStats: AuditStats = { total: 0, blocked: 0, allowed: 0, audit: 0, escalated: 0 };

describe('Puffer Score Calculator', () => {
  it('returns 0-100 with grade and label', () => {
    const score = calculateScore(makeConfig(), makeDiscovery(), emptyStats);
    expect(score.total).toBeGreaterThanOrEqual(0);
    expect(score.total).toBeLessThanOrEqual(100);
    expect(score.grade).toBeDefined();
    expect(score.label).toBeDefined();
  });

  it('gives full coverage when all agents protected', () => {
    const agents = [makeAgent('claude-code', 'protected'), makeAgent('cursor', 'protected')];
    const score = calculateScore(makeConfig(), makeDiscovery(agents), emptyStats);
    expect(score.breakdown.coverage.score).toBe(30);
  });

  it('gives zero coverage when all agents unprotected', () => {
    const agents = [makeAgent('claude-code', 'unprotected'), makeAgent('cursor', 'unprotected')];
    const score = calculateScore(makeConfig(), makeDiscovery(agents), emptyStats);
    expect(score.breakdown.coverage.score).toBe(0);
  });

  it('gives partial coverage for mixed protection', () => {
    const agents = [makeAgent('claude-code', 'protected'), makeAgent('cursor', 'unprotected')];
    const score = calculateScore(makeConfig(), makeDiscovery(agents), emptyStats);
    expect(score.breakdown.coverage.score).toBe(15); // 1/2 * 30
  });

  it('penalizes security warnings in exposure score', () => {
    const warnings = ['Ollama bound to 0.0.0.0', 'vLLM bound to 0.0.0.0'];
    const score = calculateScore(makeConfig(), makeDiscovery([], warnings), emptyStats);
    expect(score.breakdown.exposure.score).toBe(10); // 20 - 2*5
  });

  it('caps exposure penalty at 0', () => {
    const warnings = Array(10).fill('warning');
    const score = calculateScore(makeConfig(), makeDiscovery([], warnings), emptyStats);
    expect(score.breakdown.exposure.score).toBe(0);
  });

  it('gives higher policy score for enforce vs monitor mode', () => {
    const enforceScore = calculateScore(makeConfig({ mode: 'enforce' }), makeDiscovery(), emptyStats);
    const monitorScore = calculateScore(makeConfig({ mode: 'monitor' }), makeDiscovery(), emptyStats);
    expect(enforceScore.breakdown.policy.score).toBeGreaterThan(monitorScore.breakdown.policy.score);
  });

  it('recommends switching from monitor to enforce', () => {
    const score = calculateScore(makeConfig({ mode: 'monitor' }), makeDiscovery(), emptyStats);
    expect(score.recommendations.some(r => r.includes('enforce'))).toBe(true);
  });

  it('gives activity points when events exist', () => {
    const stats: AuditStats = { total: 500, blocked: 10, allowed: 480, audit: 5, escalated: 5 };
    const score = calculateScore(makeConfig(), makeDiscovery(), stats);
    expect(score.breakdown.activity.score).toBeGreaterThan(0);
  });

  it('gives monitoring points for dashboard and audit', () => {
    const score = calculateScore(makeConfig(), makeDiscovery(), emptyStats);
    expect(score.breakdown.monitoring.score).toBe(10); // dashboard(5) + audit(5), no webhook
  });

  it('gives full monitoring with webhook configured', () => {
    const config = makeConfig({ alerts: { desktop: true, webhook: 'https://hooks.slack.com/test' } });
    const score = calculateScore(config, makeDiscovery(), emptyStats);
    expect(score.breakdown.monitoring.score).toBe(15);
  });

  it('assigns correct grades', () => {
    // Perfect setup: all protected, enforce, all layers, activity, full monitoring
    const agents = [makeAgent('a', 'protected')];
    const config = makeConfig({ mode: 'paranoid', alerts: { desktop: true, webhook: 'https://test' } });
    const stats: AuditStats = { total: 200, blocked: 20, allowed: 170, audit: 5, escalated: 5 };
    const score = calculateScore(config, makeDiscovery(agents), stats);
    expect(score.total).toBeGreaterThanOrEqual(80);
    expect(['A+', 'A']).toContain(score.grade);
  });

  it('never exceeds 100', () => {
    const agents = Array(10).fill(null).map((_, i) => makeAgent(`agent-${i}`, 'protected'));
    const config = makeConfig({ mode: 'paranoid', alerts: { desktop: true, webhook: 'https://test' } });
    const stats: AuditStats = { total: 10000, blocked: 1000, allowed: 8000, audit: 500, escalated: 500 };
    const score = calculateScore(config, makeDiscovery(agents), stats);
    expect(score.total).toBeLessThanOrEqual(100);
  });
});
