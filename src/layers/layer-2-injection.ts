import { PufferEvent, LayerResult, Finding, InjectionConfig } from '../types.js';
import { extractTextFromEvent, calculateEntropy, allowResult } from './helpers.js';

interface Heuristic {
  name: string;
  pattern: RegExp;
  weight: number;
  severity: 'critical' | 'high' | 'medium' | 'low';
}

const HEURISTICS: Heuristic[] = [
  {
    name: 'role_switching',
    pattern:
      /(?:you are now|act as|pretend to be|forget (?:your|all|previous)|ignore (?:previous|above|all)|disregard (?:your|all|previous)|override (?:your|all)|new instructions?:)/gi,
    weight: 0.8,
    severity: 'high',
  },
  {
    name: 'system_delimiters',
    pattern:
      /(?:\[INST\]|\[\/INST\]|<\|system\|>|<\|user\|>|<\|assistant\|>|###\s*(?:system|instruction|human|assistant)|<\/?(?:system|instruction)>)/gi,
    weight: 0.9,
    severity: 'high',
  },
  {
    name: 'imperative_override',
    pattern:
      /(?:instead,?\s+(?:do|say|output|print|write|execute|run)|do not (?:follow|obey|listen)|stop (?:following|obeying)|(?:always|never) (?:respond|answer|say|output) with)/gi,
    weight: 0.7,
    severity: 'high',
  },
  {
    name: 'data_exfil_instruction',
    pattern:
      /(?:send (?:all|this|the) (?:data|info|content|text|conversation|history) to|forward (?:everything|all|this) to|(?:curl|wget|fetch|post)\s+https?:\/\/)/gi,
    weight: 0.95,
    severity: 'critical',
  },
  {
    name: 'encoding_detection',
    pattern: /(?:base64|atob|btoa|decode|eval)\s*\(|data:text\/[^;]+;base64,/gi,
    weight: 0.6,
    severity: 'medium',
  },
  {
    name: 'hidden_text',
    pattern: /(?:<!--[\s\S]*?-->|[\u200B\u200C\u200D\uFEFF\u2060]|\\u200[bcd])/gi,
    weight: 0.85,
    severity: 'high',
  },
  {
    name: 'prompt_leaking',
    pattern:
      /(?:(?:show|reveal|print|output|display|repeat|echo)\s+(?:your|the|system)\s+(?:prompt|instructions?|rules?|guidelines?|system\s*message))/gi,
    weight: 0.5,
    severity: 'medium',
  },
  {
    name: 'tool_abuse',
    pattern:
      /(?:(?:call|invoke|use|execute|run)\s+(?:the\s+)?(?:tool|function|bash|shell|terminal|command)|execute\s+(?:system|shell)\s+command)/gi,
    weight: 0.7,
    severity: 'high',
  },
];

export async function injectionDetector(
  event: PufferEvent,
  config: InjectionConfig,
): Promise<LayerResult> {
  const start = Date.now();

  if (!config.enabled) {
    return allowResult(2, 'injection-detector');
  }

  const text = extractTextFromEvent(event);
  if (!text) {
    return allowResult(2, 'injection-detector');
  }

  const findings: Finding[] = [];
  let totalScore = 0;

  for (const heuristic of HEURISTICS) {
    const regex = new RegExp(heuristic.pattern.source, heuristic.pattern.flags);
    const matches: string[] = [];
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      matches.push(match[0]);
    }

    if (matches.length > 0) {
      totalScore += heuristic.weight * matches.length;
      findings.push({
        type: heuristic.name,
        severity: heuristic.severity,
        location: 'input_text',
        value: matches[0].slice(0, 100),
        suggestion: `Potential injection pattern: ${heuristic.name} (${matches.length} match(es))`,
      });
    }
  }

  // Entropy check for short, high-entropy text (possible encoded payloads)
  const entropy = calculateEntropy(text);
  if (entropy > 5.5 && text.length < 500) {
    totalScore += 0.4;
    findings.push({
      type: 'high_entropy',
      severity: 'medium',
      location: 'input_text',
      value: `entropy=${entropy.toFixed(2)}`,
      suggestion: 'Unusually high entropy in short text - possible encoded payload',
    });
  }

  const score = Math.min(totalScore / 3.0, 1.0);
  const durationMs = Date.now() - start;

  if (findings.length === 0) {
    return {
      layer: 2,
      name: 'injection-detector',
      verdict: 'allow',
      confidence: 1.0 - score,
      details: 'No injection patterns detected',
      findings: [],
      durationMs,
    };
  }

  // Choose thresholds based on event type
  const isExternalContent =
    event.action.type === 'llm_response' ||
    event.action.type === 'mcp_tool_result';
  const thresholds = isExternalContent
    ? config.thresholds.externalContent
    : config.thresholds.directInput;

  let verdict: LayerResult['verdict'];
  if (score >= thresholds.block) {
    verdict = 'block';
  } else if (score >= thresholds.audit) {
    verdict = 'audit';
  } else {
    verdict = 'allow';
  }

  return {
    layer: 2,
    name: 'injection-detector',
    verdict,
    confidence: score,
    details: `Injection score: ${score.toFixed(3)} (threshold: block=${thresholds.block}, audit=${thresholds.audit}). ${findings.length} heuristic(s) triggered.`,
    findings,
    durationMs,
  };
}
