import { describe, it, expect, beforeEach } from 'vitest';
import { behaviorAnalyzer, resetSessions } from '../../src/layers/layer-6-behavior.js';
import { PufferEvent, BehaviorConfig } from '@puffer/core';

function makeEvent(
  overrides: Partial<PufferEvent['metadata']> = {},
  decision: PufferEvent['decision'] = null,
): PufferEvent {
  return {
    id: 'test-1',
    timestamp: new Date().toISOString(),
    source: { type: 'proxy', agent: 'test-agent', provider: 'openai' },
    action: {
      type: 'llm_request',
      method: 'POST',
      endpoint: '/v1/chat/completions',
      body: { message: 'hello' },
    },
    metadata: {
      sessionId: 'sess-1',
      sequenceNumber: 1,
      tokenEstimate: 100,
      costEstimate: 0.01,
      ...overrides,
    },
    layers: [],
    decision,
  };
}

const defaultConfig: BehaviorConfig = {
  enabled: true,
  maxCostPerSessionUsd: 1.0,
  maxCostPerHourUsd: 5.0,
  loopDetection: {
    windowSize: 10,
    similarityThreshold: 0.9,
    consecutiveMatches: 3,
  },
  sensitivity: 'medium',
};

describe('Behavior Analyzer', () => {
  beforeEach(() => {
    resetSessions();
  });

  describe('Cost limits', () => {
    it('should block when session cost exceeds limit', async () => {
      const config: BehaviorConfig = { ...defaultConfig, maxCostPerSessionUsd: 0.05 };

      // Send enough events to exceed cost
      for (let i = 0; i < 5; i++) {
        await behaviorAnalyzer(makeEvent({ costEstimate: 0.02 }), config);
      }

      const result = await behaviorAnalyzer(makeEvent({ costEstimate: 0.02 }), config);
      expect(result.verdict).toBe('block');
      expect(result.findings.some((f) => f.type === 'cost_limit_exceeded')).toBe(true);
    });
  });

  describe('Loop detection', () => {
    it('should detect repeated identical actions', async () => {
      const config: BehaviorConfig = {
        ...defaultConfig,
        maxCostPerSessionUsd: 100,
        loopDetection: {
          windowSize: 10,
          similarityThreshold: 0.9,
          consecutiveMatches: 3,
        },
      };

      const event = makeEvent({ costEstimate: 0 });

      // Send identical events
      await behaviorAnalyzer(event, config);
      await behaviorAnalyzer(event, config);
      const result = await behaviorAnalyzer(event, config);

      expect(result.findings.some((f) => f.type === 'loop_detected')).toBe(true);
    });
  });

  describe('Normal behavior', () => {
    it('should allow normal behavior', async () => {
      const event = makeEvent({ costEstimate: 0.001 });
      const result = await behaviorAnalyzer(event, defaultConfig);
      expect(result.verdict).toBe('allow');
      expect(result.findings).toHaveLength(0);
    });
  });

  describe('Consecutive block detection', () => {
    it('should flag after 3+ consecutive blocks', async () => {
      const config: BehaviorConfig = { ...defaultConfig, maxCostPerSessionUsd: 100 };

      // Send events with BLOCK decisions
      await behaviorAnalyzer(makeEvent({ costEstimate: 0, sequenceNumber: 1 }, 'BLOCK'), config);
      await behaviorAnalyzer(makeEvent({ costEstimate: 0, sequenceNumber: 2 }, 'BLOCK'), config);
      const result = await behaviorAnalyzer(
        makeEvent({ costEstimate: 0, sequenceNumber: 3 }, 'BLOCK'),
        config,
      );

      expect(result.findings.some((f) => f.type === 'consecutive_blocks')).toBe(true);
    });
  });
});
