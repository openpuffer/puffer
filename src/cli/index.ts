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
import { PID_FILE_PATH } from '../utils/constants.js';

const program = new Command();

program
  .name('puffer')
  .description('The autonomous immune system for AI agents')
  .version(VERSION);

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
  .action(async () => {
    const { startDaemon } = await import('../index.js');
    await startDaemon();
  });

// Inline: stop
program
  .command('stop')
  .description('Stop the Puffer daemon')
  .action(() => {
    if (!fs.existsSync(PID_FILE_PATH)) {
      logger.error('No PID file found. Is the daemon running?');
      process.exit(1);
    }

    const pid = parseInt(fs.readFileSync(PID_FILE_PATH, 'utf-8').trim(), 10);

    try {
      process.kill(pid);
      fs.unlinkSync(PID_FILE_PATH);
      logger.info(`Daemon stopped (PID ${pid})`);
    } catch (err) {
      logger.error(`Failed to stop daemon (PID ${pid}): ${(err as Error).message}`);
      fs.unlinkSync(PID_FILE_PATH);
    }
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
