import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useWebSocket } from '../hooks/useWebSocket';
import type { EntityCard, EntityKind } from '../hooks/useGridStats';
import type { SelectedEntity } from '../components/AgentDetailPanel';
import type { SkillManifest } from '@puffer/core';

// ── Types — local to keep the provider self-contained.

export interface Stats {
  totalEvents: number;
  blocked: number;
  blockedEvents: number;
  allowed: number;
  allowedEvents: number;
  auditEvents: number;
  escalatedEvents: number;
  activeAgents: number;
  totalCost: number;
  totalTokens: number;
  eventsPerMinute: number;
  mode: string;
}

export interface LiveEvent {
  id: string;
  timestamp: string;
  source: { agent: string; provider: string };
  action: {
    type: string;
    server?: string;
    tool?: string;
    description?: string;
    subagentType?: string;
  };
  decision: 'ALLOW' | 'BLOCK' | 'AUDIT' | 'ESCALATE';
  layers: { layer: string; name: string; verdict: string }[];
  metadata?: {
    sessionId?: string;
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    costEstimate?: number;
    model?: string;
    rateLimits?: {
      limitTokens?: number;
      limitRequests?: number;
      remainingTokens?: number;
      remainingRequests?: number;
    };
    debugInfo?: {
      userAgent?: string;
      headers?: Record<string, string>;
      method?: string;
      endpoint?: string;
    };
    snippet?: {
      text: string;
      originalLength: number;
    };
  };
}

export interface AgentInfo {
  id: string;
  name: string;
  type: string;
  detectedVia: string;
  pid: number | null;
  port: number | null;
  hostProgram?: string;
  status: string;
  firstSeen: string;
  lastSeen: string;
}

const MAX_LIVE_EVENTS = 500;
const HYDRATE_LIMIT = 200;

interface DashboardContextValue {
  // Data
  stats: Stats;
  liveEvents: LiveEvent[];
  agents: AgentInfo[];
  connected: boolean;
  hydrated: boolean;
  // Skill inventory
  skillInventory: SkillManifest[];
  // Selection (cards focused)
  selectedCardIds: Set<string>;
  toggleCardSelection: (card: EntityCard) => void;
  clearSelection: () => void;
  // Drawer detail
  selectedEntity: SelectedEntity | null;
  openCardDetail: (card: EntityCard) => void;
  closeDetail: () => void;
}

const DashboardContext = createContext<DashboardContextValue | null>(null);

export function useDashboard(): DashboardContextValue {
  const ctx = useContext(DashboardContext);
  if (!ctx) throw new Error('useDashboard must be used inside <DashboardProvider>');
  return ctx;
}

const COLOR_BY_KIND: Record<EntityKind, string> = {
  agent: '#3b82f6',
  provider: '#ec4899',
  mcp: '#22d3ee',
  subagent: '#8b5cf6',
};

const INITIAL_STATS: Stats = {
  totalEvents: 0,
  blocked: 0,
  blockedEvents: 0,
  allowed: 0,
  allowedEvents: 0,
  auditEvents: 0,
  escalatedEvents: 0,
  activeAgents: 0,
  totalCost: 0,
  totalTokens: 0,
  eventsPerMinute: 0,
  mode: 'audit',
};

export const DashboardProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [stats, setStats] = useState<Stats>(INITIAL_STATS);
  const [liveEvents, setLiveEvents] = useState<LiveEvent[]>([]);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [skillInventory, setSkillInventory] = useState<SkillManifest[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [selectedCardIds, setSelectedCardIds] = useState<Set<string>>(new Set());
  const [selectedEntity, setSelectedEntity] = useState<SelectedEntity | null>(null);

  const handleWsMessage = useCallback((data: unknown) => {
    const msg = data as Record<string, unknown>;
    if (msg.type === 'stats') {
      setStats((prev) => ({ ...prev, ...(msg.payload as Partial<Stats>) }));
    } else if (msg.type === 'event') {
      const event = msg.data as LiveEvent;
      setLiveEvents((prev) => {
        // Skip duplicates that were already hydrated from /api/events.
        if (prev.length > 0 && prev[0]?.id === event.id) return prev;
        return [event, ...prev].slice(0, MAX_LIVE_EVENTS);
      });
      // If this is a skill inventory change event, refresh the inventory.
      const actionType = (event.action as unknown as { type: string }).type;
      if (
        actionType === 'skill_added' ||
        actionType === 'skill_modified' ||
        actionType === 'skill_removed'
      ) {
        fetch('/api/skills')
          .then((res) => res.json())
          .then((skills: SkillManifest[]) => {
            if (Array.isArray(skills)) setSkillInventory(skills);
          })
          .catch(() => {});
      }
    } else if (msg.type === 'agents') {
      const payload = msg.payload as Record<string, unknown>;
      setAgents((payload.agents ?? msg.data) as AgentInfo[]);
    }
  }, []);

  const { connected } = useWebSocket(handleWsMessage);

  // Hydrate liveEvents from the persistent audit log on mount.
  // Without this the dashboard appears empty until the next event arrives.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/events?limit=${HYDRATE_LIMIT}`)
      .then((res) => res.json())
      .then((data: { events?: LiveEvent[]; total?: number }) => {
        if (cancelled) return;
        const events = data.events ?? [];
        // /api/events returns newest first already.
        setLiveEvents(events.slice(0, MAX_LIVE_EVENTS));
        setHydrated(true);
      })
      .catch(() => {
        if (!cancelled) setHydrated(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Periodic stats refresh.
  useEffect(() => {
    const fetchStats = () => {
      fetch('/api/stats')
        .then((res) => res.json())
        .then((data) => setStats((prev) => ({ ...prev, ...data })))
        .catch(() => {});
    };
    fetchStats();
    const interval = setInterval(fetchStats, 5000);
    return () => clearInterval(interval);
  }, []);

  // Initial agents fetch — before WebSocket pushes the next snapshot.
  useEffect(() => {
    fetch('/api/agents')
      .then((res) => res.json())
      .then((data: { agents?: AgentInfo[] }) => {
        if (Array.isArray(data.agents)) setAgents(data.agents);
      })
      .catch(() => {});
  }, []);

  // Initial skills fetch.
  useEffect(() => {
    fetch('/api/skills')
      .then((res) => res.json())
      .then((data: SkillManifest[]) => {
        if (Array.isArray(data)) setSkillInventory(data);
      })
      .catch(() => {});
  }, []);

  const toggleCardSelection = useCallback((card: EntityCard) => {
    setSelectedCardIds((prev) => {
      const next = new Set(prev);
      if (next.has(card.id)) next.delete(card.id);
      else next.add(card.id);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedCardIds(new Set());
  }, []);

  const openCardDetail = useCallback((card: EntityCard) => {
    const legacyId = `${card.kind}-${card.name}`;
    setSelectedEntity({
      id: legacyId,
      name: card.name,
      type: card.kind,
      color: COLOR_BY_KIND[card.kind],
    });
  }, []);

  const closeDetail = useCallback(() => {
    setSelectedEntity(null);
  }, []);

  const value: DashboardContextValue = {
    stats,
    liveEvents,
    agents,
    connected,
    hydrated,
    skillInventory,
    selectedCardIds,
    toggleCardSelection,
    clearSelection,
    selectedEntity,
    openCardDetail,
    closeDetail,
  };

  return <DashboardContext.Provider value={value}>{children}</DashboardContext.Provider>;
};
