import { useMemo, useRef } from 'react';
import type { LiveEvent, AgentInfo } from '../App';

export interface GraphNode {
  id: string;
  name: string;
  type: 'puffer' | 'agent' | 'provider';
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

// SpaceX-style monochromatic — only decision colors differ subtly
const DECISION_COLORS: Record<string, string> = {
  ALLOW: '#d1d5db',    // soft white-grey
  BLOCK: '#f87171',    // muted red (only accent)
  AUDIT: '#fbbf24',    // muted amber
  ESCALATE: '#c084fc', // muted purple
};

const DECISION_PARTICLE: Record<string, string> = {
  ALLOW: '#e5e7eb',
  BLOCK: '#f87171',
  AUDIT: '#fbbf24',
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
      val: 3,
      color: '#ffffff',
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
          color: '#e5e7eb',
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
          color: '#e5e7eb',
        });
      }

      const providerId = `provider-${provider}`;
      if (!nodeMap.has(providerId)) {
        nodeMap.set(providerId, {
          id: providerId,
          name: provider,
          type: 'provider',
          val: 1,
          color: '#9ca3af',
        });
      }

      const decision = event.decision ?? 'ALLOW';
      const linkColor = DECISION_COLORS[decision] ?? '#6b7280';
      const particleColor = DECISION_PARTICLE[decision] ?? '#9ca3af';
      const isResponse = event.action?.type === 'llm_response';

      if (isResponse) {
        // Response path: provider → puffer → agent (reverse flow)
        linkList.push({
          source: providerId,
          target: 'puffer',
          color: '#60a5fa30',
          curvature: 0.3,
          eventId: event.id + '-resp-in',
          decision,
          particleCount: 2,
          particleSpeed: 0.009,
          particleColor: '#93c5fd',
        });
        linkList.push({
          source: 'puffer',
          target: agentId,
          color: '#60a5fa20',
          curvature: 0.3,
          eventId: event.id + '-resp-out',
          decision,
          particleCount: 2,
          particleSpeed: 0.007,
          particleColor: '#93c5fd',
        });
      } else {
        // Request path: agent → puffer → provider
        linkList.push({
          source: agentId,
          target: 'puffer',
          color: linkColor + '30',
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
            color: linkColor + '20',
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
