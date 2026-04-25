import type { Command } from 'commander';
import fs from 'node:fs';
import chalk from 'chalk';
import { PID_FILE_PATH } from '../utils/constants.js';
import { loadConfig } from '../utils/config.js';
import { AuditLogger } from '../audit/logger.js';
import { logger } from '../utils/logger.js';

export function registerStatusCommand(program: Command): void {
  program
    .command('status')
    .description('Show Puffer daemon and protection status')
    .action(() => {
      console.log(chalk.cyan('\n  PUFFER STATUS\n'));

      // Check daemon status
      let daemonRunning = false;
      let daemonPid: number | null = null;

      if (fs.existsSync(PID_FILE_PATH)) {
        const pid = parseInt(fs.readFileSync(PID_FILE_PATH, 'utf-8').trim(), 10);
        try {
          process.kill(pid, 0); // Check if process exists
          daemonRunning = true;
          daemonPid = pid;
        } catch {
          // Process not running, stale PID file
        }
      }

      if (daemonRunning) {
        logger.status('Daemon', `running (PID ${daemonPid})`, 'green');
      } else {
        logger.status('Daemon', 'not running', 'red');
      }

      // Load config
      try {
        const config = loadConfig();

        // Mode
        const modeColor =
          config.mode === 'paranoid' ? 'red' : config.mode === 'enforce' ? 'green' : 'yellow';
        logger.status('Mode', config.mode, modeColor);

        // Active layers
        const layerNames = [
          'pii',
          'injection',
          'commands',
          'network',
          'filesystem',
          'behavior',
          'mcp',
        ] as const;
        const activeLayers = layerNames.filter((name) => {
          const layer = config.layers[name];
          return layer?.enabled !== false;
        });
        logger.status(
          'Active layers',
          `${activeLayers.length}/7 (${activeLayers.join(', ')})`,
          'green',
        );

        // Providers
        logger.status('Providers', `${config.providers.length} configured`, 'green');

        // Auto-discovery
        const discoveryStatus = config.autoDiscovery.enabled ? 'enabled' : 'disabled';
        const discoveryColor = config.autoDiscovery.enabled ? 'green' : 'yellow';
        logger.status('Auto-discovery', discoveryStatus, discoveryColor);
      } catch {
        logger.status('Config', 'not found — run puffer init', 'red');
      }

      // Audit log stats
      try {
        const auditLogger = new AuditLogger();
        const stats = auditLogger.getStats();

        if (stats.total > 0) {
          console.log('');
          console.log(chalk.white.bold('  Audit log:'));
          logger.status('Total events', String(stats.total), 'green');
          logger.status('Blocked', String(stats.blocked), stats.blocked > 0 ? 'red' : 'green');
          logger.status('Allowed', String(stats.allowed), 'green');
          logger.status('Audit', String(stats.audit), stats.audit > 0 ? 'yellow' : 'green');
          logger.status(
            'Escalated',
            String(stats.escalated),
            stats.escalated > 0 ? 'red' : 'green',
          );
        } else {
          logger.status('Audit log', 'no events recorded', 'yellow');
        }
      } catch {
        logger.status('Audit log', 'unavailable', 'yellow');
      }

      console.log('');
    });
}
