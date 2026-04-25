import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { HookHandler } from './index.js';
import { logger } from '@puffer/core';
import { PUFFER_DIR, DEFAULT_PROXY_PORT } from '@puffer/core';

const PROXY_BASE = `http://127.0.0.1:${DEFAULT_PROXY_PORT}`;
const HEALTH_URL = `${PROXY_BASE}/__puffer/health`;

const PUFFER_START_MARKER = '# >>> puffer env >>>';
const PUFFER_END_MARKER = '# <<< puffer env <<<';

// Unix: env.sh with export statements — guarded by health check so
// env vars are only set when the Puffer proxy is actually running.
const ENV_FILE_UNIX = path.join(PUFFER_DIR, 'env.sh');
const ENV_CONTENT_UNIX = `# Puffer AI proxy — auto-generated, do not edit
# Only export proxy env vars if Puffer is alive (avoids poisoning shells when Puffer is dead)
if curl -sf ${HEALTH_URL} > /dev/null 2>&1; then
  export OPENAI_BASE_URL="${PROXY_BASE}/v1"
  export OPENAI_API_BASE="${PROXY_BASE}/v1"
  export ANTHROPIC_BASE_URL="${PROXY_BASE}"
  export OLLAMA_HOST="${PROXY_BASE}"
fi
`;

const RC_BLOCK_UNIX = `${PUFFER_START_MARKER}
[ -f "${ENV_FILE_UNIX}" ] && source "${ENV_FILE_UNIX}"
${PUFFER_END_MARKER}`;

// Windows: env.ps1 with PowerShell $env: statements — guarded by health check
const ENV_FILE_WIN = path.join(PUFFER_DIR, 'env.ps1');
const ENV_CONTENT_WIN = `# Puffer AI proxy — auto-generated, do not edit
# Only export proxy env vars if Puffer is alive
try {
  $resp = Invoke-WebRequest -Uri "${HEALTH_URL}" -UseBasicParsing -TimeoutSec 1 -ErrorAction Stop
  if ($resp.StatusCode -eq 200) {
    $env:OPENAI_BASE_URL = "${PROXY_BASE}/v1"
    $env:OPENAI_API_BASE = "${PROXY_BASE}/v1"
    $env:ANTHROPIC_BASE_URL = "${PROXY_BASE}"
    $env:OLLAMA_HOST = "${PROXY_BASE}"
  }
} catch {}
`;

function getPowerShellProfilePaths(): string[] {
  const home = os.homedir();
  return [
    path.join(home, 'Documents', 'PowerShell', 'Microsoft.PowerShell_profile.ps1'),
    path.join(home, 'Documents', 'WindowsPowerShell', 'Microsoft.PowerShell_profile.ps1'),
  ];
}

/**
 * Generic hook for agents without native hook support.
 * Generates ~/.puffer/env.sh with proxy env vars and injects
 * a source line into ~/.bashrc and ~/.zshrc.
 */
export class GenericHook implements HookHandler {
  name = 'generic';
  private installed = false;

  async install(): Promise<void> {
    try {
      if (process.platform === 'win32') {
        // Windows: write env.ps1 and inject into PowerShell profile
        fs.writeFileSync(ENV_FILE_WIN, ENV_CONTENT_WIN);
        logger.debug(`Generic hook: wrote ${ENV_FILE_WIN}`);

        for (const profilePath of getPowerShellProfilePaths()) {
          this.injectRcBlock(
            profilePath,
            `${PUFFER_START_MARKER}\n. "${ENV_FILE_WIN}"\n${PUFFER_END_MARKER}`,
          );
        }
      } else {
        // Unix: write env.sh and inject into shell RC files
        fs.writeFileSync(ENV_FILE_UNIX, ENV_CONTENT_UNIX);
        logger.debug(`Generic hook: wrote ${ENV_FILE_UNIX}`);

        const rcFiles = [path.join(os.homedir(), '.bashrc'), path.join(os.homedir(), '.zshrc')];
        for (const rcFile of rcFiles) {
          this.injectRcBlock(rcFile, RC_BLOCK_UNIX);
        }
      }

      this.installed = true;
      logger.info('Generic hook installed (env + shell profile injection)');
    } catch (err) {
      logger.error(`Failed to install generic hook: ${(err as Error).message}`);
    }
  }

  async uninstall(): Promise<void> {
    try {
      // Remove env files
      for (const envFile of [ENV_FILE_UNIX, ENV_FILE_WIN]) {
        if (fs.existsSync(envFile)) fs.unlinkSync(envFile);
      }

      // Remove source blocks from all profile files
      const profileFiles = [
        path.join(os.homedir(), '.bashrc'),
        path.join(os.homedir(), '.zshrc'),
        ...getPowerShellProfilePaths(),
      ];
      for (const rcFile of profileFiles) {
        this.removeRcBlock(rcFile);
      }

      this.installed = false;
      logger.info('Generic hook uninstalled');
    } catch (err) {
      logger.error(`Failed to uninstall generic hook: ${(err as Error).message}`);
    }
  }

  isInstalled(): boolean {
    return this.installed;
  }

  private injectRcBlock(rcFile: string, block: string): void {
    // Create parent directory if needed (for PowerShell profiles)
    const dir = path.dirname(rcFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    let content = '';
    if (fs.existsSync(rcFile)) {
      content = fs.readFileSync(rcFile, 'utf-8');
    }

    // Already injected
    if (content.includes(PUFFER_START_MARKER)) return;

    fs.writeFileSync(rcFile, content + '\n' + block + '\n');
    logger.debug(`Generic hook: injected source block into ${rcFile}`);
  }

  private removeRcBlock(rcFile: string): void {
    if (!fs.existsSync(rcFile)) return;

    const content = fs.readFileSync(rcFile, 'utf-8');
    if (!content.includes(PUFFER_START_MARKER)) return;

    // Remove the puffer block (including surrounding newlines)
    const startIdx = content.indexOf(PUFFER_START_MARKER);
    const endIdx = content.indexOf(PUFFER_END_MARKER);
    if (startIdx === -1 || endIdx === -1) return;

    const before = content.slice(0, startIdx).replace(/\n+$/, '');
    const after = content.slice(endIdx + PUFFER_END_MARKER.length).replace(/^\n+/, '');
    const cleaned = before + (after ? '\n' + after : '');

    fs.writeFileSync(rcFile, cleaned);
    logger.debug(`Generic hook: removed source block from ${rcFile}`);
  }
}
