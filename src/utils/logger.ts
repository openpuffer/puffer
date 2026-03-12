import chalk from 'chalk';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let currentLevel: LogLevel = 'info';

const PREFIX = '\u{1F421}';

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel];
}

export const logger = {
  debug(message: string, ...args: unknown[]): void {
    if (shouldLog('debug')) {
      console.debug(chalk.gray(`[${PREFIX} PUFFER] ${message}`), ...args);
    }
  },

  info(message: string, ...args: unknown[]): void {
    if (shouldLog('info')) {
      console.log(chalk.cyan(`[${PREFIX} PUFFER] ${message}`), ...args);
    }
  },

  warn(message: string, ...args: unknown[]): void {
    if (shouldLog('warn')) {
      console.warn(chalk.yellow(`[${PREFIX} PUFFER] ${message}`), ...args);
    }
  },

  error(message: string, ...args: unknown[]): void {
    if (shouldLog('error')) {
      console.error(chalk.red(`[${PREFIX} PUFFER] ${message}`), ...args);
    }
  },

  blocked(reason: string, layerName: string, agent: string): void {
    console.log(
      chalk.red.bold(`[${PREFIX} PUFFER] BLOCKED: ${reason}`) +
      chalk.gray(` | Layer: ${layerName} | Agent: ${agent}`)
    );
  },

  allowed(action: string, durationMs: number): void {
    if (shouldLog('debug')) {
      console.log(
        chalk.green(`[${PREFIX} PUFFER] ALLOW: ${action}`) +
        chalk.gray(` | 7 layers passed in ${durationMs}ms`)
      );
    }
  },

  banner(text: string): void {
    console.log(chalk.cyan(text));
  },

  success(message: string): void {
    console.log(chalk.green(`  \u2713 ${message}`));
  },

  warning(message: string): void {
    console.log(chalk.yellow(`  \u26A0\uFE0F  ${message}`));
  },

  status(label: string, value: string, color: 'green' | 'yellow' | 'red' = 'green'): void {
    const icon = color === 'green' ? '\u{1F7E2}' : color === 'yellow' ? '\u{1F7E1}' : '\u{1F534}';
    console.log(`  ${icon} ${label}: ${chalk[color](value)}`);
  },
};
