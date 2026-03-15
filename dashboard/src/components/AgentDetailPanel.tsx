import React, { useMemo } from 'react';
import type { LiveEvent, AgentInfo } from '../App';
import type { GraphNode } from '../hooks/useGraphData';

interface AgentDetailPanelProps {
  node: GraphNode | null;
  agents: AgentInfo[];
  liveEvents: LiveEvent[];
}

const AgentDetailPanel: React.FC<AgentDetailPanelProps> = ({ node, agents, liveEvents }) => {
  const agentInfo = useMemo(() => {
    if (!node) return undefined;
    return agents.find(
      (a) => node.name.includes(a.name) || a.name.includes(node.name),
    );
  }, [node, agents]);

  const agentEvents = useMemo(() => {
    if (!node) return [];
    return liveEvents
      .filter(
        (e) =>
          e.source.agent === node.name ||
          e.source.provider === node.name ||
          `agent-${e.source.agent}` === node.id ||
          `provider-${e.source.provider}` === node.id,
      )
      .slice(0, 20);
  }, [node, liveEvents]);

  const stats = useMemo(() => {
    const total = agentEvents.length;
    const allowed = agentEvents.filter((e) => e.decision === 'ALLOW').length;
    const blocked = agentEvents.filter((e) => e.decision === 'BLOCK').length;
    const audit = agentEvents.filter((e) => e.decision === 'AUDIT').length;
    const escalated = agentEvents.filter((e) => e.decision === 'ESCALATE').length;
    return { total, allowed, blocked, audit, escalated };
  }, [agentEvents]);

  // Token usage from events with metadata
  const tokenStats = useMemo(() => {
    let inputTokens = 0;
    let outputTokens = 0;
    let totalTokens = 0;
    let cost = 0;
    const models = new Map<string, number>();
    let rateLimits: { limitTokens?: number; limitRequests?: number; remainingTokens?: number; remainingRequests?: number } | undefined = undefined;

    for (const e of agentEvents) {
      if (e.metadata) {
        if (e.metadata.inputTokens) inputTokens += e.metadata.inputTokens;
        if (e.metadata.outputTokens) outputTokens += e.metadata.outputTokens;
        if (e.metadata.totalTokens) totalTokens += e.metadata.totalTokens;
        if (e.metadata.costEstimate) cost += e.metadata.costEstimate;
        if (e.metadata.model) {
          models.set(e.metadata.model, (models.get(e.metadata.model) ?? 0) + 1);
        }
        if (e.metadata.rateLimits) rateLimits = e.metadata.rateLimits;
      }
    }

    return { inputTokens, outputTokens, totalTokens, cost, models, rateLimits };
  }, [agentEvents]);

  const mcpConnections = useMemo(() => {
    return agentEvents
      .filter((e) => e.action.type === 'mcp_tool_call' && e.action.server !== 'claude-code-agent')
      .map((e) => ({
        server: e.action.server ?? 'unknown',
        tool: e.action.tool ?? 'unknown',
        timestamp: e.timestamp,
      }));
  }, [agentEvents]);

  const subAgents = useMemo(() => {
    return agentEvents
      .filter(
        (e) =>
          e.action.type === 'mcp_tool_call' &&
          e.action.server === 'claude-code-agent',
      )
      .map((e) => ({
        type: e.action.subagentType ?? 'general-purpose',
        description: e.action.description ?? '',
        timestamp: e.timestamp,
      }));
  }, [agentEvents]);

  if (!node) {
    return <p className="text-sm text-muted-foreground">Select a node to view details</p>;
  }

  const lastSeen =
    agentEvents.length > 0
      ? agentEvents[0].timestamp
      : agentInfo?.lastSeen ?? 'N/A';

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div
          className="h-3 w-3 rounded-full flex-shrink-0"
          style={{
            backgroundColor: node.color,
            boxShadow: `0 0 8px ${node.color}`,
          }}
        />
        <div>
          <h3 className="font-mono text-base font-bold text-foreground tracking-wide">
            {node.name.toUpperCase()}
          </h3>
          <span className="font-mono text-xs text-muted-foreground">
            {node.type.toUpperCase()}
            {agentInfo ? ` · ${agentInfo.detectedVia}` : ''}
          </span>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: 'Events', value: stats.total, color: 'text-foreground' },
          { label: 'Allowed', value: stats.allowed, colorHex: '#4ade80' },
          { label: 'Blocked', value: stats.blocked, colorHex: '#f87171' },
        ].map(({ label, value, color, colorHex }) => (
          <div
            key={label}
            className="rounded-lg border border-border bg-muted/30 p-3 text-center"
          >
            <div
              className={`font-mono text-lg font-bold ${color ?? ''}`}
              style={colorHex ? { color: colorHex } : undefined}
            >
              {value}
            </div>
            <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {label}
            </div>
          </div>
        ))}
      </div>

      {/* Token Usage */}
      {tokenStats.totalTokens > 0 && (
        <div className="space-y-1.5 rounded-lg border border-amber-500/20 bg-amber-500/[0.05] p-3">
          <h4 className="font-mono text-xs font-bold text-amber-600 dark:text-amber-400 tracking-wider mb-2">
            TOKEN USAGE
          </h4>
          <InfoRow label="Input Tokens" value={tokenStats.inputTokens.toLocaleString()} />
          <InfoRow label="Output Tokens" value={tokenStats.outputTokens.toLocaleString()} />
          <InfoRow label="Total Tokens" value={tokenStats.totalTokens.toLocaleString()} />
          <InfoRow label="Cost" value={`$${tokenStats.cost.toFixed(4)}`} />
          {tokenStats.models.size > 0 && (
            <div className="mt-2 pt-2 border-t border-border">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Models</span>
              {Array.from(tokenStats.models.entries()).map(([model, count]) => (
                <div key={model} className="flex justify-between text-xs mt-0.5">
                  <span className="font-mono text-amber-700 dark:text-amber-300 truncate max-w-[200px]">{model}</span>
                  <span className="text-muted-foreground">{count} req</span>
                </div>
              ))}
            </div>
          )}
          {tokenStats.rateLimits && (
            <div className="mt-2 pt-2 border-t border-border">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Rate Limits (inferred tier)</span>
              {tokenStats.rateLimits.limitTokens && (
                <InfoRow label="Token Limit" value={tokenStats.rateLimits.limitTokens.toLocaleString()} />
              )}
              {tokenStats.rateLimits.limitRequests && (
                <InfoRow label="Request Limit" value={tokenStats.rateLimits.limitRequests.toLocaleString()} />
              )}
              {tokenStats.rateLimits.remainingTokens !== undefined && (
                <InfoRow label="Remaining" value={tokenStats.rateLimits.remainingTokens.toLocaleString()} />
              )}
            </div>
          )}
        </div>
      )}

      {/* Agent Info */}
      {agentInfo && (
        <div className="space-y-1.5 rounded-lg border border-border bg-muted/30 p-3">
          <h4 className="font-mono text-xs font-bold text-sky-600 dark:text-cyan-400 tracking-wider mb-2">
            DETAILS
          </h4>
          <InfoRow label="PID" value={agentInfo.pid ? String(agentInfo.pid) : '\u2014'} />
          <InfoRow label="Port" value={agentInfo.port ? String(agentInfo.port) : '\u2014'} />
          <InfoRow label="Detection" value={agentInfo.detectedVia} />
          <InfoRow label="Status" value={agentInfo.status} />
          <InfoRow label="First Seen" value={formatTime(agentInfo.firstSeen)} />
          <InfoRow label="Last Seen" value={formatTime(lastSeen)} />
        </div>
      )}

      {/* Sub-agents */}
      {subAgents.length > 0 && (
        <div className="space-y-2 rounded-lg border border-orange-500/20 bg-orange-500/[0.05] p-3">
          <h4 className="font-mono text-xs font-bold text-orange-600 dark:text-orange-400 tracking-wider">
            SUB-AGENTS ({subAgents.length})
          </h4>
          {subAgents.map((sa, i) => (
            <div key={i} className="flex items-start gap-2 text-xs">
              <span className="mt-0.5 h-1.5 w-1.5 rounded-full bg-orange-400 flex-shrink-0" />
              <div>
                <span className="font-mono text-orange-700 dark:text-orange-300">{sa.type}</span>
                {sa.description && (
                  <p className="text-muted-foreground mt-0.5">{sa.description}</p>
                )}
                <span className="text-muted-foreground/60">{formatTime(sa.timestamp)}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* MCP Connections */}
      {mcpConnections.length > 0 && (
        <div className="space-y-2 rounded-lg border border-cyan-500/20 bg-cyan-500/[0.05] p-3">
          <h4 className="font-mono text-xs font-bold text-sky-600 dark:text-cyan-400 tracking-wider">
            MCP CONNECTIONS ({mcpConnections.length})
          </h4>
          {mcpConnections.map((mc, i) => (
            <div key={i} className="flex items-start gap-2 text-xs">
              <span className="mt-0.5 h-1.5 w-1.5 rounded-full bg-cyan-400 flex-shrink-0" />
              <div>
                <span className="font-mono text-sky-700 dark:text-cyan-300">{mc.server}</span>
                <span className="text-muted-foreground"> &rarr; {mc.tool}</span>
                <span className="text-muted-foreground/60 ml-2">
                  {formatTime(mc.timestamp)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Recent Events */}
      <div className="space-y-1.5">
        <h4 className="font-mono text-xs font-bold text-sky-600 dark:text-cyan-400 tracking-wider">
          RECENT EVENTS ({agentEvents.length})
        </h4>
        {agentEvents.length === 0 && (
          <p className="text-xs text-muted-foreground">No events recorded yet</p>
        )}
        {agentEvents.map((event) => (
          <div
            key={event.id}
            className="flex items-center gap-2 rounded border border-border bg-muted/20 px-2.5 py-1.5 text-xs"
          >
            <DecisionDot decision={event.decision} />
            <span className="font-mono text-foreground/70 flex-1 truncate">
              {event.action.type}
            </span>
            <span className="text-muted-foreground text-[10px]">
              {formatTime(event.timestamp)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

const InfoRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex justify-between text-xs">
    <span className="text-muted-foreground">{label}</span>
    <span className="font-mono text-foreground/80">{value}</span>
  </div>
);

const DECISION_DOT_COLORS: Record<string, string> = {
  ALLOW: '#4ade80',
  BLOCK: '#f87171',
  AUDIT: '#fbbf24',
  ESCALATE: '#c084fc',
};

const DecisionDot: React.FC<{ decision: string }> = ({ decision }) => (
  <span
    className="inline-block h-1.5 w-1.5 rounded-full flex-shrink-0"
    style={{ backgroundColor: DECISION_DOT_COLORS[decision] ?? '#6b7280' }}
  />
);

function formatTime(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return ts;
  }
}

export default AgentDetailPanel;
