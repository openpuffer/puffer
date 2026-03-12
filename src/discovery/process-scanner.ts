import { execSync } from 'child_process';
import { platform } from 'os';
import type { DiscoveredAgent } from '../types.js';
import { AGENT_SIGNATURES } from './signatures.js';
import { logger } from '../utils/logger.js';

/**
 * Scans running processes for known AI agent signatures.
 * Returns a deduplicated list of discovered agents.
 */
export function scanProcesses(): DiscoveredAgent[] {
  try {
    const os = platform();
    let rawOutput: string;

    if (os === 'win32') {
      rawOutput = execSync('wmic process get ProcessId,CommandLine /format:csv', {
        encoding: 'utf-8',
        timeout: 10_000,
      });
    } else {
      rawOutput = execSync('ps aux', {
        encoding: 'utf-8',
        timeout: 10_000,
      });
    }

    const lines = rawOutput.split('\n').filter((l) => l.trim().length > 0);
    const seen = new Map<number, DiscoveredAgent>();

    for (const line of lines) {
      let pid: number;
      let command: string;

      if (os === 'win32') {
        // CSV format: Node,CommandLine,ProcessId
        const parts = line.split(',');
        if (parts.length < 3) continue;
        pid = parseInt(parts[parts.length - 1], 10);
        command = parts.slice(1, -1).join(',');
      } else {
        // ps aux format: USER PID %CPU %MEM VSZ RSS TTY STAT START TIME COMMAND...
        const parts = line.trim().split(/\s+/);
        if (parts.length < 11) continue;
        pid = parseInt(parts[1], 10);
        command = parts.slice(10).join(' ');
      }

      if (isNaN(pid)) continue;

      for (const sig of AGENT_SIGNATURES) {
        if (sig.pattern.test(command)) {
          if (!seen.has(pid)) {
            seen.set(pid, {
              name: sig.name,
              pid,
              command,
              detectedVia: 'process',
              protectionStatus: 'unprotected',
            });
            logger.debug(`Process scan: found ${sig.name} (PID ${pid})`);
          }
          break;
        }
      }
    }

    const agents = Array.from(seen.values());
    logger.debug(`Process scan complete: ${agents.length} agent(s) found`);
    return agents;
  } catch (error) {
    logger.error('Process scan failed', error);
    return [];
  }
}
