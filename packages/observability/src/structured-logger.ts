// Trace-correlated structured event logging.
//
// The core logger in @puffer/core honors PUFFER_LOG_FORMAT=json for the
// usual `info`/`warn`/`error` calls. This module is the complement: a
// helper that emits a JSON line whose `trace_id` is the PufferEvent.id
// so an operator can pivot on a single id from the proxy entry through
// every layer decision to the final dispatch.

import type { PufferEvent } from './types-shim.js';

interface EventLogLine {
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  msg: string;
  trace_id: string;
  agent: string;
  provider: string;
  model?: string;
  [key: string]: unknown;
}

/**
 * Emit a JSON line bound to a Puffer event. Always JSON regardless of
 * PUFFER_LOG_FORMAT — the call site has chosen to emit structured
 * data, so honoring text mode would defeat the purpose. Errors go to
 * stderr; everything else to stdout, matching the convention used by
 * the core logger when JSON_MODE is on.
 */
export function logEvent(
  event: PufferEvent,
  level: 'info' | 'warn' | 'error',
  msg: string,
  extra: Record<string, unknown> = {},
): void {
  const line: EventLogLine = {
    timestamp: new Date().toISOString(),
    level,
    msg,
    trace_id: event.id,
    agent: event.source.agent,
    provider: event.source.provider,
    ...(event.source.model !== undefined ? { model: event.source.model } : {}),
    ...extra,
  };
  const out = JSON.stringify(line) + '\n';
  if (level === 'error' || level === 'warn') process.stderr.write(out);
  else process.stdout.write(out);
}

/**
 * Bind a trace context to a thunk so every log line emitted inside it
 * carries the same trace_id without each call site repeating itself.
 * Returns a small surface mirroring `info/warn/error`.
 */
export function withTraceContext(event: PufferEvent): {
  info(msg: string, extra?: Record<string, unknown>): void;
  warn(msg: string, extra?: Record<string, unknown>): void;
  error(msg: string, extra?: Record<string, unknown>): void;
} {
  return {
    info: (msg, extra) => logEvent(event, 'info', msg, extra ?? {}),
    warn: (msg, extra) => logEvent(event, 'warn', msg, extra ?? {}),
    error: (msg, extra) => logEvent(event, 'error', msg, extra ?? {}),
  };
}
