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

/**
 * Whether the operator wants JSON-line output for downstream ingestion
 * (Loki, Datadog, CloudWatch, etc.). Captured once at module load to keep
 * each log call cheap. Operators flipping the env at runtime would have
 * to restart the daemon, which is the same constraint as every other
 * Puffer config switch.
 */
const JSON_MODE = process.env.PUFFER_LOG_FORMAT === 'json';

interface JsonLine {
  timestamp: string;
  level: LogLevel | 'block' | 'allow';
  msg: string;
  /** Free-form context — trace_id, agent, layer, verdict, etc. */
  [key: string]: unknown;
}

function emitJson(line: JsonLine, stream: 'stdout' | 'stderr' = 'stdout'): void {
  const out = JSON.stringify(line) + '\n';
  if (stream === 'stderr') process.stderr.write(out);
  else process.stdout.write(out);
}

function jsonOf(level: LogLevel | 'block' | 'allow', msg: string, extra: unknown[]): JsonLine {
  // When extra args are present, fold them into a `details` array so the
  // output is still valid JSON without trying to interpolate %s tokens.
  const line: JsonLine = {
    timestamp: new Date().toISOString(),
    level,
    msg,
  };
  if (extra.length > 0) line.details = extra;
  return line;
}

export const logger = {
  debug(message: string, ...args: unknown[]): void {
    if (!shouldLog('debug')) return;
    if (JSON_MODE) emitJson(jsonOf('debug', message, args));
    else console.debug(chalk.gray(`[${PREFIX} PUFFER] ${message}`), ...args);
  },

  info(message: string, ...args: unknown[]): void {
    if (!shouldLog('info')) return;
    if (JSON_MODE) emitJson(jsonOf('info', message, args));
    else console.log(chalk.cyan(`[${PREFIX} PUFFER] ${message}`), ...args);
  },

  warn(message: string, ...args: unknown[]): void {
    if (!shouldLog('warn')) return;
    if (JSON_MODE) emitJson(jsonOf('warn', message, args), 'stderr');
    else console.warn(chalk.yellow(`[${PREFIX} PUFFER] ${message}`), ...args);
  },

  error(message: string, ...args: unknown[]): void {
    if (!shouldLog('error')) return;
    if (JSON_MODE) emitJson(jsonOf('error', message, args), 'stderr');
    else console.error(chalk.red(`[${PREFIX} PUFFER] ${message}`), ...args);
  },

  blocked(reason: string, layerName: string, agent: string): void {
    if (JSON_MODE) {
      emitJson({
        timestamp: new Date().toISOString(),
        level: 'block',
        msg: reason,
        layer: layerName,
        agent,
      });
      return;
    }
    console.log(
      chalk.red.bold(`[${PREFIX} PUFFER] BLOCKED: ${reason}`) +
        chalk.gray(` | Layer: ${layerName} | Agent: ${agent}`),
    );
  },

  allowed(action: string, durationMs: number): void {
    if (!shouldLog('debug')) return;
    if (JSON_MODE) {
      emitJson({
        timestamp: new Date().toISOString(),
        level: 'allow',
        msg: action,
        duration_ms: durationMs,
      });
      return;
    }
    console.log(
      chalk.green(`[${PREFIX} PUFFER] ALLOW: ${action}`) +
        chalk.gray(` | 7 layers passed in ${durationMs}ms`),
    );
  },

  banner(text: string): void {
    // Banners are decorative CLI output; always plain text.
    console.log(chalk.cyan(text));
  },

  success(message: string): void {
    if (JSON_MODE) emitJson(jsonOf('info', message, []));
    else console.log(chalk.green(`  ✓ ${message}`));
  },

  warning(message: string): void {
    if (JSON_MODE) emitJson(jsonOf('warn', message, []), 'stderr');
    else console.log(chalk.yellow(`  ⚠️  ${message}`));
  },

  status(label: string, value: string, color: 'green' | 'yellow' | 'red' = 'green'): void {
    if (JSON_MODE) {
      emitJson(jsonOf('info', `${label}: ${value}`, []));
      return;
    }
    const icon = color === 'green' ? '\u{1F7E2}' : color === 'yellow' ? '\u{1F7E1}' : '\u{1F534}';
    console.log(`  ${icon} ${label}: ${chalk[color](value)}`);
  },
};
