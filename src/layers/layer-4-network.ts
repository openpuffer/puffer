import { PufferEvent, LayerResult, Finding, NetworkConfig } from '../types.js';
import { allowResult } from './helpers.js';

const PRIVATE_IP_RANGES: RegExp[] = [
  /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,
  /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/,
  /^192\.168\.\d{1,3}\.\d{1,3}$/,
  /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,
  /^169\.254\.\d{1,3}\.\d{1,3}$/,
  /^0\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,
  /^fc00:/i,
  /^fe80:/i,
  /^::1$/,
];

function isDGADomain(hostname: string): boolean {
  // Extract the registrable domain (last two parts minus TLD)
  const parts = hostname.split('.');
  if (parts.length < 2) return false;
  const domain = parts[parts.length - 2];
  if (domain.length < 8) return false;

  // Entropy check
  const freq: Record<string, number> = {};
  for (const char of domain) freq[char] = (freq[char] || 0) + 1;
  const len = domain.length;
  const entropy = -Object.values(freq).reduce((sum, count) => {
    const p = count / len;
    return sum + p * Math.log2(p);
  }, 0);
  if (entropy <= 3.5) return false;

  // Has numbers
  if (!/\d/.test(domain)) return false;

  // Consonant ratio
  const consonants = domain.replace(/[aeiou\d\W]/gi, '').length;
  const consonantRatio = consonants / domain.length;
  if (consonantRatio <= 0.65) return false;

  return true;
}

function matchesWildcard(hostname: string, pattern: string): boolean {
  if (pattern.startsWith('*.')) {
    const suffix = pattern.slice(1); // e.g. ".example.com"
    return hostname.endsWith(suffix) || hostname === pattern.slice(2);
  }
  return hostname === pattern;
}

export async function networkEgressGuard(
  event: PufferEvent,
  config: NetworkConfig,
): Promise<LayerResult> {
  const start = Date.now();

  if (event.action.type !== 'network_request' && event.action.type !== 'llm_request') {
    return allowResult(4, 'network_egress');
  }

  const targetUrl =
    event.action.type === 'network_request'
      ? event.action.url
      : event.action.endpoint;

  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    const durationMs = Date.now() - start;
    return {
      layer: 4,
      name: 'network_egress',
      verdict: 'block',
      confidence: 1.0,
      details: `Invalid URL: ${targetUrl}`,
      findings: [
        {
          type: 'invalid_url',
          severity: 'high',
          location: targetUrl,
          suggestion: 'Could not parse target URL',
        },
      ],
      durationMs,
    };
  }

  const hostname = parsed.hostname;
  const findings: Finding[] = [];

  // Private IP check (anti-SSRF)
  if (config.blockPrivateIPs) {
    const isLocal = event.source.provider.includes('local');
    if (!isLocal) {
      for (const range of PRIVATE_IP_RANGES) {
        if (range.test(hostname)) {
          findings.push({
            type: 'private_ip',
            severity: 'critical',
            location: hostname,
            value: hostname,
            suggestion: 'Blocked request to private IP range (anti-SSRF)',
          });
          break;
        }
      }
    }
  }

  // If we already found a critical private IP issue, block immediately
  if (findings.some((f) => f.type === 'private_ip')) {
    const durationMs = Date.now() - start;
    return {
      layer: 4,
      name: 'network_egress',
      verdict: 'block',
      confidence: 1.0,
      details: `Blocked request to private IP: ${hostname}`,
      findings,
      durationMs,
    };
  }

  // Domain filtering
  if (config.mode === 'whitelist') {
    const allowed = config.allowedDomains.some((d) => matchesWildcard(hostname, d));
    if (!allowed) {
      findings.push({
        type: 'domain_not_whitelisted',
        severity: 'high',
        location: hostname,
        value: hostname,
        suggestion: `Domain ${hostname} is not in the allowed list`,
      });
    }
  } else if (config.mode === 'blacklist') {
    const blocked = config.blockedDomains.some((d) => matchesWildcard(hostname, d));
    if (blocked) {
      findings.push({
        type: 'domain_blacklisted',
        severity: 'high',
        location: hostname,
        value: hostname,
        suggestion: `Domain ${hostname} is in the blocked list`,
      });
    }
  }

  // DGA detection
  if (isDGADomain(hostname)) {
    findings.push({
      type: 'dga_domain',
      severity: 'high',
      location: hostname,
      value: hostname,
      suggestion: 'Domain appears to be algorithmically generated (DGA)',
    });
  }

  // Payload size check
  if (config.maxPayloadSizeMb > 0 && event.action.type === 'network_request' && event.action.body) {
    const bodyStr = typeof event.action.body === 'string' ? event.action.body : JSON.stringify(event.action.body);
    const sizeMb = Buffer.byteLength(bodyStr, 'utf-8') / (1024 * 1024);
    if (sizeMb > config.maxPayloadSizeMb) {
      findings.push({
        type: 'payload_too_large',
        severity: 'medium',
        location: hostname,
        value: `${sizeMb.toFixed(2)} MB`,
        suggestion: `Payload size ${sizeMb.toFixed(2)} MB exceeds limit of ${config.maxPayloadSizeMb} MB`,
      });
    }
  }

  const durationMs = Date.now() - start;

  if (findings.length === 0) {
    return {
      layer: 4,
      name: 'network_egress',
      verdict: 'allow',
      confidence: 1.0,
      details: `Network request to ${hostname} allowed`,
      findings: [],
      durationMs,
    };
  }

  const hasCritical = findings.some((f) => f.severity === 'critical');
  const hasHigh = findings.some((f) => f.severity === 'high');

  return {
    layer: 4,
    name: 'network_egress',
    verdict: hasCritical || hasHigh ? 'block' : 'audit',
    confidence: hasCritical ? 1.0 : hasHigh ? 0.9 : 0.7,
    details: `Network egress check: ${findings.length} finding(s) for ${hostname}`,
    findings,
    durationMs,
  };
}
