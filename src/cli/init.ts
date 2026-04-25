import type { Command } from 'commander';
import chalk from 'chalk';
import { BANNER, CONFIG_PATH, AUDIT_LOG_PATH, DEFAULT_DASHBOARD_PORT } from '../utils/constants.js';
import { loadConfig, saveConfig, ensurePufferDir } from '../utils/config.js';
import { DiscoveryEngine } from '../discovery/index.js';
import { AuditLogger } from '../audit/logger.js';
import { calculateScore } from '../score/calculator.js';
import { formatScore } from '../score/display.js';
import { logger } from '@puffer/core';

export function registerInitCommand(program: Command): void {
  program
    .command('init')
    .description('Initialize Puffer on this system')
    .option('--config <path>', 'Path to config file')
    .action(async (options: { config?: string }) => {
      const configPath = options.config ?? CONFIG_PATH;

      // Show banner
      logger.banner(BANNER);

      // Step 1: Scan system
      console.log(chalk.cyan.bold('  STEP 1/4: Scanning your system...\n'));

      const discovery = new DiscoveryEngine();
      const result = await discovery.scan();

      // Display discovered agents with host programs
      if (result.agents.length > 0) {
        console.log(chalk.white.bold('  Discovered AI agents:'));
        for (const agent of result.agents) {
          const status =
            agent.protectionStatus === 'protected'
              ? chalk.green('✓ protected')
              : agent.protectionStatus === 'partial'
                ? chalk.yellow('~ partial')
                : chalk.red('✗ unprotected');
          const host = agent.hostProgram ? chalk.gray(` in ${agent.hostProgram}`) : '';
          console.log(`    ${status}  ${chalk.white(agent.name)}${host}`);
        }
        console.log('');
      } else {
        console.log(chalk.gray('  No AI agents currently running.\n'));
        console.log(
          chalk.gray('  Start an AI agent (Claude Code, Cursor, etc.) and re-run puffer init.\n'),
        );
      }

      // Display discovered providers
      if (result.providers.length > 0) {
        console.log(chalk.white.bold('  Discovered LLM providers:'));
        for (const provider of result.providers) {
          const type = provider.isLocal ? chalk.blue('local') : chalk.yellow('cloud');
          console.log(`    ${type}  ${provider.name} → ${chalk.gray(provider.targetUrl)}`);
        }
        console.log('');
      }

      // Display security warnings
      if (result.securityWarnings.length > 0) {
        console.log(chalk.red.bold('  ⚠ Security warnings:'));
        for (const warning of result.securityWarnings) {
          console.log(chalk.red(`    ! ${warning}`));
        }
        console.log('');
      }

      // Step 2: Configure
      console.log(chalk.cyan.bold('  STEP 2/4: Configuring Puffer...\n'));

      ensurePufferDir();
      const config = loadConfig();

      // Add discovered providers
      for (const provider of result.providers) {
        const exists = config.providers.some((p) => p.name === provider.name);
        if (!exists) {
          config.providers.push(provider);
        }
      }

      // Set recommended mode based on findings
      if (result.securityWarnings.length > 0) {
        config.mode = 'enforce';
        console.log(
          chalk.yellow(`  Mode set to ${chalk.bold('enforce')} (security warnings detected)`),
        );
      } else {
        config.mode = 'monitor';
        console.log(
          chalk.green(
            `  Mode set to ${chalk.bold('monitor')} (safe default, upgrade to enforce when ready)`,
          ),
        );
      }

      saveConfig(config, configPath);
      console.log(chalk.gray(`  Config saved to ${configPath}\n`));

      // Step 3: Calculate initial Puffer Score
      console.log(chalk.cyan.bold('  STEP 3/4: Calculating your Puffer Score...\n'));

      const auditLogger = new AuditLogger(config.audit?.logPath);
      const stats = auditLogger.getStats();
      const score = calculateScore(config, result, stats);
      console.log(formatScore(score));

      // Step 4: Next steps
      console.log(chalk.cyan.bold('  STEP 4/4: Getting started\n'));

      console.log(chalk.white.bold('  Setup complete:'));
      logger.success(`Config:     ${configPath}`);
      logger.success(`Audit log:  ${AUDIT_LOG_PATH}`);
      logger.success(`Dashboard:  http://localhost:${DEFAULT_DASHBOARD_PORT}`);
      console.log('');

      console.log(chalk.white.bold('  Next steps:'));
      console.log(
        chalk.white('    1. ') + chalk.gray('puffer start        ') + '— Start the Puffer daemon',
      );
      console.log(
        chalk.white('    2. ') +
          chalk.gray('puffer dashboard    ') +
          '— Open the monitoring dashboard',
      );
      console.log(
        chalk.white('    3. ') +
          chalk.gray('puffer score        ') +
          '— Check your security score anytime',
      );
      if (score.total < 70) {
        console.log(
          chalk.white('    4. ') +
            chalk.yellow('Follow recommendations above to improve your score'),
        );
      }
      console.log('');

      const agentCount = result.agents.length;
      const protectedCount = result.agents.filter((a) => a.protectionStatus === 'protected').length;
      console.log(
        chalk.cyan(
          `  ${agentCount} agent(s) found, ${protectedCount} protected, 7-layer defense ready`,
        ),
      );
      console.log(chalk.green.bold('\n  🐡 Puffer is ready to protect.\n'));
    });
}
