import { PufferEvent, LayerResult, Finding, BehaviorConfig } from '../types.js';
import { allowResult } from './helpers.js';

interface SessionState {
  startTime: number;
  eventCount: number;
  totalTokens: number;
  totalCost: number;
  recentActions: string[];
  commandHistory: string[];
  blockedCount: number;
}

const sessions = new Map<string, SessionState>();

export function resetSessions(): void {
  sessions.clear();
}

function stringSimilarity(a: string, b: string): number {
  if (a === b) return 1.0;
  if (a.length === 0 || b.length === 0) return 0.0;

  const maxLen = Math.max(a.length, b.length);
  let matches = 0;
  const minLen = Math.min(a.length, b.length);
  for (let i = 0; i < minLen; i++) {
    if (a[i] === b[i]) matches++;
  }
  return matches / maxLen;
}

function getOrCreateSession(sessionId: string): SessionState {
  let state = sessions.get(sessionId);
  if (!state) {
    state = {
      startTime: Date.now(),
      eventCount: 0,
      totalTokens: 0,
      totalCost: 0,
      recentActions: [],
      commandHistory: [],
      blockedCount: 0,
    };
    sessions.set(sessionId, state);
  }
  return state;
}

export async function behaviorAnalyzer(
  event: PufferEvent,
  config: BehaviorConfig,
): Promise<LayerResult> {
  const start = Date.now();

  if (!config.enabled) {
    return allowResult(6, 'behavior_analyzer');
  }

  const sessionId = event.metadata.sessionId;
  const state = getOrCreateSession(sessionId);

  state.eventCount++;
  if (event.metadata.tokenEstimate) {
    state.totalTokens += event.metadata.tokenEstimate;
  }
  if (event.metadata.costEstimate) {
    state.totalCost += event.metadata.costEstimate;
  }

  const findings: Finding[] = [];

  // Cost limit check
  if (state.totalCost > config.maxCostPerSessionUsd) {
    findings.push({
      type: 'cost_limit_exceeded',
      severity: 'critical',
      location: sessionId,
      value: `$${state.totalCost.toFixed(4)}`,
      suggestion: `Session cost $${state.totalCost.toFixed(4)} exceeds limit of $${config.maxCostPerSessionUsd}`,
    });
  }

  // Hourly rate check
  const elapsedMs = Date.now() - state.startTime;
  const elapsedHours = elapsedMs / (1000 * 60 * 60);
  if (elapsedHours > 0) {
    const hourlyRate = state.totalCost / elapsedHours;
    if (hourlyRate > config.maxCostPerHourUsd && state.totalCost > 0) {
      findings.push({
        type: 'hourly_rate_exceeded',
        severity: 'high',
        location: sessionId,
        value: `$${hourlyRate.toFixed(4)}/hr`,
        suggestion: `Hourly cost rate $${hourlyRate.toFixed(4)} exceeds limit of $${config.maxCostPerHourUsd}/hr`,
      });
    }
  }

  // Loop detection
  const actionStr = JSON.stringify(event.action).slice(0, 200);
  state.recentActions.push(actionStr);

  const windowSize = config.loopDetection.windowSize;
  if (state.recentActions.length > windowSize) {
    state.recentActions = state.recentActions.slice(-windowSize);
  }

  const consecutiveMatches = config.loopDetection.consecutiveMatches;
  if (state.recentActions.length >= consecutiveMatches) {
    const lastN = state.recentActions.slice(-consecutiveMatches);
    let allSimilar = true;
    for (let i = 1; i < lastN.length; i++) {
      if (stringSimilarity(lastN[0], lastN[i]) < config.loopDetection.similarityThreshold) {
        allSimilar = false;
        break;
      }
    }
    if (allSimilar) {
      findings.push({
        type: 'loop_detected',
        severity: 'high',
        location: sessionId,
        value: `${consecutiveMatches} consecutive similar actions`,
        suggestion: 'Agent appears to be stuck in a loop',
      });
    }
  }

  // Consecutive block detection
  if (event.decision === 'BLOCK') {
    state.blockedCount++;
  } else {
    state.blockedCount = 0;
  }

  if (state.blockedCount >= 3) {
    findings.push({
      type: 'consecutive_blocks',
      severity: 'high',
      location: sessionId,
      value: `${state.blockedCount} consecutive blocks`,
      suggestion: 'Agent has been blocked multiple times in a row',
    });
  }

  // Track command history
  if (event.action.type === 'command_execute') {
    state.commandHistory.push(event.action.command);
  }

  const durationMs = Date.now() - start;

  if (findings.length === 0) {
    return {
      layer: 6,
      name: 'behavior_analyzer',
      verdict: 'allow',
      confidence: 1.0,
      details: `Behavior normal: session ${sessionId}, ${state.eventCount} events, $${state.totalCost.toFixed(4)} cost`,
      findings: [],
      durationMs,
    };
  }

  const hasCritical = findings.some((f) => f.severity === 'critical');

  return {
    layer: 6,
    name: 'behavior_analyzer',
    verdict: hasCritical ? 'block' : 'escalate',
    confidence: hasCritical ? 1.0 : 0.85,
    details: `Behavior analysis: ${findings.length} finding(s) for session ${sessionId}`,
    findings,
    durationMs,
  };
}
