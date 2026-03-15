import { Command } from 'commander';
import chalk from 'chalk';
import { DiscoveryEngine } from '../discovery/index.js';
import { loadConfig } from '../utils/config.js';
import { AuditLogger } from '../audit/logger.js';
import { calculateScore } from '../score/calculator.js';
import { formatScore } from '../score/display.js';

export function registerScanCommand(program: Command): void {
  program
    .command('scan')
    .description('Scan for AI agents and providers on this system')
    .action(async () => {
      console.log(chalk.cyan('\n  Scanning for AI agents and providers...\n'));

      const discovery = new DiscoveryEngine();
      const result = await discovery.scan();

      // Display discovered agents
      if (result.agents.length > 0) {
        console.log(chalk.white.bold('  Discovered agents:'));
        for (const agent of result.agents) {
          const statusColor = agent.protectionStatus === 'protected' ? 'green' : 'red';
          const statusLabel = agent.protectionStatus === 'protected'
            ? chalk.green('protected')
            : agent.protectionStatus === 'partial'
              ? chalk.yellow('partial')
              : chalk.red('unprotected');
          console.log(`    - ${agent.name} (PID: ${agent.pid}, via ${agent.detectedVia}) [${statusLabel}]`);
        }
        console.log('');
      } else {
        console.log(chalk.gray('  No agents detected.\n'));
      }

      // Display discovered providers
      if (result.providers.length > 0) {
        console.log(chalk.white.bold('  Discovered providers:'));
        for (const provider of result.providers) {
          const type = provider.isLocal ? chalk.blue('local') : chalk.yellow('cloud');
          const status = provider.status === 'active'
            ? chalk.green('active')
            : chalk.red(provider.status);
          console.log(`    - ${provider.name} -> ${provider.targetUrl} [${type}, ${status}]`);
        }
        console.log('');
      } else {
        console.log(chalk.gray('  No providers detected.\n'));
      }

      // Display security warnings
      if (result.securityWarnings.length > 0) {
        console.log(chalk.yellow.bold('  Security warnings:'));
        for (const warning of result.securityWarnings) {
          console.log(chalk.yellow(`    ! ${warning}`));
        }
        console.log('');
      }

      // Summary
      const protectedCount = result.agents.filter((a) => a.protectionStatus === 'protected').length;
      const unprotectedCount = result.agents.filter((a) => a.protectionStatus !== 'protected').length;
      console.log(chalk.cyan(`  Summary: ${result.agents.length} agent(s), ${result.providers.length} provider(s)`));
      if (unprotectedCount > 0) {
        console.log(chalk.red(`  ${unprotectedCount} unprotected agent(s) — run 'puffer init' to protect them.`));
      }

      // Calculate and display Puffer Score
      const config = loadConfig();
      const auditLogger = new AuditLogger(config.audit?.logPath);
      const stats = auditLogger.getStats();
      const score = calculateScore(config, result, stats);
      console.log(formatScore(score));
    });
}
