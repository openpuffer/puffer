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
  ALLOW: '#fbbf24',    // warm amber
  BLOCK: '#f87171',    // muted red
  AUDIT: '#fb923c',    // orange
  ESCALATE: '#c084fc', // purple (cool contrast)
};

const DECISION_PARTICLE: Record<string, string> = {
  ALLOW: '#fcd34d',
  BLOCK: '#f87171',
  AUDIT: '#fb923c',
  ESCALATE: '#c084fc',
};

export function useGraphData(
  liveEvents: LiveEvent[],
  agents: AgentInfo[]
): GraphData {
  const prevLinkCountRef = useRef(0);

  return useMemo(() => {
    const nodeMap = new Map<string, GraphNode>();
    const linkList: GraphLink[] = [];

    // Central node — white core, fixed at origin
    nodeMap.set('puffer', {
      id: 'puffer',
      name: 'Your Computer',
      type: 'puffer',
      val: 2,
      color: '#f59e0b',
      fx: 0,
      fy: 0,
      fz: 0,
    });

    // Agent nodes from discovery
    for (const agent of agents) {
      const agentId = `agent-${agent.name}`;
      if (!nodeMap.has(agentId)) {
        nodeMap.set(agentId, {
          id: agentId,
          name: agent.name,
          type: 'agent',
          val: 1,
          color: '#fb923c',
        });
      }
    }

    const providerSet = new Set<string>();

    for (const event of liveEvents) {
      const provider = event.source?.provider ?? 'unknown';
      const agent = event.source?.agent ?? 'unknown';

      providerSet.add(provider);

      const agentId = `agent-${agent}`;
      if (!nodeMap.has(agentId)) {
        nodeMap.set(agentId, {
          id: agentId,
          name: agent,
          type: 'agent',
          val: 1,
          color: '#fb923c',
        });
      }

      const providerId = `provider-${provider}`;
      if (!nodeMap.has(providerId)) {
        nodeMap.set(providerId, {
          id: providerId,
          name: provider,
          type: 'provider',
          val: 1,
          color: '#f59e0b',
        });
      }

      const decision = event.decision ?? 'ALLOW';
      const linkColor = DECISION_COLORS[decision] ?? '#6b7280';
      const particleColor = DECISION_PARTICLE[decision] ?? '#9ca3af';
      const actionType = event.action?.type;

      // MCP / sub-agent events
      if (actionType === 'mcp_tool_call' || actionType === 'mcp_tool_result') {
        const action = event.action as Record<string, unknown>;
        const server = String(action.server ?? 'unknown');
        const isSubagent = server === 'claude-code-agent';
        const nodeId = isSubagent ? `subagent-${server}` : `mcp-${server}`;
        const nodeColor = isSubagent ? '#fb923c' : '#22d3ee';

        if (!nodeMap.has(nodeId)) {
          nodeMap.set(nodeId, {
            id: nodeId,
            name: isSubagent ? 'Sub-Agent' : server,
            type: isSubagent ? 'subagent' : 'mcp',
            val: 1,
            color: nodeColor,
          });
        }

        if (actionType === 'mcp_tool_call') {
          // agent → puffer → mcp/subagent
          linkList.push({
            source: agentId,
            target: 'puffer',
            color: nodeColor + '50',
            curvature: 0.25,
            eventId: event.id + '-mcp-in',
            decision,
            particleCount: 3,
            particleSpeed: 0.01,
            particleColor: nodeColor,
          });
          linkList.push({
            source: 'puffer',
            target: nodeId,
            color: nodeColor + '40',
            curvature: 0.3,
            eventId: event.id + '-mcp-out',
            decision,
            particleCount: 2,
            particleSpeed: 0.008,
            particleColor: nodeColor,
          });
        } else {
          // mcp_tool_result: mcp/subagent → puffer → agent (reverse)
          const lightColor = isSubagent ? '#fed7aa' : '#a5f3fc';
          linkList.push({
            source: nodeId,
            target: 'puffer',
            color: lightColor + '40',
            curvature: 0.3,
            eventId: event.id + '-mcp-res-in',
            decision,
            particleCount: 2,
            particleSpeed: 0.007,
            particleColor: lightColor,
          });
          linkList.push({
            source: 'puffer',
            target: agentId,
            color: lightColor + '35',
            curvature: 0.25,
            eventId: event.id + '-mcp-res-out',
            decision,
            particleCount: 1,
            particleSpeed: 0.006,
            particleColor: lightColor,
          });
        }
        continue;
      }

      const isResponse = actionType === 'llm_response';

      if (isResponse) {
        // Response path: provider → puffer → agent (reverse flow)
        linkList.push({
          source: providerId,
          target: 'puffer',
          color: '#fbbf2440',
          curvature: 0.3,
          eventId: event.id + '-resp-in',
          decision,
          particleCount: 2,
          particleSpeed: 0.009,
          particleColor: '#fcd34d',
        });
        linkList.push({
          source: 'puffer',
          target: agentId,
          color: '#fbbf2430',
          curvature: 0.3,
          eventId: event.id + '-resp-out',
          decision,
          particleCount: 2,
          particleSpeed: 0.007,
          particleColor: '#fcd34d',
        });
      } else {
        // Request path: agent → puffer → provider
        linkList.push({
          source: agentId,
          target: 'puffer',
          color: linkColor + '50',
          curvature: 0.25,
          eventId: event.id,
          decision,
          particleCount: decision === 'BLOCK' ? 5 : 2,
          particleSpeed: decision === 'BLOCK' ? 0.018 : 0.007,
          particleColor,
        });

        if (decision !== 'BLOCK') {
          linkList.push({
            source: 'puffer',
            target: providerId,
            color: linkColor + '40',
            curvature: 0.25,
            eventId: event.id + '-out',
            decision,
            particleCount: 1,
            particleSpeed: 0.005,
            particleColor,
          });
        }
      }
    }

    const maxLinks = 80;
    const trimmedLinks = linkList.slice(0, maxLinks);

    const isNewEvent = trimmedLinks.length !== prevLinkCountRef.current;
    prevLinkCountRef.current = trimmedLinks.length;

    if (isNewEvent && trimmedLinks.length > 0) {
      trimmedLinks[0].particleCount = 6;
      trimmedLinks[0].particleSpeed = 0.02;
    }

    return {
      nodes: Array.from(nodeMap.values()),
      links: trimmedLinks,
    };
  }, [liveEvents, agents]);
}
