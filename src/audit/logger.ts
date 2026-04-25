import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { PufferEvent, AuditLogEntry } from '@puffer/core';
import { AUDIT_LOG_PATH } from '../utils/constants.js';
import { logger } from '../utils/logger.js';

function expandPath(p: string): string {
  return p.replace(/^~/, os.homedir());
}

export class AuditLogger {
  private logPath: string;
  private stream: fs.WriteStream | null = null;
  private eventCount = 0;

  constructor(logPath?: string) {
    this.logPath = expandPath(logPath ?? AUDIT_LOG_PATH);
  }

  private ensureStream(): fs.WriteStream {
    if (!this.stream) {
      const dir = path.dirname(this.logPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      this.stream = fs.createWriteStream(this.logPath, { flags: 'a' });
      this.stream.on('error', (err) => {
        logger.error(`Audit log write error: ${err.message}`);
      });
    }
    return this.stream;
  }

  log(event: PufferEvent): void {
    const entry: AuditLogEntry = {
      id: event.id,
      timestamp: event.timestamp,
      source: event.source,
      action: { type: event.action.type },
      decision: event.decision ?? 'ALLOW',
      layers: event.layers.map((l) => ({
        layer: l.layer,
        name: l.name,
        verdict: l.verdict,
        confidence: l.confidence,
        details: l.details,
        durationMs: l.durationMs,
      })),
      metadata: event.metadata,
    };

    const line = JSON.stringify(entry) + '\n';
    this.ensureStream().write(line);
    this.eventCount++;
  }

  getEventCount(): number {
    return this.eventCount;
  }

  getLogPath(): string {
    return this.logPath;
  }

  async flush(): Promise<void> {
    return new Promise((resolve) => {
      if (this.stream) {
        this.stream.end(() => {
          this.stream = null;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  close(): void {
    if (this.stream) {
      this.stream.end();
      this.stream = null;
    }
  }

  /**
   * Read audit log entries (most recent first).
   */
  readEntries(limit = 100, offset = 0): AuditLogEntry[] {
    if (!fs.existsSync(this.logPath)) return [];

    const content = fs.readFileSync(this.logPath, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    const entries: AuditLogEntry[] = [];

    // Read from end (most recent first)
    const start = Math.max(0, lines.length - offset - limit);
    const end = lines.length - offset;

    let malformedCount = 0;
    for (let i = end - 1; i >= start; i--) {
      const line = lines[i];
      if (line === undefined) continue;
      try {
        entries.push(JSON.parse(line));
      } catch {
        malformedCount++;
      }
    }

    if (malformedCount > 0) {
      logger.warn(`Skipped ${malformedCount} malformed audit log entries while reading`);
    }

    return entries;
  }

  /**
   * Get stats from the audit log.
   */
  getStats(): {
    total: number;
    blocked: number;
    allowed: number;
    audit: number;
    escalated: number;
  } {
    if (!fs.existsSync(this.logPath)) {
      return { total: 0, blocked: 0, allowed: 0, audit: 0, escalated: 0 };
    }

    const content = fs.readFileSync(this.logPath, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);

    let blocked = 0;
    let allowed = 0;
    let audit = 0;
    let escalated = 0;

    let malformedCount = 0;
    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as AuditLogEntry;
        switch (entry.decision) {
          case 'BLOCK':
            blocked++;
            break;
          case 'ALLOW':
            allowed++;
            break;
          case 'AUDIT':
            audit++;
            break;
          case 'ESCALATE':
            escalated++;
            break;
        }
      } catch {
        malformedCount++;
      }
    }

    if (malformedCount > 0) {
      logger.warn(`Skipped ${malformedCount} malformed audit log entries in stats`);
    }

    return { total: lines.length, blocked, allowed, audit, escalated };
  }

  /**
   * Clean up old entries beyond retention period.
   */
  cleanup(retentionDays: number): number {
    if (!fs.existsSync(this.logPath)) return 0;

    const content = fs.readFileSync(this.logPath, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retentionDays);

    const kept: string[] = [];
    let removed = 0;

    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as AuditLogEntry;
        if (new Date(entry.timestamp) >= cutoff) {
          kept.push(line);
        } else {
          removed++;
        }
      } catch {
        // Remove malformed lines
        removed++;
      }
    }

    fs.writeFileSync(this.logPath, kept.join('\n') + (kept.length > 0 ? '\n' : ''));
    return removed;
  }
}
