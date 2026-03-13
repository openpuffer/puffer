import React, { useState, useCallback, useEffect } from 'react';
import { ShieldCheck } from 'lucide-react';
import Overview from './components/Overview';
import EventList from './components/EventList';
import AgentList from './components/AgentList';
import AlertList from './components/AlertList';
import ConfigEditor from './components/ConfigEditor';
import { useWebSocket } from './hooks/useWebSocket';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { TooltipProvider } from '@/components/ui/tooltip';

type Tab = 'overview' | 'events' | 'agents' | 'alerts' | 'config';

const tabs: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'events', label: 'Events' },
  { id: 'agents', label: 'Agents' },
  { id: 'alerts', label: 'Alerts' },
  { id: 'config', label: 'Config' },
];

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
  eventsPerMinute: number;
  mode: string;
}

export interface LiveEvent {
  id: string;
  timestamp: string;
  source: { agent: string; provider: string };
  action: { type: string };
  decision: 'ALLOW' | 'BLOCK' | 'AUDIT' | 'ESCALATE';
  layers: { layer: string; name: string; verdict: string }[];
}

export interface AgentInfo {
  id: string;
  name: string;
  type: string;
  detectedVia: string;
  pid: number | null;
  port: number | null;
  status: string;
  firstSeen: string;
  lastSeen: string;
}

const MAX_LIVE_EVENTS = 200;

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<Tab>('overview');
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
    eventsPerMinute: 0,
    mode: 'audit',
  });
  const [liveEvents, setLiveEvents] = useState<LiveEvent[]>([]);
  const [agents, setAgents] = useState<AgentInfo[]>([]);

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

  // Fetch stats on mount and auto-refresh every 5 seconds
  useEffect(() => {
    const fetchStats = () => {
      fetch('/api/stats')
        .then((res) => res.json())
        .then((data) => setStats((prev) => ({ ...prev, ...data })))
        .catch(() => {
          // API may not be available yet
        });
    };
    fetchStats();
    const interval = setInterval(fetchStats, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-background text-foreground">
        {/* Header */}
        <header className="border-b border-border bg-card/80 backdrop-blur">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-puffer-blue/20">
                <ShieldCheck className="h-5 w-5 text-puffer-blue" />
              </div>
              <h1 className="text-xl font-bold text-foreground">
                Puffer
              </h1>
            </div>

            <div className="flex items-center gap-3">
              <Badge
                variant="outline"
                className={
                  connected
                    ? 'border-puffer-green/40 bg-puffer-green/10 text-puffer-green'
                    : 'border-muted text-muted-foreground'
                }
              >
                <span
                  className={`mr-1.5 inline-block h-2 w-2 rounded-full ${
                    connected ? 'bg-puffer-green' : 'bg-muted-foreground'
                  }`}
                />
                {connected ? 'Connected' : 'Disconnected'}
              </Badge>

              <Separator orientation="vertical" className="h-6" />

              <Badge
                variant="outline"
                className="border-puffer-blue/30 bg-puffer-blue/10 uppercase tracking-wide text-puffer-blue"
              >
                {stats.mode}
              </Badge>
            </div>
          </div>
        </header>

        {/* Tab Navigation & Content */}
        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as Tab)}
          className="mx-auto max-w-7xl"
        >
          <div className="border-b border-border px-4 sm:px-6 lg:px-8">
            <TabsList className="h-auto gap-1 rounded-none border-none bg-transparent p-0">
              {tabs.map((tab) => (
                <TabsTrigger
                  key={tab.id}
                  value={tab.id}
                  className="rounded-none border-b-2 border-transparent px-4 py-3 text-sm font-medium text-muted-foreground shadow-none transition-colors hover:text-foreground data-[state=active]:border-puffer-blue data-[state=active]:bg-transparent data-[state=active]:text-puffer-blue data-[state=active]:shadow-none"
                >
                  {tab.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          <main className="px-4 py-6 sm:px-6 lg:px-8">
            <TabsContent value="overview" className="mt-0">
              <Overview
                totalEvents={stats.totalEvents}
                blocked={stats.blocked || stats.blockedEvents}
                allowed={stats.allowed || stats.allowedEvents}
                activeAgents={stats.activeAgents}
                liveEvents={liveEvents}
                eventsPerMinute={stats.eventsPerMinute}
                totalCost={stats.totalCost}
              />
            </TabsContent>
            <TabsContent value="events" className="mt-0">
              <EventList liveEvents={liveEvents} />
            </TabsContent>
            <TabsContent value="agents" className="mt-0">
              <AgentList agents={agents} />
            </TabsContent>
            <TabsContent value="alerts" className="mt-0">
              <AlertList liveEvents={liveEvents} />
            </TabsContent>
            <TabsContent value="config" className="mt-0">
              <ConfigEditor />
            </TabsContent>
          </main>
        </Tabs>
      </div>
    </TooltipProvider>
  );
};

export default App;
