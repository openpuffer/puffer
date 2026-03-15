import React, { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import NetworkGraph3D from './components/NetworkGraph3D';
import HUDOverlay from './components/HUDOverlay';
import EventList from './components/EventList';
import AgentList from './components/AgentList';
import ConfigEditor from './components/ConfigEditor';
import AgentDetailPanel from './components/AgentDetailPanel';
import { useWebSocket } from './hooks/useWebSocket';
import { useGraphData, type GraphNode } from './hooks/useGraphData';
import { useTheme } from './hooks/useTheme';

interface Stats {
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
  action: { type: string; server?: string; tool?: string; description?: string; subagentType?: string };
  decision: 'ALLOW' | 'BLOCK' | 'AUDIT' | 'ESCALATE';
  layers: { layer: string; name: string; verdict: string }[];
  metadata?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    costEstimate?: number;
    model?: string;
    rateLimits?: { limitTokens?: number; limitRequests?: number; remainingTokens?: number; remainingRequests?: number };
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

const MAX_LIVE_EVENTS = 200;

const PANEL_COMPONENTS: Record<string, React.FC<any>> = {
  events: EventList,
  agents: AgentList,
  config: ConfigEditor,
  'agent-detail': AgentDetailPanel,
};

const PANEL_TITLES: Record<string, string> = {
  events: 'EVENT LOG',
  agents: 'AGENTS',
  config: 'CONFIGURATION',
  'agent-detail': 'AGENT DETAIL',
};

const App: React.FC = () => {
  const [stats, setStats] = useState<Stats>({
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
  });
  const [liveEvents, setLiveEvents] = useState<LiveEvent[]>([]);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [activePanel, setActivePanel] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);

  const handleWsMessage = useCallback((data: unknown) => {
    const msg = data as Record<string, unknown>;
    if (msg.type === 'stats') {
      setStats((prev) => ({ ...prev, ...(msg.payload as Partial<Stats>) }));
    } else if (msg.type === 'event') {
      const event = msg.data as LiveEvent;
      setLiveEvents((prev) => [event, ...prev].slice(0, MAX_LIVE_EVENTS));
    } else if (msg.type === 'agents') {
      const payload = msg.payload as Record<string, unknown>;
      setAgents((payload.agents ?? msg.data) as AgentInfo[]);
    }
  }, []);

  const { connected } = useWebSocket(handleWsMessage);

  // Fetch stats on mount and auto-refresh
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

  // Build 3D graph data
  const { theme } = useTheme();
  const graphData = useGraphData(liveEvents, agents, theme);

  const handleOpenPanel = useCallback((panel: string) => {
    setActivePanel((prev) => (prev === panel ? null : panel));
  }, []);

  const handleClosePanel = useCallback(() => {
    setActivePanel(null);
    setSelectedNode(null);
  }, []);

  const handleNodeClick = useCallback((node: GraphNode) => {
    setSelectedNode(node);
    setActivePanel('agent-detail');
  }, []);

  // Props for drawer panels
  const panelProps: Record<string, any> = {
    events: { liveEvents },
    agents: { agents },
    config: {},
    'agent-detail': { node: selectedNode, agents, liveEvents },
  };

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-slate-50 dark:bg-[#06080d]">
      {/* 3D Force Graph Background */}
      <NetworkGraph3D graphData={graphData} onNodeClick={handleNodeClick} />

      {/* HUD Overlay */}
      <HUDOverlay
        stats={stats}
        liveEvents={liveEvents}
        agents={agents}
        connected={connected}
        onOpenPanel={handleOpenPanel}
        panelOpen={!!activePanel}
      />

      {/* Slide-out Drawer Panel */}
      <AnimatePresence>
        {activePanel && PANEL_COMPONENTS[activePanel] && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="absolute inset-0 z-20 bg-black/20 dark:bg-black/40 backdrop-blur-sm"
              onClick={handleClosePanel}
            />

            {/* Panel */}
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 250 }}
              className="absolute right-0 top-0 bottom-0 z-30 w-[900px] max-w-[90vw] drawer-panel"
            >
              {/* Panel header */}
              <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
                <span className="font-mono text-sm font-bold text-slate-800 dark:text-cyan-400 tracking-wider">
                  {PANEL_TITLES[activePanel]}
                </span>
                <button
                  onClick={handleClosePanel}
                  className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-black/5 dark:hover:bg-white/10 hover:text-slate-800 dark:hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Panel content */}
              <div className="h-[calc(100%-57px)] overflow-y-auto overflow-x-hidden p-5 pb-10 scrollbar-thin">
                {React.createElement(
                  PANEL_COMPONENTS[activePanel],
                  panelProps[activePanel]
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
};

export default App;
