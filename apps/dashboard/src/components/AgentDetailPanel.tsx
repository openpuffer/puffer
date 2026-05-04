import React, { useMemo, useState } from 'react';
import { ArrowUp, ArrowDown } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { LiveEvent, AgentInfo } from '../App';
import type { SkillManifest } from '@puffer/core';
import { agentSourceFilter } from '../lib/skillHelpers';

export interface SelectedEntity {
  id: string;
  name: string;
  type: string;
  color: string;
}

interface AgentDetailPanelProps {
  node: SelectedEntity | null;
  agents: AgentInfo[];
  liveEvents: LiveEvent[];
  skillInventory?: SkillManifest[];
}

const AgentDetailPanel: React.FC<AgentDetailPanelProps> = ({ node, agents, liveEvents, skillInventory = [] }) => {
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

  // Collect debug info from unknown agent events
  const debugSnapshots = useMemo(() => {
    if (!node || node.name !== 'unknown') return [];
    const seen = new Set<string>();
    const snapshots: NonNullable<LiveEvent['metadata']>['debugInfo'][] = [];
    for (const e of agentEvents) {
      const dbg = e.metadata?.debugInfo;
      if (!dbg) continue;
      // Deduplicate by user-agent + endpoint
      const key = `${dbg.userAgent}|${dbg.endpoint}`;
      if (seen.has(key)) continue;
      seen.add(key);
      snapshots.push(dbg);
    }
    return snapshots;
  }, [node, agentEvents]);

  const [debugExpanded, setDebugExpanded] = useState(false);

  // Pair llm_request + llm_response events by sessionId + time adjacency.
  // Walk events newest-first; for each request find the next response in the
  // same session. Cap at 5 pairs.
  const recentPairs = useMemo(() => {
    const llmEvents = agentEvents
      .filter(
        (e) => e.action.type === 'llm_request' || e.action.type === 'llm_response',
      )
      .slice() // shallow copy so sort doesn't mutate
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    const pairs: Array<{
      request?: LiveEvent;
      response?: LiveEvent;
    }> = [];
    const usedIds = new Set<string>();

    for (const ev of llmEvents) {
      if (usedIds.has(ev.id)) continue;
      if (ev.action.type !== 'llm_request') continue;

      usedIds.add(ev.id);
      const sessionId = ev.metadata?.sessionId;

      // Find the nearest response in the same session (could be before or after in time)
      const response = llmEvents.find(
        (r) =>
          !usedIds.has(r.id) &&
          r.action.type === 'llm_response' &&
          r.metadata?.sessionId === sessionId,
      );

      if (response) usedIds.add(response.id);
      pairs.push({ request: ev, response });

      if (pairs.length >= 5) break;
    }

    // Also capture unpaired responses (stream-cutoff case)
    for (const ev of llmEvents) {
      if (usedIds.has(ev.id)) continue;
      if (ev.action.type !== 'llm_response') continue;
      usedIds.add(ev.id);
      pairs.push({ response: ev });
      if (pairs.length >= 5) break;
    }

    return pairs.slice(0, 5);
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

      {/* Debug Info for Unknown Agents */}
      {debugSnapshots.length > 0 && (
        <div className="space-y-2 rounded-lg border border-red-500/30 bg-red-500/[0.05] p-3">
          <button
            onClick={() => setDebugExpanded(!debugExpanded)}
            className="w-full flex items-center justify-between"
          >
            <h4 className="font-mono text-xs font-bold text-red-600 dark:text-red-400 tracking-wider">
              DEBUG INFO ({debugSnapshots.length} unique fingerprint{debugSnapshots.length !== 1 ? 's' : ''})
            </h4>
            <span className="font-mono text-xs text-red-400">
              {debugExpanded ? '\u25B2' : '\u25BC'}
            </span>
          </button>
          {debugExpanded && (
            <div className="space-y-3 mt-2">
              {debugSnapshots.map((dbg, i) => (
                <div key={i} className="space-y-1 rounded border border-border bg-muted/30 p-2.5">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-red-400 flex-shrink-0" />
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {dbg?.method} {dbg?.endpoint}
                    </span>
                  </div>
                  {dbg?.userAgent && (
                    <div className="text-xs">
                      <span className="text-muted-foreground">User-Agent: </span>
                      <span className="font-mono text-amber-700 dark:text-amber-300 break-all">
                        {dbg.userAgent}
                      </span>
                    </div>
                  )}
                  {dbg?.headers && Object.entries(dbg.headers)
                    .filter(([key]) => key !== 'user-agent')
                    .map(([key, val]) => (
                      <div key={key} className="text-xs">
                        <span className="text-muted-foreground">{key}: </span>
                        <span className="font-mono text-foreground/70 break-all">{val}</span>
                      </div>
                    ))
                  }
                </div>
              ))}
            </div>
          )}
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

      {/* Recent Activity */}
      <div className="space-y-2">
        <h4 className="font-mono text-xs font-bold text-violet-600 dark:text-violet-400 tracking-wider">
          RECENT ACTIVITY
        </h4>
        {recentPairs.length === 0 ? (
          <p className="text-xs text-muted-foreground">No recent activity yet.</p>
        ) : (
          recentPairs.map((pair, i) => (
            <ActivityPairCard key={i} pair={pair} />
          ))
        )}
      </div>

      {/* Installed Skills */}
      <InstalledSkillsSection
        node={node}
        liveEvents={agentEvents}
        skillInventory={skillInventory}
      />
    </div>
  );
};

interface ActivityPair {
  request?: LiveEvent;
  response?: LiveEvent;
}

const ActivityPairCard: React.FC<{ pair: ActivityPair }> = ({ pair }) => {
  const { request, response } = pair;
  const anchor = request ?? response;
  if (!anchor) return null;

  const ts = anchor.timestamp;
  const model = anchor.metadata?.model;
  const decision = anchor.decision;

  const reqSnippet = request?.metadata?.snippet;
  const resSnippet = response?.metadata?.snippet;

  const inputTokens =
    (request?.metadata?.inputTokens ?? 0) + (response?.metadata?.inputTokens ?? 0);
  const outputTokens =
    (request?.metadata?.outputTokens ?? 0) + (response?.metadata?.outputTokens ?? 0);

  return (
    <div className="rounded-lg border border-violet-500/20 bg-violet-500/[0.04] p-3 space-y-2 text-xs">
      {/* Top row: timestamp · model · decision */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground/70 text-[10px]">{formatRelativeTime(ts)}</span>
        <div className="flex items-center gap-1.5">
          {model && (
            <span className="font-mono text-[10px] text-violet-700 dark:text-violet-300 truncate max-w-[120px]">
              {model}
            </span>
          )}
          <DecisionBadge decision={decision} />
        </div>
      </div>

      {/* Request snippet */}
      {request && (
        <div className="flex items-start gap-1.5">
          <ArrowUp className="h-3 w-3 text-sky-500 mt-0.5 flex-shrink-0" />
          <span className="text-foreground/70 leading-relaxed break-words min-w-0">
            {reqSnippet?.text
              ? <>
                  {reqSnippet.text}
                  {reqSnippet.originalLength > 150 && (
                    <span className="text-muted-foreground/50"> ({reqSnippet.originalLength} chars)</span>
                  )}
                </>
              : <span className="text-muted-foreground/40 italic">no snippet</span>
            }
          </span>
        </div>
      )}

      {/* Response snippet */}
      {response && (
        <div className="flex items-start gap-1.5">
          <ArrowDown className="h-3 w-3 text-emerald-500 mt-0.5 flex-shrink-0" />
          <span className="text-foreground/70 leading-relaxed break-words min-w-0">
            {resSnippet?.text
              ? <>
                  {resSnippet.text}
                  {resSnippet.originalLength > 150 && (
                    <span className="text-muted-foreground/50"> ({resSnippet.originalLength} chars)</span>
                  )}
                </>
              : <span className="text-muted-foreground/40 italic">no snippet</span>
            }
          </span>
        </div>
      )}

      {/* Token counts */}
      {(inputTokens > 0 || outputTokens > 0) && (
        <div className="flex gap-3 pt-1 border-t border-border/50">
          {inputTokens > 0 && (
            <span className="text-[10px] text-muted-foreground">
              in: <span className="font-mono">{inputTokens.toLocaleString()}</span>
            </span>
          )}
          {outputTokens > 0 && (
            <span className="text-[10px] text-muted-foreground">
              out: <span className="font-mono">{outputTokens.toLocaleString()}</span>
            </span>
          )}
        </div>
      )}
    </div>
  );
};

const DECISION_BADGE_STYLES: Record<string, string> = {
  ALLOW: 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400',
  BLOCK: 'bg-red-500/20 text-red-600 dark:text-red-400',
  AUDIT: 'bg-amber-500/20 text-amber-600 dark:text-amber-400',
  ESCALATE: 'bg-purple-500/20 text-purple-600 dark:text-purple-400',
};

const DecisionBadge: React.FC<{ decision: string | null }> = ({ decision }) => {
  if (!decision) return null;
  const style = DECISION_BADGE_STYLES[decision] ?? 'bg-muted text-muted-foreground';
  return (
    <span className={`inline-block rounded px-1 py-px font-mono text-[9px] uppercase tracking-wider ${style}`}>
      {decision}
    </span>
  );
};

function formatRelativeTime(ts: string): string {
  try {
    const diff = Date.now() - new Date(ts).getTime();
    if (diff < 60_000) return 'just now';
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    return `${Math.floor(diff / 86_400_000)}d ago`;
  } catch {
    return ts;
  }
}

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

interface InstalledSkillsSectionProps {
  node: SelectedEntity | null;
  liveEvents: LiveEvent[];
  skillInventory: SkillManifest[];
}

const InstalledSkillsSection: React.FC<InstalledSkillsSectionProps> = ({
  node,
  liveEvents,
  skillInventory,
}) => {
  const relevantSources = useMemo(() => {
    if (!node) return [] as ReturnType<typeof agentSourceFilter>;
    return agentSourceFilter(node.name);
  }, [node]);

  const installedSkills = useMemo(() => {
    if (relevantSources.length === 0) return [];
    return skillInventory.filter((s) => relevantSources.includes(s.source));
  }, [skillInventory, relevantSources]);

  // Count skill_invoke events per skill.id for this agent.
  const invocationCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const ev of liveEvents) {
      if (ev.action.type !== 'skill_invoke') continue;
      const skillId = (ev.action as unknown as { skill?: { id?: string } }).skill?.id;
      if (!skillId) continue;
      counts.set(skillId, (counts.get(skillId) ?? 0) + 1);
    }
    return counts;
  }, [liveEvents]);

  const totalUsed = useMemo(() => {
    let count = 0;
    for (const skill of installedSkills) {
      if (invocationCounts.has(skill.id)) count++;
    }
    return count;
  }, [installedSkills, invocationCounts]);

  const top5 = useMemo(() => {
    return installedSkills
      .map((s) => ({ skill: s, count: invocationCounts.get(s.id) ?? 0 }))
      .filter((e) => e.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [installedSkills, invocationCounts]);

  if (!node) return null;

  if (relevantSources.length === 0) {
    return (
      <div className="space-y-1">
        <h4 className="font-mono text-xs font-bold text-emerald-600 dark:text-emerald-400 tracking-wider">
          INSTALLED SKILLS
        </h4>
        <p className="text-xs text-muted-foreground italic">
          Skills tracking not available for this agent type.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-lg border border-emerald-500/20 bg-emerald-500/[0.04] p-3">
      <div className="flex items-center justify-between">
        <h4 className="font-mono text-xs font-bold text-emerald-600 dark:text-emerald-400 tracking-wider">
          INSTALLED SKILLS
        </h4>
        <Link
          to="/skills"
          className="font-mono text-[10px] text-emerald-500 hover:text-emerald-300 transition-colors"
        >
          View all /skills →
        </Link>
      </div>

      <p className="font-mono text-xs text-muted-foreground">
        <span className="text-foreground/80 font-semibold">{installedSkills.length}</span>
        {' '}skill{installedSkills.length !== 1 ? 's' : ''} installed
        {' · '}
        <span className="text-emerald-400">{totalUsed}</span> used in this session
      </p>

      {top5.length > 0 && (
        <div className="space-y-1.5 mt-1">
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Top used this session
          </span>
          {top5.map(({ skill, count }) => (
            <div key={skill.id} className="flex items-center justify-between text-xs">
              <span className="font-mono text-emerald-300 truncate max-w-[180px]">
                {skill.name}
              </span>
              <span className="text-muted-foreground text-[10px] ml-2 shrink-0">
                {count}×
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default AgentDetailPanel;
