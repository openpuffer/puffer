import type { PufferConfig, DiscoveryResult } from '../types.js';

export interface ScoreBreakdown {
  coverage: { score: number; max: 30; details: string };
  exposure: { score: number; max: 20; details: string };
  policy: { score: number; max: 20; details: string };
  activity: { score: number; max: 15; details: string };
  monitoring: { score: number; max: 15; details: string };
}

export interface PufferScore {
  total: number;          // 0-100
  grade: string;          // A+ / A / B / C / D / F
  label: string;          // EXCELLENT / GOOD / FAIR / POOR / CRITICAL
  breakdown: ScoreBreakdown;
  recommendations: string[];
}

export interface AuditStats {
  total: number;
  blocked: number;
  allowed: number;
  audit: number;
  escalated: number;
}

const MODE_SCORES: Record<string, number> = {
  monitor: 0.3,
  enforce: 0.7,
  paranoid: 1.0,
  interactive: 0.8,
};

function gradeFromScore(score: number): { grade: string; label: string } {
  if (score >= 90) return { grade: 'A+', label: 'EXCELLENT' };
  if (score >= 80) return { grade: 'A', label: 'VERY GOOD' };
  if (score >= 70) return { grade: 'B', label: 'GOOD' };
  if (score >= 55) return { grade: 'C', label: 'FAIR' };
  if (score >= 35) return { grade: 'D', label: 'POOR' };
  return { grade: 'F', label: 'CRITICAL' };
}

export function calculateScore(
  config: PufferConfig,
  discovery: DiscoveryResult,
  auditStats: AuditStats,
): PufferScore {
  const recommendations: string[] = [];

  // === COVERAGE (30 pts): protected agents / total agents ===
  const totalAgents = discovery.agents.length;
  const protectedAgents = discovery.agents.filter(a => a.protectionStatus === 'protected').length;
  const partialAgents = discovery.agents.filter(a => a.protectionStatus === 'partial').length;
  let coverageScore: number;
  let coverageDetails: string;

  if (totalAgents === 0) {
    coverageScore = 15; // No agents found = neutral (half points)
    coverageDetails = 'No AI agents detected on this system';
    recommendations.push('Run AI agents so Puffer can protect them');
  } else {
    const coverageRatio = (protectedAgents + partialAgents * 0.5) / totalAgents;
    coverageScore = Math.round(coverageRatio * 30);
    const unprotected = totalAgents - protectedAgents - partialAgents;
    coverageDetails = `${protectedAgents}/${totalAgents} agents protected` +
      (partialAgents > 0 ? `, ${partialAgents} partial` : '') +
      (unprotected > 0 ? `, ${unprotected} unprotected` : '');
    if (unprotected > 0) {
      recommendations.push(`Protect ${unprotected} unprotected agent(s) — run 'puffer init'`);
    }
  }

  // === EXPOSURE (20 pts): security warnings (0.0.0.0 bindings, etc.) ===
  const warningPenalty = Math.min(discovery.securityWarnings.length * 5, 20);
  const exposureScore = 20 - warningPenalty;
  const exposureDetails = discovery.securityWarnings.length === 0
    ? 'No security warnings detected'
    : `${discovery.securityWarnings.length} warning(s): exposed services`;
  if (discovery.securityWarnings.length > 0) {
    recommendations.push('Fix exposed services bound to 0.0.0.0 — restrict to 127.0.0.1');
  }

  // === POLICY (20 pts): layers enabled (10) + mode strength (10) ===
  const layerNames = ['pii', 'injection', 'commands', 'network', 'filesystem', 'behavior', 'mcp'] as const;
  const enabledLayers = layerNames.filter(name => {
    const layerConfig = config.layers[name] as { enabled?: boolean };
    return layerConfig?.enabled !== false;
  });
  const layerScore = Math.round((enabledLayers.length / 7) * 10);
  const modeScore = Math.round((MODE_SCORES[config.mode] ?? 0.3) * 10);
  const policyScore = layerScore + modeScore;
  const policyDetails = `${enabledLayers.length}/7 layers active, mode: ${config.mode}`;
  if (enabledLayers.length < 7) {
    const disabled = layerNames.filter(n => !enabledLayers.includes(n));
    recommendations.push(`Enable disabled layers: ${disabled.join(', ')}`);
  }
  if (config.mode === 'monitor') {
    recommendations.push("Switch from 'monitor' to 'enforce' mode for active protection");
  }

  // === ACTIVITY (15 pts): based on event volume and block effectiveness ===
  let activityScore: number;
  let activityDetails: string;
  if (auditStats.total === 0) {
    activityScore = 0;
    activityDetails = 'No events recorded yet';
    recommendations.push('Start using AI agents — Puffer will track activity');
  } else {
    const blockRate = auditStats.blocked / auditStats.total;
    // Low block rate = good (most things are safe), moderate = healthy detection
    // Very high block rate = either very strict or under attack
    const volumePoints = Math.min(auditStats.total / 100, 1) * 8; // up to 8 pts for having activity
    const detectionPoints = blockRate > 0 ? Math.min(blockRate * 30, 7) : 0; // up to 7 pts for catching threats
    activityScore = Math.round(volumePoints + detectionPoints);
    activityDetails = `${auditStats.total} events, ${auditStats.blocked} blocked (${(blockRate * 100).toFixed(1)}%)`;
  }

  // === MONITORING (15 pts): dashboard + audit + alerts configured ===
  let monitoringScore = 0;
  const monitoringParts: string[] = [];

  if (config.dashboard?.enabled) {
    monitoringScore += 5;
    monitoringParts.push('dashboard');
  } else {
    recommendations.push('Enable the dashboard for real-time monitoring');
  }

  if (config.audit?.logPath) {
    monitoringScore += 5;
    monitoringParts.push('audit log');
  }

  if (config.alerts?.webhook) {
    monitoringScore += 5;
    monitoringParts.push('webhook alerts');
  } else {
    recommendations.push('Configure webhook alerts for critical events');
  }

  const monitoringDetails = monitoringParts.length > 0
    ? `Active: ${monitoringParts.join(', ')}`
    : 'No monitoring configured';

  // === TOTAL ===
  const total = Math.min(
    coverageScore + exposureScore + policyScore + activityScore + monitoringScore,
    100,
  );

  const { grade, label } = gradeFromScore(total);

  return {
    total,
    grade,
    label,
    breakdown: {
      coverage: { score: coverageScore, max: 30, details: coverageDetails },
      exposure: { score: exposureScore, max: 20, details: exposureDetails },
      policy: { score: policyScore, max: 20, details: policyDetails },
      activity: { score: activityScore, max: 15, details: activityDetails },
      monitoring: { score: monitoringScore, max: 15, details: monitoringDetails },
    },
    recommendations: recommendations.slice(0, 5), // Top 5 recommendations
  };
}
