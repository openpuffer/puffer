import * as os from 'os';
import * as path from 'path';
import { minimatch } from 'minimatch';
import { PufferEvent, LayerResult, Finding, FilesystemConfig } from '../types.js';
import { allowResult } from './helpers.js';

function expandPath(filePath: string): string {
  if (filePath.startsWith('~')) {
    return filePath.replace('~', os.homedir());
  }
  return filePath;
}

export async function filesystemSentinel(
  event: PufferEvent,
  config: FilesystemConfig,
): Promise<LayerResult> {
  const start = Date.now();

  if (event.action.type !== 'file_read' && event.action.type !== 'file_write') {
    return allowResult(5, 'filesystem_sentinel');
  }

  const rawPath = event.action.path;
  const resolvedPath = path.resolve(expandPath(rawPath));
  const findings: Finding[] = [];

  // Check forbidden paths
  for (const forbidden of config.forbidden) {
    const expandedForbidden = expandPath(forbidden);
    if (resolvedPath.startsWith(path.resolve(expandedForbidden)) || minimatch(resolvedPath, expandPath(forbidden))) {
      findings.push({
        type: 'forbidden_path',
        severity: 'critical',
        location: resolvedPath,
        value: forbidden,
        suggestion: `Access to forbidden path: ${forbidden}`,
      });
      // Block immediately for forbidden paths
      const durationMs = Date.now() - start;
      return {
        layer: 5,
        name: 'filesystem_sentinel',
        verdict: 'block',
        confidence: 1.0,
        details: `Blocked access to forbidden path: ${resolvedPath}`,
        findings,
        durationMs,
      };
    }
  }

  // Check restricted paths
  for (const restricted of config.restricted) {
    const expandedRestricted = expandPath(restricted);
    if (resolvedPath.startsWith(path.resolve(expandedRestricted)) || minimatch(resolvedPath, expandPath(restricted))) {
      if (event.action.type === 'file_write') {
        findings.push({
          type: 'restricted_path_write',
          severity: 'high',
          location: resolvedPath,
          value: restricted,
          suggestion: `Write to restricted path requires approval: ${restricted}`,
        });
      }
    }
  }

  // Path traversal detection
  if (rawPath.includes('..')) {
    findings.push({
      type: 'path_traversal',
      severity: 'high',
      location: rawPath,
      value: '..',
      suggestion: 'Path contains traversal sequence (..)',
    });
  }

  // Secret pattern scanning on file writes
  if (event.action.type === 'file_write' && event.action.content) {
    for (const pattern of config.secretPatterns) {
      try {
        const regex = new RegExp(pattern, 'i');
        if (regex.test(event.action.content)) {
          findings.push({
            type: 'secret_in_content',
            severity: 'critical',
            location: resolvedPath,
            value: pattern,
            suggestion: `File content matches secret pattern: ${pattern}`,
          });
        }
      } catch {
        // Skip invalid regex patterns
      }
    }
  }

  const durationMs = Date.now() - start;

  if (findings.length === 0) {
    return {
      layer: 5,
      name: 'filesystem_sentinel',
      verdict: 'allow',
      confidence: 1.0,
      details: `Filesystem access allowed: ${resolvedPath}`,
      findings: [],
      durationMs,
    };
  }

  const hasCritical = findings.some((f) => f.severity === 'critical');
  const hasHigh = findings.some((f) => f.severity === 'high');

  let verdict: LayerResult['verdict'];
  if (hasCritical) {
    verdict = 'block';
  } else if (hasHigh) {
    verdict = 'escalate';
  } else {
    verdict = 'audit';
  }

  return {
    layer: 5,
    name: 'filesystem_sentinel',
    verdict,
    confidence: hasCritical ? 1.0 : 0.9,
    details: `Filesystem check: ${findings.length} finding(s) for ${resolvedPath}`,
    findings,
    durationMs,
  };
}
