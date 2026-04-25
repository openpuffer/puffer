import { execSync } from 'child_process';
import { platform } from 'os';
import type { DiscoveredAgent } from '../types.js';
import { AGENT_SIGNATURES } from './signatures.js';
import { logger } from '../utils/logger.js';

// Pattern table to resolve parent process names to friendly host program labels
const HOST_PROGRAMS: { pattern: RegExp; name: string }[] = [
  { pattern: /code|Code\.exe|Electron.*code/i, name: 'VS Code' },
  { pattern: /cursor/i, name: 'Cursor' },
  { pattern: /windsurf/i, name: 'Windsurf' },
  { pattern: /tmux/i, name: 'tmux' },
  { pattern: /screen/i, name: 'GNU Screen' },
  { pattern: /iTerm2|iTermServer/i, name: 'iTerm2' },
  { pattern: /gnome-terminal|konsole|alacritty|kitty|wezterm|xterm|tilix/i, name: 'Terminal' },
  { pattern: /Terminal\.app|Terminal$/i, name: 'macOS Terminal' },
  { pattern: /cmd\.exe|powershell|pwsh|WindowsTerminal/i, name: 'Windows Terminal' },
];

// Shells to skip when walking the process tree
const SHELL_PATTERN = /^(bash|zsh|fish|sh|dash|csh|tcsh|ksh|nu)$/;

/**
 * Resolve a process name to a friendly host program label.
 * Returns undefined if no match found.
 */
function matchHostProgram(processName: string): string | undefined {
  for (const { pattern, name } of HOST_PROGRAMS) {
    if (pattern.test(processName)) return name;
  }
  return undefined;
}

/**
 * Get the process name for a given PID.
 * Returns undefined if the process doesn't exist or lookup fails.
 */
function getProcessName(pid: number, os: string): string | undefined {
  try {
    if (os === 'win32') {
      const out = execSync(
        `powershell -NoProfile -Command "(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).ProcessName"`,
        { encoding: 'utf-8', timeout: 5_000 },
      ).trim();
      return out || undefined;
    } else {
      const out = execSync(`ps -p ${pid} -o comm=`, {
        encoding: 'utf-8',
        timeout: 5_000,
      }).trim();
      return out || undefined;
    }
  } catch {
    return undefined;
  }
}

/**
 * Get the parent PID for a given PID.
 */
function getParentPid(pid: number, os: string): number | undefined {
  try {
    if (os === 'win32') {
      const out = execSync(
        `powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}').ParentProcessId"`,
        { encoding: 'utf-8', timeout: 5_000 },
      ).trim();
      const ppid = parseInt(out, 10);
      return isNaN(ppid) ? undefined : ppid;
    } else {
      const out = execSync(`ps -p ${pid} -o ppid=`, {
        encoding: 'utf-8',
        timeout: 5_000,
      }).trim();
      const ppid = parseInt(out, 10);
      return isNaN(ppid) ? undefined : ppid;
    }
  } catch {
    return undefined;
  }
}

/**
 * Walk up the process tree from a given PID to find the host program.
 * Skips shells (bash, zsh, etc.) and walks up to maxDepth levels.
 * Uses a cache to avoid redundant lookups within a single scan cycle.
 */
function resolveHostProgram(
  pid: number,
  os: string,
  cache: Map<number, string | undefined>,
): string | undefined {
  let currentPid = pid;
  const maxDepth = 4;

  for (let depth = 0; depth < maxDepth; depth++) {
    const parentPid = getParentPid(currentPid, os);
    if (!parentPid || parentPid <= 1) break;

    // Check cache first
    if (cache.has(parentPid)) return cache.get(parentPid);

    const parentName = getProcessName(parentPid, os);
    if (!parentName) break;

    // Try to match against known host programs
    const match = matchHostProgram(parentName);
    if (match) {
      cache.set(parentPid, match);
      return match;
    }

    // If it's a shell, keep walking up
    const baseName = parentName.split('/').pop() ?? parentName;
    if (!SHELL_PATTERN.test(baseName)) {
      // It's not a known host and not a shell — use the process name as-is
      const label = baseName.charAt(0).toUpperCase() + baseName.slice(1);
      cache.set(parentPid, label);
      return label;
    }

    currentPid = parentPid;
  }

  cache.set(pid, undefined);
  return undefined;
}

/**
 * Scans running processes for known AI agent signatures.
 * Returns a deduplicated list of discovered agents with host program info.
 */
export function scanProcesses(): DiscoveredAgent[] {
  try {
    const os = platform();
    let rawOutput: string;

    if (os === 'win32') {
      // Prefer Get-CimInstance (modern) over wmic (deprecated since Win10 21H1)
      try {
        rawOutput = execSync(
          'powershell -NoProfile -Command "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Csv -NoTypeInformation"',
          { encoding: 'utf-8', timeout: 15_000 },
        );
      } catch {
        // Fallback to wmic if PowerShell fails
        rawOutput = execSync('wmic process get ProcessId,CommandLine /format:csv', {
          encoding: 'utf-8',
          timeout: 10_000,
        });
      }
    } else {
      // Use -eo format to get PID, PPID, and full command
      rawOutput = execSync('ps -eo pid,ppid,args', {
        encoding: 'utf-8',
        timeout: 10_000,
      });
    }

    const lines = rawOutput.split('\n').filter((l) => l.trim().length > 0);
    const seen = new Map<number, DiscoveredAgent>();
    // Cache for host program lookups within this scan cycle
    const hostCache = new Map<number, string | undefined>();

    for (const line of lines) {
      let pid: number;
      let ppid: number | undefined;
      let command: string;

      if (os === 'win32') {
        // CSV format from Get-CimInstance: "ProcessId","ParentProcessId","CommandLine"
        // or from wmic: Node,CommandLine,ProcessId (no ppid in wmic fallback)
        const stripped = line.replace(/^"|"$/g, '');
        const parts = stripped.split(/","?|,/);
        if (parts.length < 2) continue;
        pid = parseInt(parts[0], 10);
        if (isNaN(pid)) {
          // Fallback: wmic CSV format (Node,CommandLine,ProcessId)
          pid = parseInt(parts[parts.length - 1], 10);
          command = parts.slice(1, -1).join(',');
        } else if (parts.length >= 3) {
          // Get-CimInstance format with ParentProcessId
          ppid = parseInt(parts[1], 10);
          if (isNaN(ppid)) ppid = undefined;
          command = parts.slice(2).join(',').replace(/^"|"$/g, '');
        } else {
          command = parts.slice(1).join(',').replace(/^"|"$/g, '');
        }
      } else {
        // ps -eo pid,ppid,args format: PID PPID COMMAND...
        const parts = line.trim().split(/\s+/);
        if (parts.length < 3) continue;
        pid = parseInt(parts[0], 10);
        ppid = parseInt(parts[1], 10);
        if (isNaN(ppid)) ppid = undefined;
        command = parts.slice(2).join(' ');
      }

      if (isNaN(pid)) continue;

      for (const sig of AGENT_SIGNATURES) {
        if (sig.pattern.test(command)) {
          if (!seen.has(pid)) {
            // Resolve host program by walking the process tree
            const hostProgram = ppid ? resolveHostProgram(ppid, os, hostCache) : undefined;

            seen.set(pid, {
              name: sig.name,
              pid,
              ppid,
              command,
              detectedVia: 'process',
              hostProgram,
              protectionStatus: 'unprotected',
            });
            logger.debug(
              `Process scan: found ${sig.name} (PID ${pid}${hostProgram ? `, host: ${hostProgram}` : ''})`,
            );
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
