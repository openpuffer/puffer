import { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import type { LiveEvent, AgentInfo } from '../App';

export type EntityState = 'ALLOW' | 'BLOCK' | 'AUDIT' | 'ESCALATE' | 'IDLE';
export type EntityKind = 'agent' | 'provider' | 'mcp' | 'subagent';

export interface EntityCard {
  id: string;
  kind: EntityKind;
  name: string;
  state: EntityState;
  eventsPerMin: number;
  sparkline: number[]; // 12 buckets, oldest → newest
  tokens?: number;
  costUsd?: number;
  parentAgent?: string; // for subagents
  hostProgram?: string; // for agents
  recentlyActive: boolean; // event in last 2s — drives highlight ring
}

export interface GridStats {
  agents: EntityCard[];
  providers: EntityCard[];
  mcps: EntityCard[];
  subagents: EntityCard[];
  recentBlocks: Set<string>;
}

const SPARK_BUCKETS = 12;
const SPARK_BUCKET_MS = 30_000; // 6 min total
const PER_MIN_WINDOW_MS = 60_000;
const RECENT_ACTIVE_MS = 2_000;
const RECENT_BLOCK_MS = 3_000;

function pickState(events: LiveEvent[]): EntityState {
  // Most recent decision wins. If no events ever, IDLE.
  if (events.length === 0) return 'IDLE';
  const latest = events[0];
  return (latest?.decision as EntityState) ?? 'IDLE';
}

function buildSparkline(timestamps: number[], now: number): number[] {
  const buckets = new Array<number>(SPARK_BUCKETS).fill(0);
  for (const ts of timestamps) {
    const age = now - ts;
    const idx = Math.floor(age / SPARK_BUCKET_MS);
    if (idx >= 0 && idx < SPARK_BUCKETS) {
      // newest at end of array
      buckets[SPARK_BUCKETS - 1 - idx]! += 1;
    }
  }
  return buckets;
}

interface AccumByEntity {
  events: LiveEvent[]; // newest first
  timestamps: number[];
  tokens: number;
  costUsd: number;
  lastEventAt: number;
  lastBlockAt: number;
  hostProgram?: string;
  parentAgent?: string;
}

export function useGridStats(liveEvents: LiveEvent[], agents: AgentInfo[]): GridStats {
  // Tick every 5s so sparklines drift even when no new events arrive.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 5_000);
    return () => clearInterval(id);
  }, []);

  // Recent BLOCK set with 3s timer per id.
  const [recentBlocks, setRecentBlocks] = useState<Set<string>>(new Set());
  const blockTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const flagBlock = useCallback((id: string) => {
    setRecentBlocks((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    const existing = blockTimersRef.current.get(id);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      setRecentBlocks((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      blockTimersRef.current.delete(id);
    }, RECENT_BLOCK_MS);
    blockTimersRef.current.set(id, timer);
  }, []);

  // Watch for new BLOCKs in the front of liveEvents (most recent).
  useEffect(() => {
    for (let i = 0; i < Math.min(liveEvents.length, 5); i++) {
      const ev = liveEvents[i];
      if (!ev || ev.decision !== 'BLOCK') continue;
      const agent = ev.source?.agent ?? 'unknown';
      const provider = ev.source?.provider ?? 'unknown';
      flagBlock(`agent:${agent}`);
      flagBlock(`provider:${provider}`);
    }
  }, [liveEvents, flagBlock]);

  return useMemo<GridStats>(() => {
    const now = Date.now();
    const byAgent = new Map<string, AccumByEntity>();
    const byProvider = new Map<string, AccumByEntity>();
    const byMcp = new Map<string, AccumByEntity>();
    const bySubagent = new Map<string, AccumByEntity>();

    // Seed agents from /api/agents so IDLE ones still render.
    for (const a of agents) {
      const key = a.name;
      if (!byAgent.has(key)) {
        byAgent.set(key, {
          events: [],
          timestamps: [],
          tokens: 0,
          costUsd: 0,
          lastEventAt: 0,
          lastBlockAt: 0,
          hostProgram: a.hostProgram,
        });
      }
    }

    const accumulate = (
      map: Map<string, AccumByEntity>,
      key: string,
      ev: LiveEvent,
      ts: number,
      hostProgram?: string,
      parentAgent?: string,
    ) => {
      let entry = map.get(key);
      if (!entry) {
        entry = {
          events: [],
          timestamps: [],
          tokens: 0,
          costUsd: 0,
          lastEventAt: 0,
          lastBlockAt: 0,
          hostProgram,
          parentAgent,
        };
        map.set(key, entry);
      }
      entry.events.unshift(ev);
      entry.timestamps.push(ts);
      entry.lastEventAt = Math.max(entry.lastEventAt, ts);
      if (ev.decision === 'BLOCK') entry.lastBlockAt = Math.max(entry.lastBlockAt, ts);
      const meta = ev.metadata;
      if (meta && ev.action?.type === 'llm_response') {
        entry.tokens += meta.totalTokens ?? 0;
        entry.costUsd += meta.costEstimate ?? 0;
      }
      if (hostProgram && !entry.hostProgram) entry.hostProgram = hostProgram;
      if (parentAgent && !entry.parentAgent) entry.parentAgent = parentAgent;
    };

    for (const ev of liveEvents) {
      const ts = new Date(ev.timestamp).getTime();
      const agent = ev.source?.agent ?? 'unknown';
      const provider = ev.source?.provider ?? 'unknown';
      accumulate(byAgent, agent, ev, ts);
      accumulate(byProvider, provider, ev, ts);

      const actionType = ev.action?.type;
      if (actionType === 'mcp_tool_call' || actionType === 'mcp_tool_result') {
        const server = ev.action?.server ?? 'unknown';
        if (server === 'claude-code-agent') {
          const subKey = `${agent}::${server}`;
          accumulate(bySubagent, subKey, ev, ts, undefined, agent);
        } else {
          accumulate(byMcp, server, ev, ts);
        }
      }
    }

    const buildCard = (kind: EntityKind, name: string, entry: AccumByEntity): EntityCard => {
      const id = `${kind}:${name}`;
      const eventsPerMin = entry.timestamps.filter((t) => now - t <= PER_MIN_WINDOW_MS).length;
      const sparkline = buildSparkline(entry.timestamps, now);
      const recentlyActive = now - entry.lastEventAt <= RECENT_ACTIVE_MS && entry.lastEventAt > 0;
      let state: EntityState = pickState(entry.events);
      // No events at all → IDLE.
      if (entry.events.length === 0) state = 'IDLE';
      const card: EntityCard = {
        id,
        kind,
        name,
        state,
        eventsPerMin,
        sparkline,
        recentlyActive,
      };
      if (kind === 'provider' || kind === 'agent') {
        if (entry.tokens > 0) card.tokens = entry.tokens;
        if (entry.costUsd > 0) card.costUsd = entry.costUsd;
      }
      if (entry.hostProgram) card.hostProgram = entry.hostProgram;
      if (entry.parentAgent) card.parentAgent = entry.parentAgent;
      return card;
    };

    const sortByActivity = (a: EntityCard, b: EntityCard) => {
      // Active first, then by events/min desc, then by name.
      const aActive = a.state !== 'IDLE' ? 1 : 0;
      const bActive = b.state !== 'IDLE' ? 1 : 0;
      if (aActive !== bActive) return bActive - aActive;
      if (a.eventsPerMin !== b.eventsPerMin) return b.eventsPerMin - a.eventsPerMin;
      return a.name.localeCompare(b.name);
    };

    const agentsCards: EntityCard[] = [];
    for (const [name, entry] of byAgent) agentsCards.push(buildCard('agent', name, entry));
    const providersCards: EntityCard[] = [];
    for (const [name, entry] of byProvider) providersCards.push(buildCard('provider', name, entry));
    const mcpsCards: EntityCard[] = [];
    for (const [name, entry] of byMcp) mcpsCards.push(buildCard('mcp', name, entry));
    const subagentsCards: EntityCard[] = [];
    for (const [name, entry] of bySubagent) {
      const display = name.includes('::') ? name.split('::')[1]! : name;
      subagentsCards.push(buildCard('subagent', display, entry));
    }

    agentsCards.sort(sortByActivity);
    providersCards.sort(sortByActivity);
    mcpsCards.sort(sortByActivity);
    subagentsCards.sort(sortByActivity);

    return {
      agents: agentsCards,
      providers: providersCards,
      mcps: mcpsCards,
      subagents: subagentsCards,
      recentBlocks,
    };
  }, [liveEvents, agents, recentBlocks]);
}
