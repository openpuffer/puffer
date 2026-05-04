import type { SkillInventory, SkillChangeEvent } from '@puffer/core';
import { scanSkills, diffInventories } from '@puffer/skills';
import { logger } from '@puffer/core';

export interface SkillInventoryServiceOptions {
  /** Called for every SkillChangeEvent produced by a re-scan diff. */
  emitEvent: (event: SkillChangeEvent) => void;
  /** How often to re-scan disk for skill changes (ms). Default: 30000. */
  scanIntervalMs?: number;
}

/**
 * SkillInventoryService
 *
 * On daemon start, scans all skill roots and caches the result.
 * On each timer tick, re-scans, diffs against the cached inventory,
 * and calls `emitEvent` for every change.
 *
 * We use recursive setTimeout (not setInterval) so that a slow scan
 * does not queue up concurrent ticks — each scan starts only after the
 * previous one completes.
 */
export class SkillInventoryService {
  private inventory: SkillInventory | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly options: Required<SkillInventoryServiceOptions>;

  constructor(options: SkillInventoryServiceOptions) {
    this.options = {
      emitEvent: options.emitEvent,
      scanIntervalMs: options.scanIntervalMs ?? 30000,
    };
  }

  /** Returns the latest cached inventory, or null before the first scan. */
  getInventory(): SkillInventory | null {
    return this.inventory;
  }

  /** Run initial scan and start the periodic re-scan timer. */
  async start(): Promise<void> {
    try {
      this.inventory = await scanSkills();
      logger.info(`Skill inventory: ${this.inventory.skills.length} skill(s) found`);
    } catch (err) {
      logger.error(`Initial skill scan failed: ${(err as Error).message}`);
    }

    this.scheduleNext();
  }

  /** Stop the re-scan timer. Safe to call multiple times. */
  stop(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private scheduleNext(): void {
    // Only schedule if we haven't been stopped
    this.timer = setTimeout(() => {
      void this.runScan();
    }, this.options.scanIntervalMs);
  }

  private async runScan(): Promise<void> {
    try {
      const prev = this.inventory;
      const curr = await scanSkills();

      if (prev !== null) {
        const changes = diffInventories(prev, curr);
        for (const change of changes) {
          try {
            this.options.emitEvent(change);
          } catch (err) {
            logger.error(`Skill event emit failed: ${(err as Error).message}`);
          }
        }

        if (changes.length > 0) {
          logger.info(`Skill inventory updated: ${changes.length} change(s)`);
        }
      }

      this.inventory = curr;
    } catch (err) {
      logger.error(`Skill re-scan failed: ${(err as Error).message}`);
    }

    // Schedule next only if still running (stop() clears timer before null-check)
    if (this.timer !== null) {
      this.scheduleNext();
    }
  }
}
