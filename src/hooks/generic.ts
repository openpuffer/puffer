import { HookHandler } from './index.js';
import { logger } from '../utils/logger.js';

/**
 * Generic hook for agents without native hook support.
 * Uses environment variable injection to route API calls
 * through the Puffer proxy.
 */
export class GenericHook implements HookHandler {
  name = 'generic';
  private installed = false;

  async install(): Promise<void> {
    // For generic agents, we set environment variables that
    // common LLM SDKs respect:
    // - OPENAI_BASE_URL -> Puffer proxy
    // - ANTHROPIC_BASE_URL -> Puffer proxy
    // - OLLAMA_HOST -> Puffer proxy
    logger.debug('Generic hook: env-based proxy routing available');
    this.installed = true;
  }

  async uninstall(): Promise<void> {
    this.installed = false;
  }

  isInstalled(): boolean {
    return this.installed;
  }
}
