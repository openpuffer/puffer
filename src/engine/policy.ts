import type { PufferConfig } from '@puffer/core';
import { loadConfig } from '../utils/config.js';
import { logger } from '@puffer/core';

/**
 * Policy loader and evaluator.
 * Loads the config and provides runtime policy queries.
 */
export class PolicyEngine {
  private config: PufferConfig;

  constructor(config?: PufferConfig) {
    this.config = config ?? loadConfig();
  }

  getConfig(): PufferConfig {
    return this.config;
  }

  getMode(): PufferConfig['mode'] {
    return this.config.mode;
  }

  isLayerEnabled(layerName: string): boolean {
    const layers = this.config.layers as Record<string, { enabled?: boolean }>;
    const layer = layers[layerName];
    return layer?.enabled !== false;
  }

  setMode(mode: PufferConfig['mode']): void {
    this.config.mode = mode;
    logger.info(`Mode changed to: ${mode}`);
  }

  reload(configPath?: string): void {
    this.config = loadConfig(configPath);
    logger.info('Configuration reloaded');
  }

  /**
   * Inflate: switch to paranoid mode (whitelist-only, all layers at max sensitivity)
   */
  inflate(): void {
    this.config.mode = 'paranoid';
    this.config.layers.network.mode = 'whitelist';
    this.config.layers.behavior.sensitivity = 'high';
    logger.info('INFLATED: Paranoid mode activated — whitelist-only, maximum sensitivity');
  }

  /**
   * Deflate: switch back to normal enforce mode
   */
  deflate(): void {
    this.config.mode = 'enforce';
    this.config.layers.network.mode = 'blacklist';
    this.config.layers.behavior.sensitivity = 'medium';
    logger.info('DEFLATED: Back to normal enforce mode');
  }
}
