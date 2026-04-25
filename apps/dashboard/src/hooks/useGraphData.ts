import { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import type { LiveEvent, AgentInfo } from '../App';

export interface GraphNode {
  id: string;
  name: string;
  type: 'puffer' | 'agent' | 'provider' | 'subagent' | 'mcp';
  val: number;
  color: string;
  fx?: number;
  fy?: number;
  fz?: number;
  hostProgram?: string;
  parentAgentId?: string;
  // d3-force injects these — preserved across updates
  x?: number;
  y?: number;
  z?: number;
  vx?: number;
  vy?: number;
  vz?: number;
}

export interface GraphLink {
  source: string;
  target: string;
  color: string;
  curvature: number;
  eventId: string;
  decision: string;
  particleCount: number;
  particleSpeed: number;
  particleColor: string;
  [key: string]: unknown;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

// Theme-aware color palettes for graph links
const DECISION_COLORS_DARK: Record<string, string> = {
  ALLOW: '#fbbf24',
  BLOCK: '#f87171',
  AUDIT: '#fb923c',
  ESCALATE: '#c084fc',
};
const DECISION_COLORS_LIGHT: Record<string, string> = {
  ALLOW: '#94a3b8',
  BLOCK: '#ef4444',
  AUDIT: '#f59e0b',
  ESCALATE: '#8b5cf6',
};

const DECISION_PARTICLE_DARK: Record<string, string> = {
  ALLOW: '#fcd34d',
  BLOCK: '#f87171',
  AUDIT: '#fb923c',
  ESCALATE: '#c084fc',
};
const DECISION_PARTICLE_LIGHT: Record<string, string> = {
  ALLOW: '#64748b',
  BLOCK: '#ef4444',
  AUDIT: '#f59e0b',
  ESCALATE: '#8b5cf6',
};

/**
 * Builds graph data while preserving node object identity so ForceGraph3D
 * keeps d3-force positions (x, y, z) stable across updates.
 * New events add links without jarring re-simulation.
 */
export function useGraphData(
  liveEvents: LiveEvent[],
  agents: AgentInfo[],
  theme: 'dark' | 'light' = 'dark',
): GraphData & { recentBlocks: Set<string> } {
  const DECISION_COLORS = theme === 'dark' ? DECISION_COLORS_DARK : DECISION_COLORS_LIGHT;
  const DECISION_PARTICLE = theme === 'dark' ? DECISION_PARTICLE_DARK : DECISION_PARTICLE_LIGHT;

  // Track nodes involved in recent BLOCK events (for cinematographic pulse)
  const [recentBlocks, setRecentBlocks] = useState<Set<string>>(new Set());
  const blockTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const addBlockNode = useCallback((nodeId: string) => {
    setRecentBlocks((prev) => {
      const next = new Set(prev);
      next.add(nodeId);
      return next;
    });
    // Clear existing timer for this node
    const existing = blockTimersRef.current.get(nodeId);
    if (existing) clearTimeout(existing);
    // Remove after 3 seconds
    const timer = setTimeout(() => {
      setRecentBlocks((prev) => {
        const next = new Set(prev);
        next.delete(nodeId);
        return next;
      });
      blockTimersRef.current.delete(nodeId);
    }, 3000);
    blockTimersRef.current.set(nodeId, timer);
  }, []);

  // Watch for new BLOCK events
  const lastBlockCheckRef = useRef(0);
  useEffect(() => {
    for (let i = 0; i < liveEvents.length && i < 5; i++) {
      const ev = liveEvents[i];
      if (ev.decision === 'BLOCK') {
        const agentId = `agent-${ev.source?.agent ?? 'unknown'}`;
        addBlockNode(agentId);
        addBlockNode('puffer');
      }
    }
    lastBlockCheckRef.current = liveEvents.length;
  }, [liveEvents, addBlockNode]);

  // Throttle: only recalculate graph data at most every 1500ms
  // This prevents jumps when many events arrive rapidly
  const [throttledEvents, setThrottledEvents] = useState(liveEvents);
  const throttleRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (throttleRef.current) return; // already scheduled
    throttleRef.current = setTimeout(() => {
      setThrottledEvents(liveEvents);
      throttleRef.current = null;
    }, 1500);
  }, [liveEvents]);

  // Persistent node cache — same object refs across renders
  const nodeCacheRef = useRef<Map<string, GraphNode>>(new Map());
  const prevEventCountRef = useRef(0);

  return useMemo(() => {
    const cache = nodeCacheRef.current;
    const seenIds = new Set<string>();
    const linkList: GraphLink[] = [];

    // Get or create a node, REUSING the existing object to preserve d3 position.
    // Merges hostProgram and parentAgentId into existing nodes when available.
    const ensureNode = (id: string, defaults: Omit<GraphNode, 'id'>) => {
      if (!cache.has(id)) {
        cache.set(id, { id, ...defaults });
      } else {
        const existing = cache.get(id)!;
        if (defaults.hostProgram && !existing.hostProgram) {
          existing.hostProgram = defaults.hostProgram;
        }
        if (defaults.parentAgentId && !existing.parentAgentId) {
          existing.parentAgentId = defaults.parentAgentId;
        }
      }
      seenIds.add(id);
    };

    // Central node — fixed at origin
    ensureNode('puffer', {
      name: 'Your Computer',
      type: 'puffer',
      val: 2,
      color: '#f59e0b',
      fx: 0,
      fy: 0,
      fz: 0,
    });

    for (const agent of agents) {
      ensureNode(`agent-${agent.name}`, {
        name: agent.name,
        type: 'agent',
        val: 1,
        color: '#3b82f6',
        hostProgram: agent.hostProgram,
      });
    }

    for (const event of throttledEvents) {
      const provider = event.source?.provider ?? 'unknown';
      const agent = event.source?.agent ?? 'unknown';
      const agentId = `agent-${agent}`;
      const providerId = `provider-${provider}`;

      ensureNode(agentId, { name: agent, type: 'agent', val: 1, color: '#3b82f6' });
      ensureNode(providerId, { name: provider, type: 'provider', val: 1, color: '#ec4899' });

      const decision = event.decision ?? 'ALLOW';
      const linkColor = DECISION_COLORS[decision] ?? '#6b7280';
      const particleColor = DECISION_PARTICLE[decision] ?? '#9ca3af';
      const actionType = event.action?.type;

      if (actionType === 'mcp_tool_call' || actionType === 'mcp_tool_result') {
        const action = event.action as Record<string, unknown>;
        const server = String(action.server ?? 'unknown');
        const isSubagent = server === 'claude-code-agent';
        // Subagents get unique IDs per parent agent; MCP servers are shared
        const nodeId = isSubagent ? `subagent-${agent}-${server}` : `mcp-${server}`;
        const nodeColor = isSubagent ? '#8b5cf6' : '#22d3ee';

        ensureNode(nodeId, {
          name: isSubagent ? 'Sub-Agent' : server,
          type: isSubagent ? 'subagent' : 'mcp',
          val: 1,
          color: nodeColor,
          parentAgentId: isSubagent ? agentId : undefined,
        });

        if (isSubagent) {
          // Sub-agents link directly to their parent agent (not through puffer)
          if (actionType === 'mcp_tool_call') {
            linkList.push({
              source: agentId,
              target: nodeId,
              color: nodeColor + '30',
              curvature: 0.15,
              eventId: event.id + '-subagent',
              decision,
              particleCount: 1,
              particleSpeed: 0.012,
              particleColor: nodeColor,
            });
          } else {
            const lightColor = '#fed7aa';
            linkList.push({
              source: nodeId,
              target: agentId,
              color: lightColor + '25',
              curvature: 0.15,
              eventId: event.id + '-subagent-res',
              decision,
              particleCount: 1,
              particleSpeed: 0.01,
              particleColor: lightColor,
            });
          }
        } else {
          // MCP servers still route through puffer hub
          if (actionType === 'mcp_tool_call') {
            linkList.push({
              source: agentId,
              target: 'puffer',
              color: nodeColor + '30',
              curvature: 0.2,
              eventId: event.id + '-mcp-in',
              decision,
              particleCount: 1,
              particleSpeed: 0.012,
              particleColor: nodeColor,
            });
            linkList.push({
              source: 'puffer',
              target: nodeId,
              color: nodeColor + '25',
              curvature: 0.2,
              eventId: event.id + '-mcp-out',
              decision,
              particleCount: 1,
              particleSpeed: 0.01,
              particleColor: nodeColor,
            });
          } else {
            const lightColor = '#a5f3fc';
            linkList.push({
              source: nodeId,
              target: 'puffer',
              color: lightColor + '25',
              curvature: 0.2,
              eventId: event.id + '-mcp-res-in',
              decision,
              particleCount: 1,
              particleSpeed: 0.01,
              particleColor: lightColor,
            });
            linkList.push({
              source: 'puffer',
              target: agentId,
              color: lightColor + '20',
              curvature: 0.2,
              eventId: event.id + '-mcp-res-out',
              decision,
              particleCount: 1,
              particleSpeed: 0.01,
              particleColor: lightColor,
            });
          }
        }
        continue;
      }

      const isResponse = actionType === 'llm_response';

      if (isResponse) {
        linkList.push({
          source: providerId,
          target: 'puffer',
          color: '#fbbf2425',
          curvature: 0.2,
          eventId: event.id + '-resp-in',
          decision,
          particleCount: 1,
          particleSpeed: 0.012,
          particleColor: '#fcd34d',
        });
        linkList.push({
          source: 'puffer',
          target: agentId,
          color: '#fbbf2420',
          curvature: 0.2,
          eventId: event.id + '-resp-out',
          decision,
          particleCount: 1,
          particleSpeed: 0.01,
          particleColor: '#fcd34d',
        });
      } else {
        linkList.push({
          source: agentId,
          target: 'puffer',
          color: linkColor + '30',
          curvature: 0.2,
          eventId: event.id,
          decision,
          particleCount: decision === 'BLOCK' ? 4 : 1,
          particleSpeed: decision === 'BLOCK' ? 0.022 : 0.012,
          particleColor,
        });
        if (decision !== 'BLOCK') {
          linkList.push({
            source: 'puffer',
            target: providerId,
            color: linkColor + '25',
            curvature: 0.2,
            eventId: event.id + '-out',
            decision,
            particleCount: 1,
            particleSpeed: 0.01,
            particleColor,
          });
        }
      }
    }

    const maxLinks = 30;
    const trimmedLinks = linkList.slice(0, maxLinks);

    // Subtle pulse on newest event only
    const isNew = throttledEvents.length !== prevEventCountRef.current;
    prevEventCountRef.current = throttledEvents.length;
    if (isNew && trimmedLinks.length > 0) {
      trimmedLinks[0].particleCount = 2;
      trimmedLinks[0].particleSpeed = 0.018;
    }

    // Prune stale nodes
    for (const id of cache.keys()) {
      if (!seenIds.has(id)) cache.delete(id);
    }

    // Return new wrapper but with SAME node object references
    // ForceGraph3D matches nodes by id and preserves positions
    return {
      nodes: Array.from(cache.values()),
      links: trimmedLinks,
      recentBlocks,
    };
  }, [throttledEvents, agents, theme, DECISION_COLORS, DECISION_PARTICLE, recentBlocks]);
}
