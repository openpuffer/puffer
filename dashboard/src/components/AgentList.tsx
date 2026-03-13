import React, { useEffect } from 'react';
import { useApi } from '../hooks/useApi';
import type { AgentInfo } from '../App';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from '@/components/ui/tooltip';
import { Bot, Wifi, Search } from 'lucide-react';

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

const statusVariant: Record<string, 'default' | 'destructive' | 'secondary'> = {
  protected: 'default',
  unprotected: 'destructive',
  partial: 'secondary',
};

const detectionIcon = (via: string) => {
  if (/port/i.test(via)) return <Wifi className="h-3.5 w-3.5" />;
  if (/process/i.test(via)) return <Search className="h-3.5 w-3.5" />;
  return <Bot className="h-3.5 w-3.5" />;
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
      <Card className="border-slate-700 bg-slate-800/50 text-center">
        <CardContent className="py-8">
          <p className="text-slate-400">No agents discovered yet.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <TooltipProvider>
      <div className="space-y-4">
        <h3 className="flex items-center gap-2 text-lg font-semibold text-slate-200">
          <Bot className="h-5 w-5" />
          Discovered Agents ({agents.length})
        </h3>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {agents.map((agent) => {
            const variant = statusVariant[agent.status] ?? 'destructive';
            return (
              <Card
                key={agent.id}
                className="border-slate-700 bg-slate-800/50"
              >
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="text-base text-slate-100">
                        {agent.name}
                      </CardTitle>
                      {agent.pid != null && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <p className="mt-0.5 cursor-default font-mono text-xs text-slate-500">
                              PID {agent.pid}
                            </p>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>Process ID: {agent.pid}</p>
                            {agent.provider && <p>Provider: {agent.provider}</p>}
                            {agent.port != null && <p>Listening on port {agent.port}</p>}
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                    <Badge variant={variant}>{agent.status}</Badge>
                  </div>
                </CardHeader>

                <CardContent>
                  <dl className="space-y-1 text-sm">
                    <div className="flex items-center justify-between">
                      <dt className="flex items-center gap-1.5 text-slate-500">
                        {detectionIcon(agent.detectedVia)}
                        Detected via
                      </dt>
                      <dd className="text-slate-300">{agent.detectedVia}</dd>
                    </div>
                    {agent.provider && (
                      <div className="flex justify-between">
                        <dt className="text-slate-500">Provider</dt>
                        <dd className="text-slate-300">{agent.provider}</dd>
                      </div>
                    )}
                    {agent.port != null && (
                      <div className="flex items-center justify-between">
                        <dt className="flex items-center gap-1.5 text-slate-500">
                          <Wifi className="h-3.5 w-3.5" />
                          Port
                        </dt>
                        <dd className="font-mono text-slate-300">{agent.port}</dd>
                      </div>
                    )}
                  </dl>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </TooltipProvider>
  );
};

export default AgentList;
