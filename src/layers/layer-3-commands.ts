import { PufferEvent, LayerResult, Finding, CommandsConfig } from '../types.js';
import { allowResult } from './helpers.js';

type BinaryClass = 'safe' | 'caution' | 'dangerous' | 'critical';

const BINARY_CLASSIFICATIONS: Record<BinaryClass, string[]> = {
  safe: ['ls', 'cat', 'echo', 'pwd', 'whoami', 'date', 'head', 'tail', 'wc', 'sort', 'uniq', 'diff', 'grep', 'find', 'which', 'file', 'stat', 'tree', 'less', 'more'],
  caution: ['git', 'npm', 'npx', 'yarn', 'pnpm', 'python', 'python3', 'node', 'deno', 'bun', 'cargo', 'go', 'make', 'cmake', 'pip', 'pip3', 'docker', 'docker-compose', 'sed', 'awk'],
  dangerous: ['rm', 'chmod', 'chown', 'kill', 'killall', 'pkill', 'mv', 'cp', 'dd', 'mkfs', 'fdisk', 'mount', 'umount', 'systemctl', 'service'],
  critical: ['sudo', 'su', 'eval', 'exec', 'nc', 'ncat', 'netcat', 'curl', 'wget', 'ssh', 'scp', 'rsync', 'iptables', 'nmap', 'tcpdump', 'strace', 'ltrace', 'gdb'],
};

interface DangerousPattern {
  pattern: RegExp;
  reason: string;
  severity: 'critical' | 'high' | 'medium';
}

const DANGEROUS_PATTERNS: DangerousPattern[] = [
  { pattern: /rm\s+(-[rRf]+\s+)*\/(\s|$)/, reason: 'Recursive delete of root filesystem', severity: 'critical' },
  { pattern: /rm\s+.*-[rRf]*\s+--no-preserve-root/, reason: 'Explicit root deletion bypass', severity: 'critical' },
  { pattern: /:\(\)\s*\{\s*:\|\s*:\s*&\s*\}\s*;?\s*:/, reason: 'Fork bomb detected', severity: 'critical' },
  { pattern: />\s*\/dev\/sd[a-z]/, reason: 'Direct write to block device', severity: 'critical' },
  { pattern: /mkfs\s/, reason: 'Filesystem format command', severity: 'critical' },
  { pattern: /dd\s+.*of=\/dev\//, reason: 'Raw disk write with dd', severity: 'critical' },
  { pattern: /curl\s+.*\|\s*(?:ba)?sh/, reason: 'Piping remote script to shell', severity: 'critical' },
  { pattern: /wget\s+.*\|\s*(?:ba)?sh/, reason: 'Piping remote script to shell', severity: 'critical' },
  { pattern: /curl\s+.*\|\s*sudo/, reason: 'Piping remote content to sudo', severity: 'critical' },
  { pattern: /eval\s*\(?\s*["'`]/, reason: 'Dynamic code evaluation', severity: 'high' },
  { pattern: /chmod\s+[0-7]*7[0-7]*\s/, reason: 'Setting world-executable permissions', severity: 'medium' },
  { pattern: /nc\s+-[elp]/, reason: 'Netcat listener (potential reverse shell)', severity: 'critical' },
  { pattern: />\s*\/etc\//, reason: 'Direct write to /etc/', severity: 'high' },
  { pattern: /python[3]?\s+-c\s+['"].*(?:import\s+(?:os|subprocess|socket))/, reason: 'Python inline with dangerous imports', severity: 'high' },
  { pattern: /base64\s+(?:-d|--decode)\s*\|/, reason: 'Decoding base64 into pipe', severity: 'medium' },
];

const SENSITIVE_PATHS: string[] = [
  '/etc/passwd',
  '/etc/shadow',
  '/etc/sudoers',
  '/etc/ssh/',
  '/root/',
  '~/.ssh/',
  '~/.gnupg/',
  '~/.aws/',
  '~/.config/',
  '/var/log/',
  '/proc/',
  '/sys/',
  '/boot/',
  '/dev/',
];

function classifyBinary(command: string): BinaryClass {
  const binary = command.split(/\s+/)[0].split('/').pop() || '';
  for (const [classification, binaries] of Object.entries(BINARY_CLASSIFICATIONS)) {
    if (binaries.includes(binary)) {
      return classification as BinaryClass;
    }
  }
  return 'caution';
}

export async function commandAnalyzer(
  event: PufferEvent,
  config: CommandsConfig,
): Promise<LayerResult> {
  const start = Date.now();

  if (!config.enabled) {
    return allowResult(3, 'command-analyzer');
  }

  if (event.action.type !== 'command_execute') {
    return allowResult(3, 'command-analyzer');
  }

  const fullCommand = `${event.action.command} ${event.action.args.join(' ')}`.trim();
  const findings: Finding[] = [];

  // Check blocked patterns from config
  for (const pattern of config.blockedPatterns) {
    try {
      const regex = new RegExp(pattern, 'i');
      if (regex.test(fullCommand)) {
        findings.push({
          type: 'blocked_pattern',
          severity: 'critical',
          location: fullCommand,
          value: pattern,
          suggestion: 'Command matches a blocked pattern',
        });
      }
    } catch {
      // Skip invalid patterns
    }
  }

  // Check dangerous patterns
  for (const dp of DANGEROUS_PATTERNS) {
    if (dp.pattern.test(fullCommand)) {
      findings.push({
        type: 'dangerous_pattern',
        severity: dp.severity,
        location: fullCommand,
        value: dp.pattern.source.slice(0, 80),
        suggestion: dp.reason,
      });
    }
  }

  // Check sensitive paths
  for (const sp of SENSITIVE_PATHS) {
    if (fullCommand.includes(sp)) {
      findings.push({
        type: 'sensitive_path',
        severity: 'high',
        location: fullCommand,
        value: sp,
        suggestion: `Command accesses sensitive path: ${sp}`,
      });
    }
  }

  // Classify binary
  const binaryClass = classifyBinary(event.action.command);

  // Check if command requires approval
  for (const pattern of config.requireApproval) {
    try {
      const regex = new RegExp(pattern, 'i');
      if (regex.test(fullCommand)) {
        const durationMs = Date.now() - start;
        return {
          layer: 3,
          name: 'command-analyzer',
          verdict: 'escalate',
          confidence: 0.9,
          details: `Command requires manual approval (matched: ${pattern})`,
          findings: [
            ...findings,
            {
              type: 'requires_approval',
              severity: 'high',
              location: fullCommand,
              value: pattern,
              suggestion: 'This command requires explicit user approval',
            },
          ],
          durationMs,
        };
      }
    } catch {
      // Skip invalid patterns
    }
  }

  const durationMs = Date.now() - start;

  // No findings at all
  if (findings.length === 0 && (binaryClass === 'safe' || binaryClass === 'caution')) {
    return {
      layer: 3,
      name: 'command-analyzer',
      verdict: 'allow',
      confidence: binaryClass === 'safe' ? 1.0 : 0.8,
      details: `Command classified as ${binaryClass}: ${event.action.command}`,
      findings: [],
      durationMs,
    };
  }

  // Determine verdict based on findings severity and binary class
  const hasCritical = findings.some((f) => f.severity === 'critical');
  const hasHigh = findings.some((f) => f.severity === 'high');

  let verdict: LayerResult['verdict'];
  if (hasCritical || binaryClass === 'critical') {
    verdict = 'block';
  } else if (hasHigh || binaryClass === 'dangerous') {
    verdict = 'escalate';
  } else {
    verdict = 'audit';
  }

  return {
    layer: 3,
    name: 'command-analyzer',
    verdict,
    confidence: hasCritical ? 1.0 : hasHigh ? 0.9 : 0.7,
    details: `Command analysis: binary=${binaryClass}, ${findings.length} finding(s)`,
    findings,
    durationMs,
  };
}
