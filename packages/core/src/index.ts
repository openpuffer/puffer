// @puffer/core barrel — re-exports the contracts every other package
// in the workspace consumes (event types, configuration types, rule
// types, zod schemas for runtime validation, the typed IPC envelope
// between the daemon and the CLI, and the central logger).

export * from './types.js';
export * from './rule-types.js';
export * from './schemas/index.js';
export * from './ipc.js';
export { logger } from './logger.js';
