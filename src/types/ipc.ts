// Typed IPC contracts for messages exchanged between the puffer CLI
// (parent process) and the daemon child it forks. The discriminator is the
// `type` field; the type guards below are the only sanctioned way to
// narrow an `unknown` IPC payload — never `as any` it back into shape.

/**
 * Messages a daemon child sends to its CLI parent over `process.send`.
 */
export type DaemonMessage = DaemonReadyMessage;

export interface DaemonReadyMessage {
  type: 'ready';
  dashboardPort: number;
  proxyPort: number;
}

/**
 * Narrow an unknown IPC payload to a `DaemonReadyMessage`. Returns false
 * for the legacy string-only `'ready'` signal — the caller should branch
 * on that separately for backwards compatibility with older daemons.
 */
export function isDaemonReadyMessage(msg: unknown): msg is DaemonReadyMessage {
  if (msg === null || typeof msg !== 'object') return false;
  const m = msg as Record<string, unknown>;
  return (
    m.type === 'ready' && typeof m.dashboardPort === 'number' && typeof m.proxyPort === 'number'
  );
}
