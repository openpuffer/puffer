import type { PufferEvent } from '@puffer/core';
import { logger } from '../utils/logger.js';

export interface HookHandler {
  name: string;
  install(): Promise<void>;
  uninstall(): Promise<void>;
  isInstalled(): boolean;
}

export class HookManager {
  private hooks: Map<string, HookHandler> = new Map();
  private eventCallback: ((event: PufferEvent) => Promise<PufferEvent>) | null = null;

  registerHook(hook: HookHandler): void {
    this.hooks.set(hook.name, hook);
  }

  setEventCallback(callback: (event: PufferEvent) => Promise<PufferEvent>): void {
    this.eventCallback = callback;
  }

  async processEvent(event: PufferEvent): Promise<PufferEvent> {
    if (this.eventCallback) {
      return this.eventCallback(event);
    }
    return event;
  }

  async installAll(): Promise<void> {
    for (const [name, hook] of this.hooks) {
      try {
        await hook.install();
        logger.success(`Hook installed: ${name}`);
      } catch (err) {
        logger.error(`Failed to install hook ${name}: ${(err as Error).message}`);
      }
    }
  }

  async uninstallAll(): Promise<void> {
    for (const [name, hook] of this.hooks) {
      try {
        await hook.uninstall();
        logger.info(`Hook uninstalled: ${name}`);
      } catch (err) {
        logger.error(`Failed to uninstall hook ${name}: ${(err as Error).message}`);
      }
    }
  }

  getInstalledHooks(): string[] {
    return [...this.hooks.entries()]
      .filter(([_, hook]) => hook.isInstalled())
      .map(([name]) => name);
  }

  /** Alias for getInstalledHooks — used by DiscoveryEngine for protection status. */
  getInstalledHookNames(): string[] {
    return this.getInstalledHooks();
  }
}
