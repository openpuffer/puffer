import React, { useEffect } from 'react';
import { useApi } from '../hooks/useApi';
import type { AgentInfo } from '../App';
import { Card } from '@/components/ui/card';
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
        <div className="text-muted-foreground">Loading agents...</div>
      </div>
    );
  }

  if (error && wsAgents.length === 0) {
    return (
      <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-6">
        <p className="text-destructive">Failed to load agents: {error}</p>
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
      <Card className="p-8 text-center">
        <p className="text-muted-foreground">No agents discovered yet.</p>
      </Card>
    );
  }

  return (
    <TooltipProvider>
      <div className="space-y-4">
        <h3 className="flex items-center gap-2 text-lg font-semibold text-foreground">
          <Bot className="h-5 w-5" />
          Discovered Agents ({agents.length})
        </h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {agents.map((agent) => {
            const variant = statusVariant[agent.status] ?? 'destructive';
            return (
              <Card
                key={agent.id}
                className="p-4"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Bot className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="truncate text-sm font-semibold text-foreground">
                        {agent.name}
                      </span>
                    </div>
                    {agent.pid != null && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <p className="mt-1 cursor-default font-mono text-xs text-muted-foreground">
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
                  <Badge variant={variant} className="shrink-0 text-xs">{agent.status}</Badge>
                </div>

                <dl className="mt-3 space-y-1 text-xs">
                  <div className="flex items-center justify-between">
                    <dt className="flex items-center gap-1.5 text-muted-foreground">
                      {detectionIcon(agent.detectedVia)}
                      Detected via
                    </dt>
                    <dd className="text-foreground/70">{agent.detectedVia}</dd>
                  </div>
                  {agent.provider && (
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Provider</dt>
                      <dd className="text-foreground/70">{agent.provider}</dd>
                    </div>
                  )}
                  {agent.port != null && (
                    <div className="flex items-center justify-between">
                      <dt className="flex items-center gap-1.5 text-muted-foreground">
                        <Wifi className="h-3.5 w-3.5" />
                        Port
                      </dt>
                      <dd className="font-mono text-foreground/70">{agent.port}</dd>
                    </div>
                  )}
                </dl>
              </Card>
            );
          })}
        </div>
      </div>
    </TooltipProvider>
  );
};

export default AgentList;
