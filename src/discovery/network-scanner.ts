import { execSync } from 'child_process';
import { platform } from 'os';
import type { DiscoveredAgent } from '../types.js';
import { NETWORK_SIGNATURES } from './signatures.js';
import { logger } from '../utils/logger.js';

/**
 * Resolves the PID's command line for cross-referencing network connections.
 */
function getProcessCommand(pid: number): string {
  try {
    const os = platform();
    if (os === 'linux') {
      return execSync(`cat /proc/${pid}/cmdline 2>/dev/null | tr '\\0' ' '`, {
        encoding: 'utf-8',
        timeout: 3000,
      }).trim();
    } else if (os === 'darwin') {
      return execSync(`ps -p ${pid} -o command=`, {
        encoding: 'utf-8',
        timeout: 3000,
      }).trim();
    }
    return '';
  } catch {
    return '';
  }
}

/**
 * Parses Linux `ss -tnp` output to extract connections to known API providers.
 * ss output format:
 *   State  Recv-Q  Send-Q  Local Address:Port  Peer Address:Port  Process
 */
function parseLinuxConnections(): DiscoveredAgent[] {
  const agents: DiscoveredAgent[] = [];
  try {
    const output = execSync('ss -tnp', {
      encoding: 'utf-8',
      timeout: 10_000,
    });

    const lines = output.split('\n').filter((l) => l.trim().length > 0);

    // Resolve known domains to IPs for matching
    const domainIpMap = new Map<string, string>();
    for (const sig of NETWORK_SIGNATURES) {
      try {
        const resolved = execSync(`getent hosts ${sig.domain} 2>/dev/null | awk '{print $1}'`, {
          encoding: 'utf-8',
          timeout: 3000,
        }).trim();
        if (resolved) {
          for (const ip of resolved.split('\n')) {
            domainIpMap.set(ip.trim(), sig.provider);
          }
        }
      } catch {
        // DNS resolution failed — skip
      }
    }

    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 5) continue;

      const peerAddress = parts[4]; // e.g. "104.18.6.192:443"
      const peerIp = peerAddress.replace(/:\d+$/, '');

      const provider = domainIpMap.get(peerIp);
      if (!provider) continue;

      // Extract PID from the process column (e.g. users:(("curl",pid=1234,fd=3)))
      const processCol = parts.slice(5).join(' ');
      const pidMatch = processCol.match(/pid=(\d+)/);
      const pid = pidMatch ? parseInt(pidMatch[1], 10) : 0;
      const command = pid > 0 ? getProcessCommand(pid) : '';

      agents.push({
        name: `${provider}-client`,
        pid,
        command,
        detectedVia: 'network',
        provider,
        protectionStatus: 'unprotected',
      });
    }
  } catch (error) {
    logger.error('Linux network scan failed', error);
  }
  return agents;
}

/**
 * Parses macOS `lsof -i -P -n` output to extract connections to known API providers.
 * lsof output format:
 *   COMMAND  PID  USER  FD  TYPE  DEVICE  SIZE/OFF  NODE  NAME
 */
function parseMacConnections(): DiscoveredAgent[] {
  const agents: DiscoveredAgent[] = [];
  try {
    const output = execSync('lsof -i -P -n 2>/dev/null', {
      encoding: 'utf-8',
      timeout: 10_000,
    });

    const lines = output.split('\n').filter((l) => l.trim().length > 0);

    // Resolve known domains to IPs for matching
    const domainIpMap = new Map<string, string>();
    for (const sig of NETWORK_SIGNATURES) {
      try {
        const resolved = execSync(`dig +short ${sig.domain} 2>/dev/null | head -1`, {
          encoding: 'utf-8',
          timeout: 3000,
        }).trim();
        if (resolved && /^\d+\.\d+\.\d+\.\d+$/.test(resolved)) {
          domainIpMap.set(resolved, sig.provider);
        }
      } catch {
        // DNS resolution failed — skip
      }
    }

    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 9) continue;

      const name = parts[parts.length - 1]; // e.g. "104.18.6.192:443->10.0.0.1:52000"
      const pid = parseInt(parts[1], 10);
      if (isNaN(pid)) continue;

      // Check if the connection target matches any known provider IP
      for (const [ip, provider] of domainIpMap) {
        if (name.includes(ip)) {
          const command = getProcessCommand(pid);
          agents.push({
            name: `${provider}-client`,
            pid,
            command,
            detectedVia: 'network',
            provider,
            protectionStatus: 'unprotected',
          });
          break;
        }
      }
    }
  } catch (error) {
    logger.error('macOS network scan failed', error);
  }
  return agents;
}

/**
 * Scans active network connections for outbound traffic to known LLM API providers.
 * Supports Linux (ss) and macOS (lsof). Windows is not supported in the MVP.
 */
export async function scanNetworkConnections(): Promise<DiscoveredAgent[]> {
  const os = platform();

  if (os === 'linux') {
    const agents = parseLinuxConnections();
    logger.debug(`Network scan complete (Linux): ${agents.length} connection(s) found`);
    return agents;
  }

  if (os === 'darwin') {
    const agents = parseMacConnections();
    logger.debug(`Network scan complete (macOS): ${agents.length} connection(s) found`);
    return agents;
  }

  logger.warn(`Network scanning is not supported on ${os} — skipping`);
  return [];
}
