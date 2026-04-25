import type { PufferEvent, LayerResult, Finding, InjectionConfig } from '@puffer/core';
import {
  extractTextFromEvent,
  extractUserContentFromEvent,
  calculateEntropy,
  allowResult,
} from '@puffer/core';

interface Heuristic {
  name: string;
  pattern: RegExp;
  weight: number;
  severity: 'critical' | 'high' | 'medium' | 'low';
}

export const HEURISTICS: Heuristic[] = [
  {
    name: 'role_switching',
    pattern:
      /(?:you are now|act as|pretend to be|forget (?:your|all|previous)|ignore (?:previous|above|all)|disregard (?:your|all|previous)|override (?:your|all)|new instructions?:|ignora (?:las |tus )?(?:instrucciones|reglas)|olvida (?:tus |las )?(?:instrucciones|reglas)|ahora eres|oublie[zr]? (?:tes|les|vos) (?:instructions|r[eè]gles)|tu es maintenant|vergiss (?:deine |alle )?(?:Anweisungen|Regeln|Instruktionen)|du bist (?:jetzt|nun))/gi,
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
    // The character class enumerates zero-width / invisible Unicode points
    // (ZWSP, ZWNJ, ZWJ, BOM, word joiner) commonly used to hide injection
    // payloads. Each is a single BMP code point — the linter false-positives
    // on visual ambiguity, not on actual misleading surrogate behavior.
    // eslint-disable-next-line no-misleading-character-class
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

  // For LLM requests/responses with structured bodies, extract only user-authored
  // message content to avoid scanning system prompts and tool definitions, which
  // contain injection-like patterns ("ignore previous", "execute command") causing
  // false positives. Falls back to full text extraction for unstructured bodies
  // or non-LLM event types.
  let text = extractUserContentFromEvent(event);
  if (!text) {
    text = extractTextFromEvent(event);
  }
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

    const firstMatch = matches[0];
    if (firstMatch !== undefined) {
      totalScore += heuristic.weight * matches.length;
      findings.push({
        type: heuristic.name,
        severity: heuristic.severity,
        location: 'input_text',
        value: firstMatch.slice(0, 100),
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

  // Normalize score: use max of (weighted average, highest single weight)
  // This ensures a single high-confidence heuristic (e.g., "ignore previous instructions")
  // can still trigger blocking on its own, not be diluted by division
  const maxSingleWeight = findings.reduce((max, f) => {
    const h = HEURISTICS.find((h) => h.name === f.type);
    return h ? Math.max(max, h.weight) : max;
  }, 0);
  const averageScore = totalScore / 3.0;
  const score = Math.min(Math.max(averageScore, maxSingleWeight * 0.9), 1.0);
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
    event.action.type === 'llm_response' || event.action.type === 'mcp_tool_result';
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
