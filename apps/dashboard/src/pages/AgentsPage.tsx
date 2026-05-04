import React from 'react';
import AgentList from '../components/AgentList';
import { useDashboard } from '../context/DashboardContext';

const AgentsPage: React.FC = () => {
  const { agents } = useDashboard();
  return (
    <div className="h-full overflow-y-auto px-6 py-6">
      <header className="mb-4">
        <h1 className="font-mono text-lg font-bold uppercase tracking-widest text-slate-100">
          Agents
        </h1>
        <p className="font-mono text-[11px] uppercase tracking-wider text-slate-500">
          Discovered agents · {agents.length} total
        </p>
      </header>
      <AgentList agents={agents} />
    </div>
  );
};

export default AgentsPage;
