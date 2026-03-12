import http from 'http';
import { execSync } from 'child_process';
import { platform } from 'os';
import type { PortScanResult, DiscoveredAgent, ProviderConfig } from '../types.js';
import { PORT_SIGNATURES } from './signatures.js';
import { logger } from '../utils/logger.js';

/**
 * Probes a local port with an HTTP GET request.
 * Returns parsed JSON response or null on failure/timeout.
 */
function probePort(port: number, path: string, timeoutMs = 2000): Promise<unknown | null> {
  return new Promise((resolve) => {
    const req = http.get(
      { hostname: '127.0.0.1', port, path, timeout: timeoutMs },
      (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve(data);
          }
        });
      },
    );

    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
  });
}

/**
 * Checks whether a port is bound to 0.0.0.0 (exposed to network).
 * Returns true if bound to all interfaces — a security concern.
 */
function checkBinding(port: number): boolean {
  try {
    const os = platform();
    let output: string;

    if (os === 'linux') {
      output = execSync(`ss -tlnp | grep :${port}`, {
        encoding: 'utf-8',
        timeout: 5000,
      });
    } else if (os === 'darwin') {
      output = execSync(`netstat -an -p tcp | grep \\.${port}\\b | grep LISTEN`, {
        encoding: 'utf-8',
        timeout: 5000,
      });
    } else {
      output = execSync(`netstat -an | findstr :${port}`, {
        encoding: 'utf-8',
        timeout: 5000,
      });
    }

    return output.includes('0.0.0.0') || output.includes('*');
  } catch {
    // Command failed or no match — assume not exposed
    return false;
  }
}

/**
 * Scans all known port signatures for active local LLM servers and agents.
 * Returns port scan results with provider info and security warnings.
 */
export async function scanPorts(): Promise<PortScanResult[]> {
  const results: PortScanResult[] = [];

  const probes = PORT_SIGNATURES.map(async (sig) => {
    try {
      const response = await probePort(sig.port, sig.probe);
      if (response === null) return;

      logger.debug(`Port scan: ${sig.name} responding on port ${sig.port}`);

      // Try to extract model list from response
      let models: string[] = [];
      if (typeof response === 'object' && response !== null) {
        const resp = response as Record<string, unknown>;
        if (Array.isArray(resp.models)) {
          models = resp.models.map((m: unknown) =>
            typeof m === 'string' ? m : (m as Record<string, string>).name || (m as Record<string, string>).id || String(m)
          );
        } else if (Array.isArray(resp.data)) {
          models = resp.data.map((m: unknown) =>
            typeof m === 'string' ? m : (m as Record<string, string>).id || (m as Record<string, string>).name || String(m)
          );
        }
      }

      const securityWarnings: string[] = [];
      const isExposed = checkBinding(sig.port);
      if (isExposed) {
        securityWarnings.push(
          `${sig.name} on port ${sig.port} is bound to 0.0.0.0 — accessible from the network`
        );
        logger.warn(`Security: ${sig.name} on port ${sig.port} is exposed to the network`);
      }

      const agent: DiscoveredAgent = {
        name: sig.name,
        pid: 0, // PID not available from port scan alone
        command: `listening on :${sig.port}`,
        detectedVia: 'port',
        port: sig.port,
        protectionStatus: 'unprotected',
      };

      const apiFormat = sig.name === 'ollama' ? 'ollama' as const : 'openai' as const;

      const provider: ProviderConfig = {
        name: sig.name,
        targetUrl: `http://127.0.0.1:${sig.port}`,
        proxyPort: 0, // Assigned later by proxy manager
        apiFormat,
        isLocal: true,
        detected: true,
        status: 'active',
      };

      if (models.length > 0) {
        logger.debug(`  Models available on ${sig.name}: ${models.join(', ')}`);
      }

      results.push({ agent, provider, securityWarnings });
    } catch (error) {
      logger.error(`Port scan failed for ${sig.name} on port ${sig.port}`, error);
    }
  });

  await Promise.all(probes);

  logger.debug(`Port scan complete: ${results.length} service(s) found`);
  return results;
}
