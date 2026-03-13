import { useMemo, useRef } from 'react';
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
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

// Warm amber neural-network palette
const DECISION_COLORS: Record<string, string> = {
  ALLOW: '#fbbf24',
  BLOCK: '#f87171',
  AUDIT: '#fb923c',
  ESCALATE: '#c084fc',
};

const DECISION_PARTICLE: Record<string, string> = {
  ALLOW: '#fcd34d',
  BLOCK: '#f87171',
  AUDIT: '#fb923c',
  ESCALATE: '#c084fc',
};

/**
 * Builds graph data while preserving node object identity so ForceGraph3D
 * keeps d3-force positions (x, y, z) stable across updates.
 * New events add links without jarring re-simulation.
 */
export function useGraphData(
  liveEvents: LiveEvent[],
  agents: AgentInfo[]
): GraphData {
  // Persistent node cache — same object refs across renders
  const nodeCacheRef = useRef<Map<string, GraphNode>>(new Map());
  const prevEventCountRef = useRef(0);

  return useMemo(() => {
    const cache = nodeCacheRef.current;
    const seenIds = new Set<string>();
    const linkList: GraphLink[] = [];

    // Get or create a node, REUSING the existing object to preserve d3 position
    const ensureNode = (id: string, defaults: Omit<GraphNode, 'id'>) => {
      if (!cache.has(id)) {
        cache.set(id, { id, ...defaults });
      }
      seenIds.add(id);
    };

    // Central node — fixed at origin
    ensureNode('puffer', {
      name: 'Your Computer', type: 'puffer', val: 2, color: '#f59e0b',
      fx: 0, fy: 0, fz: 0,
    });

    for (const agent of agents) {
      ensureNode(`agent-${agent.name}`, {
        name: agent.name, type: 'agent', val: 1, color: '#fb923c',
      });
    }

    for (const event of liveEvents) {
      const provider = event.source?.provider ?? 'unknown';
      const agent = event.source?.agent ?? 'unknown';
      const agentId = `agent-${agent}`;
      const providerId = `provider-${provider}`;

      ensureNode(agentId, { name: agent, type: 'agent', val: 1, color: '#fb923c' });
      ensureNode(providerId, { name: provider, type: 'provider', val: 1, color: '#f59e0b' });

      const decision = event.decision ?? 'ALLOW';
      const linkColor = DECISION_COLORS[decision] ?? '#6b7280';
      const particleColor = DECISION_PARTICLE[decision] ?? '#9ca3af';
      const actionType = event.action?.type;

      if (actionType === 'mcp_tool_call' || actionType === 'mcp_tool_result') {
        const action = event.action as Record<string, unknown>;
        const server = String(action.server ?? 'unknown');
        const isSubagent = server === 'claude-code-agent';
        const nodeId = isSubagent ? `subagent-${server}` : `mcp-${server}`;
        const nodeColor = isSubagent ? '#fb923c' : '#22d3ee';

        ensureNode(nodeId, {
          name: isSubagent ? 'Sub-Agent' : server,
          type: isSubagent ? 'subagent' : 'mcp',
          val: 1, color: nodeColor,
        });

        if (actionType === 'mcp_tool_call') {
          linkList.push({
            source: agentId, target: 'puffer',
            color: nodeColor + '30', curvature: 0.2,
            eventId: event.id + '-mcp-in', decision,
            particleCount: 1, particleSpeed: 0.004, particleColor: nodeColor,
          });
          linkList.push({
            source: 'puffer', target: nodeId,
            color: nodeColor + '25', curvature: 0.2,
            eventId: event.id + '-mcp-out', decision,
            particleCount: 1, particleSpeed: 0.003, particleColor: nodeColor,
          });
        } else {
          const lightColor = isSubagent ? '#fed7aa' : '#a5f3fc';
          linkList.push({
            source: nodeId, target: 'puffer',
            color: lightColor + '25', curvature: 0.2,
            eventId: event.id + '-mcp-res-in', decision,
            particleCount: 1, particleSpeed: 0.003, particleColor: lightColor,
          });
          linkList.push({
            source: 'puffer', target: agentId,
            color: lightColor + '20', curvature: 0.2,
            eventId: event.id + '-mcp-res-out', decision,
            particleCount: 1, particleSpeed: 0.003, particleColor: lightColor,
          });
        }
        continue;
      }

      const isResponse = actionType === 'llm_response';

      if (isResponse) {
        linkList.push({
          source: providerId, target: 'puffer',
          color: '#fbbf2425', curvature: 0.2,
          eventId: event.id + '-resp-in', decision,
          particleCount: 1, particleSpeed: 0.004, particleColor: '#fcd34d',
        });
        linkList.push({
          source: 'puffer', target: agentId,
          color: '#fbbf2420', curvature: 0.2,
          eventId: event.id + '-resp-out', decision,
          particleCount: 1, particleSpeed: 0.003, particleColor: '#fcd34d',
        });
      } else {
        linkList.push({
          source: agentId, target: 'puffer',
          color: linkColor + '30', curvature: 0.2,
          eventId: event.id, decision,
          particleCount: decision === 'BLOCK' ? 2 : 1,
          particleSpeed: decision === 'BLOCK' ? 0.006 : 0.004,
          particleColor,
        });
        if (decision !== 'BLOCK') {
          linkList.push({
            source: 'puffer', target: providerId,
            color: linkColor + '25', curvature: 0.2,
            eventId: event.id + '-out', decision,
            particleCount: 1, particleSpeed: 0.003, particleColor,
          });
        }
      }
    }

    const maxLinks = 80;
    const trimmedLinks = linkList.slice(0, maxLinks);

    // Subtle pulse on newest event only
    const isNew = liveEvents.length !== prevEventCountRef.current;
    prevEventCountRef.current = liveEvents.length;
    if (isNew && trimmedLinks.length > 0) {
      trimmedLinks[0].particleCount = 2;
      trimmedLinks[0].particleSpeed = 0.006;
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
    };
  }, [liveEvents, agents]);
}
