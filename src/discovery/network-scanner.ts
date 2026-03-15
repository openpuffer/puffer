import { execSync } from 'child_process';
import { platform } from 'os';
import dns from 'node:dns';
import { promisify } from 'node:util';
import type { DiscoveredAgent } from '../types.js';
import { NETWORK_SIGNATURES } from './signatures.js';
import { logger } from '../utils/logger.js';

const dnsResolve4 = promisify(dns.resolve4);

/**
 * Cross-platform DNS resolution using Node.js built-in dns module.
 * Works on Linux, macOS, and Windows without external commands.
 */
async function resolveDomainIPs(domain: string): Promise<string[]> {
  try {
    return await dnsResolve4(domain);
  } catch {
    return [];
  }
}

/**
 * Builds an IP-to-provider map for all known network signatures.
 * Uses Node.js native DNS (cross-platform).
 */
async function buildDomainIpMap(): Promise<Map<string, string>> {
  const domainIpMap = new Map<string, string>();
  const resolutions = await Promise.allSettled(
    NETWORK_SIGNATURES.map(async (sig) => {
      const ips = await resolveDomainIPs(sig.domain);
      return { provider: sig.provider, ips };
    })
  );
  for (const result of resolutions) {
    if (result.status === 'fulfilled') {
      for (const ip of result.value.ips) {
        domainIpMap.set(ip, result.value.provider);
      }
    }
  }
  return domainIpMap;
}

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
 */
function parseLinuxConnections(domainIpMap: Map<string, string>): DiscoveredAgent[] {
  const agents: DiscoveredAgent[] = [];
  try {
    const output = execSync('ss -tnp', {
      encoding: 'utf-8',
      timeout: 10_000,
    });

    const lines = output.split('\n').filter((l) => l.trim().length > 0);

    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 5) continue;

      const peerAddress = parts[4]; // e.g. "104.18.6.192:443"
      const peerIp = peerAddress.replace(/:\d+$/, '');

      const provider = domainIpMap.get(peerIp);
      if (!provider) continue;

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
 */
function parseMacConnections(domainIpMap: Map<string, string>): DiscoveredAgent[] {
  const agents: DiscoveredAgent[] = [];
  try {
    const output = execSync('lsof -i -P -n 2>/dev/null', {
      encoding: 'utf-8',
      timeout: 10_000,
    });

    const lines = output.split('\n').filter((l) => l.trim().length > 0);

    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 9) continue;

      const name = parts[parts.length - 1];
      const pid = parseInt(parts[1], 10);
      if (isNaN(pid)) continue;

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
 * Parses Windows `netstat -no` output to extract connections to known API providers.
 * Output format: Proto  Local Address  Foreign Address  State  PID
 */
function parseWindowsConnections(domainIpMap: Map<string, string>): DiscoveredAgent[] {
  const agents: DiscoveredAgent[] = [];
  try {
    const output = execSync('netstat -no', {
      encoding: 'utf-8',
      timeout: 10_000,
    });

    const lines = output.split('\n').filter((l) => l.trim().length > 0);

    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      // Expected: TCP  local_addr  foreign_addr  state  PID
      if (parts.length < 5 || parts[0] !== 'TCP') continue;

      const foreignAddr = parts[2]; // e.g. "104.18.6.192:443"
      const foreignIp = foreignAddr.replace(/:\d+$/, '');
      const pid = parseInt(parts[4], 10);

      const provider = domainIpMap.get(foreignIp);
      if (!provider) continue;
      if (isNaN(pid) || pid === 0) continue;

      // Get process command via tasklist
      let command = '';
      try {
        const taskOutput = execSync(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, {
          encoding: 'utf-8',
          timeout: 3000,
        }).trim();
        // CSV format: "Image Name","PID","Session Name","Session#","Mem Usage"
        const match = taskOutput.match(/"([^"]+)"/);
        command = match ? match[1] : '';
      } catch { /* ignore */ }

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
    logger.error('Windows network scan failed', error);
  }
  return agents;
}

/**
 * Scans active network connections for outbound traffic to known LLM API providers.
 * Supports Linux (ss), macOS (lsof), and Windows (netstat).
 * Uses Node.js native DNS resolution (cross-platform).
 */
export async function scanNetworkConnections(): Promise<DiscoveredAgent[]> {
  const os = platform();

  // Resolve provider domain IPs using cross-platform Node.js DNS
  const domainIpMap = await buildDomainIpMap();

  if (os === 'linux') {
    const agents = parseLinuxConnections(domainIpMap);
    logger.debug(`Network scan complete (Linux): ${agents.length} connection(s) found`);
    return agents;
  }

  if (os === 'darwin') {
    const agents = parseMacConnections(domainIpMap);
    logger.debug(`Network scan complete (macOS): ${agents.length} connection(s) found`);
    return agents;
  }

  if (os === 'win32') {
    const agents = parseWindowsConnections(domainIpMap);
    logger.debug(`Network scan complete (Windows): ${agents.length} connection(s) found`);
    return agents;
  }

  logger.warn(`Network scanning is not supported on ${os} — skipping`);
  return [];
}
