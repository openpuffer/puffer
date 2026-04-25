import type { PufferEvent, LayerResult, Finding, Verdict, PIIConfig } from '@puffer/core';
import { extractUserContentFromEvent, getMaxSeverity, allowResult } from './helpers.js';

export interface PIIPattern {
  name: string;
  pattern: RegExp;
  severity: 'critical' | 'high' | 'medium' | 'low';
  region: string;
  validate?: (match: string) => boolean;
}

export function luhnCheck(num: string): boolean {
  const digits = num.replace(/\D/g, '');
  let sum = 0;
  let alternate = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = parseInt(digits.charAt(i), 10);
    if (alternate) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alternate = !alternate;
  }
  return sum % 10 === 0;
}

export function validateIBAN(iban: string): boolean {
  const cleaned = iban.replace(/\s/g, '').toUpperCase();
  if (cleaned.length < 15 || cleaned.length > 34) return false;
  const rearranged = cleaned.slice(4) + cleaned.slice(0, 4);
  const numericStr = rearranged
    .split('')
    .map((ch) => {
      const code = ch.charCodeAt(0);
      return code >= 65 && code <= 90 ? (code - 55).toString() : ch;
    })
    .join('');
  let remainder = numericStr;
  while (remainder.length > 2) {
    const block = remainder.slice(0, 9);
    remainder = (parseInt(block, 10) % 97).toString() + remainder.slice(block.length);
  }
  return parseInt(remainder, 10) % 97 === 1;
}

export function redactValue(value: string): string {
  if (value.length <= 4) return '****';
  const first = value.slice(0, 2);
  const last = value.slice(-2);
  const middle = '*'.repeat(Math.min(value.length - 4, 20));
  return `${first}${middle}${last}`;
}

export const PII_PATTERNS: PIIPattern[] = [
  {
    name: 'ssn_us',
    pattern: /\b(?!000|666|9\d{2})\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/g,
    severity: 'critical',
    region: 'us',
    validate: (match: string) => {
      const [area = NaN] = match.split('-').map(Number);
      return area >= 1 && area <= 899 && area !== 666;
    },
  },
  {
    name: 'ssn_us',
    pattern: /\b(?!000|666|9\d{2})\d{3}\s(?!00)\d{2}\s(?!0000)\d{4}\b/g,
    severity: 'critical',
    region: 'us',
    validate: (match: string) => {
      const [area = NaN] = match.split(/\s+/).map(Number);
      return area >= 1 && area <= 899 && area !== 666;
    },
  },
  {
    name: 'credit_card',
    pattern:
      /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|6(?:011|5[0-9]{2})[0-9]{12})\b/g,
    severity: 'critical',
    region: 'global',
    validate: (match: string) => luhnCheck(match),
  },
  {
    name: 'credit_card',
    pattern:
      /\b(?:4[0-9]{3}[\s-]?[0-9]{4}[\s-]?[0-9]{4}[\s-]?[0-9]{4}|5[1-5][0-9]{2}[\s-]?[0-9]{4}[\s-]?[0-9]{4}[\s-]?[0-9]{4}|3[47][0-9]{2}[\s-]?[0-9]{6}[\s-]?[0-9]{5})\b/g,
    severity: 'critical',
    region: 'global',
    validate: (match: string) => luhnCheck(match.replace(/[\s-]/g, '')),
  },
  {
    name: 'email',
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
    severity: 'medium',
    region: 'global',
  },
  {
    name: 'phone_us',
    pattern: /\b(?:\+?1[-.\s]?)?\(?[2-9]\d{2}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
    severity: 'medium',
    region: 'us',
  },
  {
    name: 'aws_access_key',
    pattern: /\bAKIA[A-Z0-9]{16}\b/g,
    severity: 'critical',
    region: 'global',
  },
  {
    name: 'openai_api_key',
    pattern: /\bsk-[a-zA-Z0-9]{20,}\b/g,
    severity: 'critical',
    region: 'global',
  },
  {
    name: 'github_pat',
    pattern: /\bghp_[a-zA-Z0-9]{36}\b/g,
    severity: 'critical',
    region: 'global',
  },
  {
    name: 'anthropic_api_key',
    pattern: /\bsk-ant-[a-zA-Z0-9-]{20,}\b/g,
    severity: 'critical',
    region: 'global',
  },
  {
    name: 'private_key',
    pattern: /-----BEGIN\s+(RSA|EC|DSA|OPENSSH)?\s*PRIVATE KEY-----/g,
    severity: 'critical',
    region: 'global',
  },
  {
    name: 'jwt_token',
    pattern: /\beyJ[A-Za-z0-9-_]+\.eyJ[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\b/g,
    severity: 'high',
    region: 'global',
  },
  {
    name: 'private_ip',
    pattern:
      /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})\b/g,
    severity: 'low',
    region: 'global',
  },
  {
    name: 'curp_mx',
    pattern: /\b[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z0-9]\d\b/g,
    severity: 'high',
    region: 'mx',
  },
  {
    name: 'rfc_mx',
    pattern: /\b[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}\b/g,
    severity: 'high',
    region: 'mx',
  },
  {
    name: 'iban',
    pattern: /\b[A-Z]{2}\d{2}[A-Z0-9]{4,30}\b/g,
    severity: 'high',
    region: 'eu',
    validate: (match: string) => validateIBAN(match),
  },
  {
    name: 'password_field',
    pattern: /(?:password|passwd|pwd)[\s]*[=:]\s*['"]?[^\s'"]{8,}/gi,
    severity: 'high',
    region: 'global',
    validate: (match: string) => {
      // Reject common code/config patterns that aren't real password leaks
      if (
        /password_hash|password_reset|password_confirm|password_field|password_policy|password_strength|password_min/i.test(
          match,
        )
      )
        return false;
      return true;
    },
  },
];

export async function piiScanner(event: PufferEvent, config: PIIConfig): Promise<LayerResult> {
  const start = Date.now();

  if (!config.enabled) {
    return allowResult(1, 'pii-scanner');
  }

  // Skip scanning for excluded event contexts
  if (config.excludeContexts?.length && config.excludeContexts.includes(event.action.type)) {
    return allowResult(1, 'pii-scanner');
  }

  const text = extractUserContentFromEvent(event);
  if (!text) {
    return allowResult(1, 'pii-scanner');
  }

  const findings: Finding[] = [];

  // Run built-in patterns
  for (const piiPattern of PII_PATTERNS) {
    if (piiPattern.region !== 'global' && !config.regions.includes(piiPattern.region)) {
      continue;
    }

    const regex = new RegExp(piiPattern.pattern.source, piiPattern.pattern.flags);
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      const value = match[0];

      if (piiPattern.validate && !piiPattern.validate(value)) {
        continue;
      }

      findings.push({
        type: piiPattern.name,
        severity: piiPattern.severity,
        location: `offset:${match.index}`,
        value: redactValue(value),
        suggestion: `Redact or remove detected ${piiPattern.name}`,
      });
    }
  }

  // Run custom patterns
  if (config.customPatterns) {
    for (const custom of config.customPatterns) {
      try {
        const regex = new RegExp(custom.pattern, 'gi');
        let match: RegExpExecArray | null;
        while ((match = regex.exec(text)) !== null) {
          findings.push({
            type: custom.name,
            severity: custom.severity as Finding['severity'],
            location: `offset:${match.index}`,
            value: redactValue(match[0]),
            suggestion: `Redact or remove detected ${custom.name}`,
          });
        }
      } catch {
        // Skip invalid custom patterns
      }
    }
  }

  const durationMs = Date.now() - start;

  if (findings.length === 0) {
    return {
      layer: 1,
      name: 'pii-scanner',
      verdict: 'allow',
      confidence: 1.0,
      details: 'No PII detected',
      findings: [],
      durationMs,
    };
  }

  const maxSeverity = getMaxSeverity(findings) || 'low';
  const verdict: Verdict = config.actionBySeverity[maxSeverity] || 'audit';

  return {
    layer: 1,
    name: 'pii-scanner',
    verdict,
    confidence: Math.min(0.5 + findings.length * 0.1, 1.0),
    details: `Detected ${findings.length} PII occurrence(s) with max severity: ${maxSeverity}`,
    findings,
    durationMs,
  };
}
