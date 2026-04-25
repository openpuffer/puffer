import { describe, it, expect, beforeEach } from 'vitest';
import { behaviorAnalyzer, resetSessions } from '@puffer/layer-behavior';
import { makeLLMRequestEvent, DEFAULT_BEHAVIOR_CONFIG } from './helpers.js';
import { PufferEvent } from '@puffer/core';

describe('Behavior Analyzer - Adversarial Bypass Tests', () => {
  beforeEach(() => {
    resetSessions();
  });

  describe('Loop detection evasion', () => {
    it('GAP: loop detection compares JSON of action object, so even different body text can match', async () => {
      const config = {
        ...DEFAULT_BEHAVIOR_CONFIG,
        loopDetection: { windowSize: 5, similarityThreshold: 0.85, consecutiveMatches: 3 },
      };

      // The loop detector serializes the entire action and truncates to 200 chars
      // Even different body text still has high similarity because the JSON structure
      // {"type":"llm_request","method":"POST","endpoint":"/v1/chat/completions","body":"..."}
      // is identical — only the body value varies. The JSON overhead dominates similarity.
      // To truly evade, the body must differ dramatically in the first 200 chars
      const events = [
        makeLLMRequestEvent('AAAA', 'loop-sess-3'),
        makeLLMRequestEvent('BBBB', 'loop-sess-3'),
        makeLLMRequestEvent('CCCC', 'loop-sess-3'),
      ];
      for (let i = 0; i < events.length; i++) {
        events[i].metadata.sequenceNumber = i;
        await behaviorAnalyzer(events[i], config);
      }

      const finalEvent = makeLLMRequestEvent('DDDD', 'loop-sess-3');
      finalEvent.metadata.sequenceNumber = 3;
      const result = await behaviorAnalyzer(finalEvent, config);

      // Due to JSON structure overhead, similarity stays above 0.85
      // This means loop detection triggers even for different requests
      // This is actually a FALSE POSITIVE - not a bypass gap
      expect(result.findings.some((f) => f.type === 'loop_detected')).toBe(true);
    });

    it('should detect actual loops with identical actions', async () => {
      const config = {
        ...DEFAULT_BEHAVIOR_CONFIG,
        loopDetection: { windowSize: 5, similarityThreshold: 0.85, consecutiveMatches: 3 },
      };

      for (let i = 0; i < 4; i++) {
        const event = makeLLMRequestEvent('Generate code please', 'loop-sess-2');
        event.metadata.sequenceNumber = i;
        await behaviorAnalyzer(event, config);
      }

      const result = await behaviorAnalyzer(
        makeLLMRequestEvent('Generate code please', 'loop-sess-2'),
        config,
      );
      expect(result.findings.some((f) => f.type === 'loop_detected')).toBe(true);
    });
  });

  describe('Cost limit enforcement', () => {
    it('should block when session cost exceeds limit', async () => {
      const config = { ...DEFAULT_BEHAVIOR_CONFIG, maxCostPerSessionUsd: 0.01 };

      const event = makeLLMRequestEvent('expensive request', 'cost-sess');
      event.metadata.costEstimate = 0.02;
      const result = await behaviorAnalyzer(event, config);
      expect(result.verdict).toBe('block');
      expect(result.findings.some((f) => f.type === 'cost_limit_exceeded')).toBe(true);
    });

    it('should not trigger on zero-cost events', async () => {
      const config = { ...DEFAULT_BEHAVIOR_CONFIG, maxCostPerSessionUsd: 0.01 };

      const event = makeLLMRequestEvent('free request', 'zero-cost-sess');
      event.metadata.costEstimate = 0;
      const result = await behaviorAnalyzer(event, config);
      expect(result.findings.some((f) => f.type === 'cost_limit_exceeded')).toBe(false);
    });
  });

  describe('Consecutive block counter manipulation', () => {
    it('GAP: inserting one ALLOW event resets consecutive block counter', async () => {
      // The counter resets to 0 on any non-BLOCK event
      const event1: PufferEvent = makeLLMRequestEvent('blocked action 1', 'block-sess');
      event1.decision = 'BLOCK';
      await behaviorAnalyzer(event1, DEFAULT_BEHAVIOR_CONFIG);

      const event2: PufferEvent = makeLLMRequestEvent('blocked action 2', 'block-sess');
      event2.decision = 'BLOCK';
      await behaviorAnalyzer(event2, DEFAULT_BEHAVIOR_CONFIG);

      // Insert an ALLOW event to reset counter
      const allowEvent: PufferEvent = makeLLMRequestEvent('allowed action', 'block-sess');
      allowEvent.decision = 'ALLOW';
      await behaviorAnalyzer(allowEvent, DEFAULT_BEHAVIOR_CONFIG);

      // Counter resets, so 2 more blocks won't trigger threshold of 3
      const event3: PufferEvent = makeLLMRequestEvent('blocked again 1', 'block-sess');
      event3.decision = 'BLOCK';
      await behaviorAnalyzer(event3, DEFAULT_BEHAVIOR_CONFIG);

      const event4: PufferEvent = makeLLMRequestEvent('blocked again 2', 'block-sess');
      event4.decision = 'BLOCK';
      const result = await behaviorAnalyzer(event4, DEFAULT_BEHAVIOR_CONFIG);

      // Only 2 consecutive blocks (after reset), threshold is 3 -> not triggered
      expect(result.findings.some((f) => f.type === 'consecutive_blocks')).toBe(false);
    });
  });

  describe('Session state persistence', () => {
    it('GAP: resetSessions clears all state (simulates process restart)', async () => {
      const config = { ...DEFAULT_BEHAVIOR_CONFIG, maxCostPerSessionUsd: 0.05 };

      // Accumulate cost
      const event1 = makeLLMRequestEvent('req1', 'persist-sess');
      event1.metadata.costEstimate = 0.04;
      await behaviorAnalyzer(event1, config);

      // Reset simulates restart
      resetSessions();

      // Cost tracking is lost
      const event2 = makeLLMRequestEvent('req2', 'persist-sess');
      event2.metadata.costEstimate = 0.04;
      const result = await behaviorAnalyzer(event2, config);
      // Would be $0.08 total if state persisted, but after reset it's only $0.04
      expect(result.findings.some((f) => f.type === 'cost_limit_exceeded')).toBe(false);
    });
  });
});
