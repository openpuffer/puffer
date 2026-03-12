import { Command } from 'commander';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import chalk from 'chalk';
import { CONFIG_PATH } from '../utils/constants.js';
import { logger } from '../utils/logger.js';

export function registerConfigCommand(program: Command): void {
  const configCmd = program
    .command('config')
    .description('Manage Puffer configuration');

  configCmd
    .command('show')
    .description('Display current configuration')
    .action(() => {
      if (!fs.existsSync(CONFIG_PATH)) {
        logger.error(`Config not found at ${CONFIG_PATH}. Run 'puffer init' first.`);
        process.exit(1);
      }

      const content = fs.readFileSync(CONFIG_PATH, 'utf-8');
      console.log(chalk.cyan('\n  PUFFER CONFIGURATION\n'));
      console.log(chalk.gray(`  Path: ${CONFIG_PATH}\n`));
      console.log(content);
    });

  configCmd
    .command('edit')
    .description('Open configuration in your editor')
    .action(() => {
      if (!fs.existsSync(CONFIG_PATH)) {
        logger.error(`Config not found at ${CONFIG_PATH}. Run 'puffer init' first.`);
        process.exit(1);
      }

      const editor = process.env.EDITOR || 'vi';
      logger.info(`Opening config in ${editor}...`);

      try {
        execSync(`${editor} ${CONFIG_PATH}`, { stdio: 'inherit' });
      } catch (err) {
        logger.error(`Failed to open editor: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  configCmd
    .command('path')
    .description('Print the configuration file path')
    .action(() => {
      console.log(CONFIG_PATH);
    });
}
