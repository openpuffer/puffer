import React, { useState, useCallback } from 'react';
import Overview from './components/Overview';
import EventList from './components/EventList';
import AgentList from './components/AgentList';
import AlertList from './components/AlertList';
import ConfigEditor from './components/ConfigEditor';
import { useWebSocket } from './hooks/useWebSocket';

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
  allowed: number;
  activeAgents: number;
  mode: string;
}

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [stats, setStats] = useState<Stats>({
    totalEvents: 0,
    blocked: 0,
    allowed: 0,
    activeAgents: 0,
    mode: 'audit',
  });

  const handleWsMessage = useCallback((data: unknown) => {
    const msg = data as Record<string, unknown>;
    if (msg.type === 'stats') {
      setStats((prev) => ({ ...prev, ...(msg.payload as Partial<Stats>) }));
    }
  }, []);

  const { connected } = useWebSocket(handleWsMessage);

  // Fetch initial stats
  React.useEffect(() => {
    fetch('/api/stats')
      .then((res) => res.json())
      .then((data) => setStats((prev) => ({ ...prev, ...data })))
      .catch(() => {
        // API may not be available yet
      });
  }, []);

  return (
    <div className="min-h-screen bg-puffer-dark">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-puffer-blue/20">
              <svg
                className="h-5 w-5 text-puffer-blue"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                />
              </svg>
            </div>
            <h1 className="text-xl font-bold text-slate-100">
              Puffer
            </h1>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span
                className={`inline-block h-2 w-2 rounded-full ${
                  connected ? 'bg-puffer-green' : 'bg-slate-600'
                }`}
              />
              <span className="text-xs text-slate-500">
                {connected ? 'Connected' : 'Disconnected'}
              </span>
            </div>
            <span className="rounded-full border border-puffer-blue/30 bg-puffer-blue/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-puffer-blue">
              {stats.mode}
            </span>
          </div>
        </div>
      </header>

      {/* Tab Bar */}
      <nav className="border-b border-slate-800 bg-slate-900/40">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex gap-1">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
                  activeTab === tab.id
                    ? 'border-puffer-blue text-puffer-blue'
                    : 'border-transparent text-slate-400 hover:border-slate-600 hover:text-slate-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </nav>

      {/* Content */}
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {activeTab === 'overview' && (
          <Overview
            totalEvents={stats.totalEvents}
            blocked={stats.blocked}
            allowed={stats.allowed}
            activeAgents={stats.activeAgents}
          />
        )}
        {activeTab === 'events' && <EventList />}
        {activeTab === 'agents' && <AgentList />}
        {activeTab === 'alerts' && <AlertList />}
        {activeTab === 'config' && <ConfigEditor />}
      </main>
    </div>
  );
};

export default App;
