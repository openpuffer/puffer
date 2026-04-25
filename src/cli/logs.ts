import type { Command } from 'commander';
import fs from 'node:fs';
import chalk from 'chalk';
import { AuditLogger } from '../audit/logger.js';
import { generateReport, formatReport } from '../audit/reporter.js';
import { AUDIT_LOG_PATH } from '../utils/constants.js';
import type { AuditLogEntry } from '../types.js';

function formatEntry(entry: AuditLogEntry): string {
  const time = new Date(entry.timestamp).toLocaleString();
  const agent = entry.source.agent;
  const action = entry.action.type;

  let decisionStr: string;
  switch (entry.decision) {
    case 'BLOCK':
      decisionStr = chalk.red.bold('BLOCK');
      break;
    case 'ALLOW':
      decisionStr = chalk.green('ALLOW');
      break;
    case 'AUDIT':
      decisionStr = chalk.yellow('AUDIT');
      break;
    case 'ESCALATE':
      decisionStr = chalk.magenta.bold('ESCALATE');
      break;
    default:
      decisionStr = chalk.gray(entry.decision);
  }

  const layers = entry.layers
    .filter((l) => l.verdict !== 'allow')
    .map((l) => `${l.name}:${l.verdict}`)
    .join(', ');

  const layerInfo = layers ? chalk.gray(` [${layers}]`) : '';

  return `  ${chalk.gray(time)} ${decisionStr} ${chalk.white(agent)} ${chalk.cyan(action)}${layerInfo}`;
}

export function registerLogsCommand(program: Command): void {
  program
    .command('logs')
    .description('View Puffer audit logs')
    .option('-f, --follow', 'Stream new log entries in real-time')
    .option('-n, --limit <number>', 'Number of entries to show', '20')
    .option('--filter <decision>', 'Filter by decision (ALLOW, BLOCK, AUDIT, ESCALATE)')
    .option('--report', 'Generate and display audit report')
    .action((options: { follow?: boolean; limit: string; filter?: string; report?: boolean }) => {
      const auditLogger = new AuditLogger();

      // Report mode
      if (options.report) {
        const report = generateReport(auditLogger);
        console.log(formatReport(report));
        return;
      }

      const limit = parseInt(options.limit, 10) || 20;
      let entries = auditLogger.readEntries(limit);

      // Apply filter
      if (options.filter) {
        const filterUpper = options.filter.toUpperCase();
        entries = entries.filter((e) => e.decision === filterUpper);
      }

      if (entries.length === 0) {
        console.log(chalk.gray('\n  No log entries found.\n'));
      } else {
        console.log(chalk.cyan(`\n  PUFFER AUDIT LOG (last ${entries.length} entries)\n`));
        // Entries come most-recent-first, display in that order
        for (const entry of entries) {
          console.log(formatEntry(entry));
        }
        console.log('');
      }

      // Follow mode
      if (options.follow) {
        console.log(chalk.gray('  Watching for new entries... (Ctrl+C to stop)\n'));

        if (!fs.existsSync(AUDIT_LOG_PATH)) {
          console.log(chalk.gray('  Waiting for log file to be created...\n'));
        }

        let lastSize = 0;
        try {
          lastSize = fs.existsSync(AUDIT_LOG_PATH) ? fs.statSync(AUDIT_LOG_PATH).size : 0;
        } catch {
          // File may not exist yet
        }

        const dir = AUDIT_LOG_PATH.substring(0, AUDIT_LOG_PATH.lastIndexOf('/'));

        fs.watch(dir, (eventType, filename) => {
          if (filename && AUDIT_LOG_PATH.endsWith(filename)) {
            try {
              const stat = fs.statSync(AUDIT_LOG_PATH);
              if (stat.size > lastSize) {
                const fd = fs.openSync(AUDIT_LOG_PATH, 'r');
                const buffer = Buffer.alloc(stat.size - lastSize);
                fs.readSync(fd, buffer, 0, buffer.length, lastSize);
                fs.closeSync(fd);

                const newContent = buffer.toString('utf-8');
                const newLines = newContent.trim().split('\n').filter(Boolean);

                for (const line of newLines) {
                  try {
                    const entry = JSON.parse(line) as AuditLogEntry;
                    if (!options.filter || entry.decision === options.filter.toUpperCase()) {
                      console.log(formatEntry(entry));
                    }
                  } catch {
                    // Skip malformed lines
                  }
                }

                lastSize = stat.size;
              }
            } catch {
              // Ignore transient read errors
            }
          }
        });
      }
    });
}
