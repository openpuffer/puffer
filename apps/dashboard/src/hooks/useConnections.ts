import { useEffect, useRef, useState } from 'react';
import type { LiveEvent } from '../App';
import type { EntityState } from './useGridStats';

export interface Edge {
  id: string; // stable: `${from}->${to}`
  from: string; // card id (e.g. 'agent:claude-code')
  to: string;
  lastSeen: number;
  decision: EntityState;
  intensity: number; // 0..1 — fades over EDGE_TTL_MS, 1 = just now
}

const EDGE_TTL_MS = 5_000;
const DECAY_TICK_MS = 200;
const MAX_EDGES = 24;

/**
 * Derives a live set of recent connections from event history.
 * Edges are emitted for: agent↔provider, agent↔mcp, agent↔subagent.
 * Each edge fades out over 5s and is removed when intensity hits 0.
 */
export function useConnections(liveEvents: LiveEvent[]): Edge[] {
  const edgesRef = useRef<Map<string, Edge>>(new Map());
  const lastProcessedIdRef = useRef<string | null>(null);
  const [, setTick] = useState(0);

  // Decay loop — runs while there are edges to fade out.
  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now();
      let mutated = false;
      for (const [key, edge] of edgesRef.current) {
        const age = now - edge.lastSeen;
        if (age >= EDGE_TTL_MS) {
          edgesRef.current.delete(key);
          mutated = true;
        } else {
          const next = 1 - age / EDGE_TTL_MS;
          if (Math.abs(next - edge.intensity) > 0.01) {
            edge.intensity = next;
            mutated = true;
          }
        }
      }
      if (mutated) setTick((t) => t + 1);
    }, DECAY_TICK_MS);
    return () => clearInterval(id);
  }, []);

  // Ingest new events at the head of liveEvents.
  useEffect(() => {
    if (liveEvents.length === 0) return;
    const newest = liveEvents[0]?.id;
    if (!newest || newest === lastProcessedIdRef.current) return;

    // Walk events from newest to last-processed (or up to 20 events).
    const limit = Math.min(liveEvents.length, 20);
    let mutated = false;
    for (let i = 0; i < limit; i++) {
      const ev = liveEvents[i];
      if (!ev) continue;
      if (ev.id === lastProcessedIdRef.current) break;
      const decision = (ev.decision as EntityState) ?? 'ALLOW';
      const ts = new Date(ev.timestamp).getTime();
      const agent = `agent:${ev.source?.agent ?? 'unknown'}`;
      const provider = `provider:${ev.source?.provider ?? 'unknown'}`;

      pushEdge(edgesRef.current, agent, provider, ts, decision);
      mutated = true;

      const actionType = ev.action?.type;
      if (actionType === 'mcp_tool_call' || actionType === 'mcp_tool_result') {
        const server = ev.action?.server ?? 'unknown';
        if (server === 'claude-code-agent') {
          pushEdge(edgesRef.current, agent, `subagent:${server}`, ts, decision);
        } else {
          pushEdge(edgesRef.current, agent, `mcp:${server}`, ts, decision);
        }
      }
    }
    lastProcessedIdRef.current = newest;
    if (mutated) setTick((t) => t + 1);
  }, [liveEvents]);

  return Array.from(edgesRef.current.values()).slice(-MAX_EDGES);
}

function pushEdge(
  map: Map<string, Edge>,
  from: string,
  to: string,
  ts: number,
  decision: EntityState,
) {
  const id = `${from}->${to}`;
  const existing = map.get(id);
  if (existing) {
    existing.lastSeen = Math.max(existing.lastSeen, ts);
    existing.intensity = 1;
    existing.decision = decision; // most recent decision wins
  } else {
    map.set(id, { id, from, to, lastSeen: ts, decision, intensity: 1 });
  }
}
