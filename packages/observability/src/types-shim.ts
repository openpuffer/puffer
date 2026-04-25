// Minimal shape import to avoid a hard dependency cycle on @puffer/core's
// full surface. The structured logger only needs the event identity
// fields, not the full PufferEvent contract.
//
// If @puffer/core's PufferEvent ever loses one of these fields the
// shim here would fail typecheck against consumers — that's the
// intended contract.

export interface PufferEvent {
  id: string;
  source: {
    agent: string;
    provider: string;
    model?: string | undefined;
  };
}
