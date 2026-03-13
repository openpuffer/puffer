import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { HookHandler } from './index.js';
import { logger } from '../utils/logger.js';
import { PUFFER_DIR, DEFAULT_PROXY_PORT } from '../utils/constants.js';

const ENV_FILE = path.join(PUFFER_DIR, 'env.sh');
const PROXY_BASE = `http://127.0.0.1:${DEFAULT_PROXY_PORT}`;

const PUFFER_START_MARKER = '# >>> puffer env >>>';
const PUFFER_END_MARKER = '# <<< puffer env <<<';

const ENV_CONTENT = `# Puffer AI proxy — auto-generated, do not edit
export OPENAI_BASE_URL="${PROXY_BASE}/v1"
export OPENAI_API_BASE="${PROXY_BASE}/v1"
export ANTHROPIC_BASE_URL="${PROXY_BASE}"
export OLLAMA_HOST="${PROXY_BASE}"
`;

const RC_BLOCK = `${PUFFER_START_MARKER}
[ -f "${ENV_FILE}" ] && source "${ENV_FILE}"
${PUFFER_END_MARKER}`;

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
      // 1. Write env.sh
      fs.writeFileSync(ENV_FILE, ENV_CONTENT);
      logger.debug(`Generic hook: wrote ${ENV_FILE}`);

      // 2. Inject source block into shell RC files
      const rcFiles = [
        path.join(os.homedir(), '.bashrc'),
        path.join(os.homedir(), '.zshrc'),
      ];

      for (const rcFile of rcFiles) {
        this.injectRcBlock(rcFile);
      }

      this.installed = true;
      logger.info('Generic hook installed (env.sh + shell RC injection)');
    } catch (err) {
      logger.error(`Failed to install generic hook: ${(err as Error).message}`);
    }
  }

  async uninstall(): Promise<void> {
    try {
      // 1. Remove env.sh
      if (fs.existsSync(ENV_FILE)) {
        fs.unlinkSync(ENV_FILE);
      }

      // 2. Remove source block from shell RC files
      const rcFiles = [
        path.join(os.homedir(), '.bashrc'),
        path.join(os.homedir(), '.zshrc'),
      ];

      for (const rcFile of rcFiles) {
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

  private injectRcBlock(rcFile: string): void {
    if (!fs.existsSync(rcFile)) return;

    const content = fs.readFileSync(rcFile, 'utf-8');

    // Already injected
    if (content.includes(PUFFER_START_MARKER)) return;

    fs.writeFileSync(rcFile, content + '\n' + RC_BLOCK + '\n');
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
