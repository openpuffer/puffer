import { Command } from 'commander';
import chalk from 'chalk';
import { BANNER, CONFIG_PATH, AUDIT_LOG_PATH, DEFAULT_DASHBOARD_PORT } from '../utils/constants.js';
import { loadConfig, saveConfig, ensurePufferDir } from '../utils/config.js';
import { DiscoveryEngine } from '../discovery/index.js';
import { logger } from '../utils/logger.js';

export function registerInitCommand(program: Command): void {
  program
    .command('init')
    .description('Initialize Puffer on this system')
    .option('--config <path>', 'Path to config file')
    .action(async (options: { config?: string }) => {
      const configPath = options.config ?? CONFIG_PATH;

      // Show banner
      logger.banner(BANNER);

      // Scan system
      console.log(chalk.cyan('  Scanning your system...\n'));

      const discovery = new DiscoveryEngine();
      const result = await discovery.scan();

      // Display discovered agents
      if (result.agents.length > 0) {
        console.log(chalk.white.bold('  Discovered agents:'));
        for (const agent of result.agents) {
          const status = agent.protectionStatus === 'protected'
            ? chalk.green('protected')
            : chalk.red('unprotected');
          console.log(`    - ${agent.name} (PID: ${agent.pid}, via ${agent.detectedVia}) [${status}]`);
        }
        console.log('');
      } else {
        console.log(chalk.gray('  No agents currently detected.\n'));
      }

      // Display discovered providers
      if (result.providers.length > 0) {
        console.log(chalk.white.bold('  Discovered providers:'));
        for (const provider of result.providers) {
          const type = provider.isLocal ? chalk.blue('local') : chalk.yellow('cloud');
          console.log(`    - ${provider.name} (${provider.targetUrl}) [${type}]`);
        }
        console.log('');
      }

      // Display security warnings
      if (result.securityWarnings.length > 0) {
        console.log(chalk.yellow.bold('  Security warnings:'));
        for (const warning of result.securityWarnings) {
          logger.warning(warning);
        }
        console.log('');
      }

      // Create puffer directory and config
      ensurePufferDir();

      const config = loadConfig();

      // Add discovered providers to config
      for (const provider of result.providers) {
        const exists = config.providers.some((p) => p.name === provider.name);
        if (!exists) {
          config.providers.push(provider);
        }
      }

      saveConfig(config, configPath);

      // Display summary
      console.log(chalk.white.bold('  Setup complete:\n'));
      logger.success(`Config:     ${configPath}`);
      logger.success(`Audit log:  ${AUDIT_LOG_PATH}`);
      logger.success(`Dashboard:  http://localhost:${DEFAULT_DASHBOARD_PORT}`);
      console.log('');

      // Display status
      const agentCount = result.agents.length;
      const mode = config.mode;
      console.log(chalk.cyan(`  STATUS: ${agentCount} agent(s) protected, 7-layer defense active, mode: ${mode}`));
      console.log('');
      console.log(chalk.green.bold('  Puffer is watching.\n'));
    });
}
