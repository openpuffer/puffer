#!/usr/bin/env node

import { Command } from 'commander';
import { VERSION } from '../utils/constants.js';
import { registerInitCommand } from './init.js';
import { registerScanCommand } from './scan.js';
import { registerStatusCommand } from './status.js';
import { registerLogsCommand } from './logs.js';
import { registerConfigCommand } from './config.js';
import { loadConfig, saveConfig } from '../utils/config.js';
import { PolicyEngine } from '../engine/policy.js';
import { logger } from '../utils/logger.js';
import fs from 'node:fs';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PID_FILE_PATH, DAEMON_LOG_PATH, PUFFER_DIR } from '../utils/constants.js';
import { isDaemonReadyMessage } from '../types/ipc.js';

const program = new Command();

program.name('puffer').description('The autonomous immune system for AI agents').version(VERSION);

// Register subcommands
registerInitCommand(program);
registerScanCommand(program);
registerStatusCommand(program);
registerLogsCommand(program);
registerConfigCommand(program);

// Inline: start
program
  .command('start')
  .description('Start the Puffer daemon')
  .option('--foreground', 'Run in foreground (used internally by daemon fork)')
  .action(async (opts) => {
    if (opts.foreground) {
      // Foreground mode: run the daemon directly (called by the forked child)
      const { startDaemon } = await import('../index.js');
      await startDaemon();
      return;
    }

    // Daemon mode: fork a detached child process
    if (!fs.existsSync(PUFFER_DIR)) {
      fs.mkdirSync(PUFFER_DIR, { recursive: true });
    }

    const logFd = fs.openSync(DAEMON_LOG_PATH, 'a');
    const thisFile = fileURLToPath(import.meta.url);

    const child = fork(thisFile, ['start', '--foreground'], {
      detached: true,
      stdio: ['ignore', logFd, logFd, 'ipc'],
    });

    // Wait for 'ready' IPC from child (sent after health check passes)
    const config = loadConfig();
    let dashboardPort = config.dashboard?.port ?? 8788;

    const ready = await new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => {
        resolve(false);
      }, 10_000);

      child.once('message', (msg: unknown) => {
        clearTimeout(timeout);
        // Legacy: pre-typed daemons sent the string 'ready'. New daemons
        // send a `DaemonReadyMessage` object with port info. We honor both.
        if (msg === 'ready') {
          resolve(true);
          return;
        }
        if (isDaemonReadyMessage(msg)) {
          dashboardPort = msg.dashboardPort;
          resolve(true);
        }
      });

      child.once('exit', (code) => {
        clearTimeout(timeout);
        if (code !== 0) resolve(false);
      });
    });

    if (ready) {
      child.disconnect();
      child.unref();
      fs.closeSync(logFd);
      logger.info(`Puffer daemon started (PID ${child.pid}). Logs: ${DAEMON_LOG_PATH}`);

      // Auto-open dashboard in browser
      const dashUrl = `http://127.0.0.1:${dashboardPort}`;
      logger.info(`Opening dashboard at ${dashUrl}`);
      const { exec } = await import('node:child_process');
      const platform = process.platform;
      const openCmd = platform === 'darwin' ? 'open' : platform === 'win32' ? 'start' : 'xdg-open';
      exec(`${openCmd} ${dashUrl}`, () => {
        /* ignore errors */
      });

      process.exit(0);
    } else {
      // Child failed to become ready
      try {
        child.kill();
      } catch {
        /* already dead */
      }
      fs.closeSync(logFd);
      // Clean up any stale config the child might have partially written
      try {
        const { cleanupStaleConfig } = await import('../index.js');
        await cleanupStaleConfig();
      } catch {
        /* best effort */
      }
      logger.error('Daemon failed to start. Check logs: ' + DAEMON_LOG_PATH);
      process.exit(1);
    }
  });

// Inline: stop
program
  .command('stop')
  .description('Stop the Puffer daemon')
  .option('--force', 'Kill immediately instead of draining gracefully')
  .action(async (opts) => {
    // Always clean up hooks/settings first, regardless of mode
    try {
      const { forceCleanupHooks } = await import('../index.js');
      await forceCleanupHooks();
    } catch {
      /* ignore */
    }

    if (!fs.existsSync(PID_FILE_PATH)) {
      logger.warn('No PID file found — hooks cleaned up.');
      process.exit(0);
    }

    const pid = parseInt(fs.readFileSync(PID_FILE_PATH, 'utf-8').trim(), 10);

    if (opts.force) {
      // --force: kill immediately with SIGTERM → SIGKILL fallback
      try {
        process.kill(pid, 'SIGTERM');
        const dead = await new Promise<boolean>((resolve) => {
          let elapsed = 0;
          const interval = setInterval(() => {
            elapsed += 200;
            try {
              process.kill(pid, 0);
            } catch {
              clearInterval(interval);
              resolve(true);
              return;
            }
            if (elapsed >= 5000) {
              clearInterval(interval);
              resolve(false);
            }
          }, 200);
        });
        if (!dead) {
          logger.warn(`Process ${pid} did not exit gracefully, sending SIGKILL`);
          try {
            process.kill(pid, 'SIGKILL');
          } catch {
            /* already dead */
          }
        }
      } catch {
        /* already dead */
      }
      try {
        fs.unlinkSync(PID_FILE_PATH);
      } catch {
        /* ignore */
      }
      logger.info(`Daemon force-stopped (PID ${pid})`);
    } else {
      // Graceful stop: send SIGUSR1 → daemon enters passthrough drain mode
      // Proxy stays alive for 2 min so existing sessions keep working
      try {
        process.kill(pid, 'SIGUSR1');
        logger.info(
          `Settings cleaned. Proxy entering drain mode (PID ${pid}) — will auto-exit in 2 minutes.`,
        );
        logger.info('Existing sessions will continue working. New sessions go direct to API.');
        logger.info('Use "puffer stop --force" to kill immediately.');
      } catch {
        // Process already dead — clean up PID file
        try {
          fs.unlinkSync(PID_FILE_PATH);
        } catch {
          /* ignore */
        }
        logger.info('Daemon already stopped. Settings cleaned.');
      }
    }
  });

// Inline: score
program
  .command('score')
  .description('Calculate your Puffer Score (0-100)')
  .action(async () => {
    const config = loadConfig();
    const { DiscoveryEngine } = await import('../discovery/index.js');
    const { AuditLogger } = await import('../audit/logger.js');
    const { calculateScore } = await import('../score/calculator.js');
    const { formatScore } = await import('../score/display.js');

    console.log('\n  Calculating Puffer Score...\n');

    const discovery = new DiscoveryEngine();
    const result = await discovery.scan();
    const auditLogger = new AuditLogger(config.audit?.logPath);
    const stats = auditLogger.getStats();

    const score = calculateScore(config, result, stats);
    console.log(formatScore(score));
  });

// Inline: report
program
  .command('report')
  .description('Generate a threat report')
  .option('--format <format>', 'Output format: markdown, html', 'markdown')
  .option('--output <path>', 'Write to file instead of stdout')
  .action(async (opts) => {
    const config = loadConfig();
    const { AuditLogger } = await import('../audit/logger.js');
    const { DiscoveryEngine } = await import('../discovery/index.js');
    const { calculateScore } = await import('../score/calculator.js');
    const { generateWeeklyReport, formatWeeklyMarkdown, formatWeeklyHTML } =
      await import('../reports/weekly.js');

    console.log('\n  Generating weekly threat report...\n');

    const auditLogger = new AuditLogger(config.audit?.logPath);
    const discovery = new DiscoveryEngine();
    const result = await discovery.scan();
    const stats = auditLogger.getStats();
    const score = calculateScore(config, result, stats);

    const report = generateWeeklyReport(auditLogger, { current: score.total, grade: score.grade });

    const formatted =
      opts.format === 'html' ? formatWeeklyHTML(report) : formatWeeklyMarkdown(report);

    if (opts.output) {
      const fs = await import('node:fs');
      fs.writeFileSync(opts.output, formatted);
      logger.info(`Report saved to ${opts.output}`);
    } else {
      console.log(formatted);
    }
  });

// Inline: redteam
program
  .command('redteam')
  .description('Run red team attack simulations against your configuration')
  .action(async () => {
    const config = loadConfig();
    const { runRedTeam, formatRedTeamReport } = await import('../redteam/runner.js');

    console.log('\n  Running red team simulations...\n');
    const result = await runRedTeam(config);
    console.log(formatRedTeamReport(result));
  });

// Inline: dashboard
program
  .command('dashboard')
  .description('Open the Puffer dashboard in your browser')
  .option('-p, --port <port>', 'Dashboard port', '8788')
  .action(async (opts) => {
    const config = loadConfig();
    const port = parseInt(opts.port) || config.dashboard.port;
    const url = `http://127.0.0.1:${port}`;

    logger.info(`Opening dashboard at ${url}`);

    // Try to open in default browser
    const { exec } = await import('node:child_process');
    const platform = process.platform;
    const cmd = platform === 'darwin' ? 'open' : platform === 'win32' ? 'start' : 'xdg-open';
    exec(`${cmd} ${url}`, (err) => {
      if (err) {
        logger.info(`Open manually: ${url}`);
      }
    });
  });

// Inline: inflate
program
  .command('inflate')
  .description('Inflate: activate paranoid mode with maximum protection')
  .action(() => {
    const config = loadConfig();
    const engine = new PolicyEngine(config);
    engine.inflate();
    saveConfig(engine.getConfig());
    logger.info('Configuration saved. Puffer is now in paranoid mode.');
  });

// Inline: deflate
program
  .command('deflate')
  .description('Deflate: return to normal enforce mode')
  .action(() => {
    const config = loadConfig();
    const engine = new PolicyEngine(config);
    engine.deflate();
    saveConfig(engine.getConfig());
    logger.info('Configuration saved. Puffer is back to normal enforce mode.');
  });

program.parse(process.argv);
