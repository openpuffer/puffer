import React, { useEffect } from 'react';
import { useApi } from '../hooks/useApi';
import type { AgentInfo } from '../App';

interface Agent {
  id: string;
  name: string;
  pid?: number;
  detectedVia: string;
  status: 'protected' | 'unprotected' | 'partial';
  provider?: string;
  port?: number;
}

interface AgentsResponse {
  agents: Agent[];
}

interface AgentListProps {
  agents: AgentInfo[];
}

const statusStyles: Record<string, { badge: string; dot: string }> = {
  protected: {
    badge: 'bg-puffer-green/20 text-puffer-green border-puffer-green/30',
    dot: 'bg-puffer-green',
  },
  unprotected: {
    badge: 'bg-puffer-red/20 text-puffer-red border-puffer-red/30',
    dot: 'bg-puffer-red',
  },
  partial: {
    badge: 'bg-puffer-yellow/20 text-puffer-yellow border-puffer-yellow/30',
    dot: 'bg-puffer-yellow',
  },
};

const AgentList: React.FC<AgentListProps> = ({ agents: wsAgents }) => {
  const { data, loading, error, refetch } = useApi<AgentsResponse>('/api/agents');

  // Auto-refresh API every 15 seconds
  useEffect(() => {
    const interval = setInterval(refetch, 15000);
    return () => clearInterval(interval);
  }, [refetch]);

  if (loading && !data && wsAgents.length === 0) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-slate-400">Loading agents...</div>
      </div>
    );
  }

  if (error && wsAgents.length === 0) {
    return (
      <div className="rounded-lg border border-puffer-red/20 bg-puffer-red/5 p-6">
        <p className="text-puffer-red">Failed to load agents: {error}</p>
      </div>
    );
  }

  // Use WebSocket agents if available, otherwise fall back to API
  const agents: Agent[] = wsAgents.length > 0
    ? wsAgents.map((a) => ({
        id: a.id,
        name: a.name,
        pid: a.pid ?? undefined,
        detectedVia: a.detectedVia,
        status: (a.status as Agent['status']) || 'unprotected',
        provider: a.type,
        port: a.port ?? undefined,
      }))
    : data?.agents ?? [];

  if (agents.length === 0) {
    return (
      <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-8 text-center">
        <p className="text-slate-400">No agents discovered yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-slate-200">
        Discovered Agents ({agents.length})
      </h3>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {agents.map((agent) => {
          const style = statusStyles[agent.status] ?? statusStyles.unprotected;
          return (
            <div
              key={agent.id}
              className="rounded-lg border border-slate-700 bg-slate-800/50 p-5"
            >
              <div className="mb-3 flex items-start justify-between">
                <div>
                  <h4 className="font-semibold text-slate-100">
                    {agent.name}
                  </h4>
                  {agent.pid != null && (
                    <p className="mt-0.5 font-mono text-xs text-slate-500">
                      PID {agent.pid}
                    </p>
                  )}
                </div>
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${style.badge}`}
                >
                  <span
                    className={`inline-block h-1.5 w-1.5 rounded-full ${style.dot}`}
                  />
                  {agent.status}
                </span>
              </div>

              <dl className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <dt className="text-slate-500">Detected via</dt>
                  <dd className="text-slate-300">{agent.detectedVia}</dd>
                </div>
                {agent.provider && (
                  <div className="flex justify-between">
                    <dt className="text-slate-500">Provider</dt>
                    <dd className="text-slate-300">{agent.provider}</dd>
                  </div>
                )}
                {agent.port != null && (
                  <div className="flex justify-between">
                    <dt className="text-slate-500">Port</dt>
                    <dd className="font-mono text-slate-300">{agent.port}</dd>
                  </div>
                )}
              </dl>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default AgentList;
