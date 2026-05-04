import React, { useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import CountUp from 'react-countup';
import { AreaChart, Area, ResponsiveContainer } from 'recharts';
import {
  ShieldCheck,
  ShieldOff,
  ShieldAlert,
  Activity,
  Users,
  Gauge,
  DollarSign,
  Zap,
  Wifi,
  WifiOff,
  AlertTriangle,
} from 'lucide-react';
import type { LiveEvent, AgentInfo } from '../App';

interface HUDOverlayProps {
  stats: {
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
  };
  liveEvents: LiveEvent[];
  agents: AgentInfo[];
  connected: boolean;
  panelOpen?: boolean;
  sparkEvents?: { v: number }[];
  sparkBlocked?: { v: number }[];
  sparkAllowed?: { v: number }[];
}

const DECISION_BADGE: Record<string, { bg: string; text: string }> = {
  ALLOW: { bg: 'bg-white/5', text: 'text-gray-300' },
  BLOCK: { bg: 'bg-red-500/10', text: 'text-red-400' },
  AUDIT: { bg: 'bg-amber-500/10', text: 'text-amber-400' },
  ESCALATE: { bg: 'bg-purple-500/10', text: 'text-purple-400' },
};

const HUDOverlay: React.FC<HUDOverlayProps> = ({
  stats,
  liveEvents,
  connected,
  panelOpen,
  sparkEvents,
  sparkBlocked,
  sparkAllowed,
}) => {
  const feedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (feedRef.current) feedRef.current.scrollTop = 0;
  }, [liveEvents]);

  const recentEvents = liveEvents.slice(0, 12);
  const blockedCount = liveEvents.filter((e) => e.decision === 'BLOCK').length;

  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      {/* ── Top-left: Puffer Score + Stats ── */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.2 }}
        className="pointer-events-auto absolute left-5 top-5 hud-panel w-64"
      >
        {/* Puffer Score Gauge */}
        <PufferScoreGauge stats={stats} />

        <div className="flex items-center gap-2 mb-3 border-b border-black/[0.06] dark:border-white/[0.04] pb-2 mt-3">
          <ShieldCheck className="h-4 w-4 text-slate-600 dark:text-amber-400/80" />
          <span className="text-[11px] font-medium text-slate-700 dark:text-amber-400/90 tracking-[0.2em] uppercase">
            Puffer
          </span>
          <span className="ml-auto text-[9px] text-slate-400 dark:text-white/30 uppercase tracking-[0.15em]">
            {stats.mode}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-1">
          <StatItem icon={Activity} label="Events" value={stats.totalEvents} sparkData={sparkEvents} sparkColor="#fbbf24" />
          <StatItem icon={ShieldOff} label="Blocked" value={stats.blocked || stats.blockedEvents} accent sparkData={sparkBlocked} sparkColor="#ef4444" />
          <StatItem icon={ShieldCheck} label="Allowed" value={stats.allowed || stats.allowedEvents} sparkData={sparkAllowed} sparkColor="#22c55e" />
          <StatItem icon={Users} label="Agents" value={stats.activeAgents} />
          <StatItem icon={Gauge} label="Evt/min" value={stats.eventsPerMinute} />
          <StatItem icon={Zap} label="Tokens" value={stats.totalTokens} />
          <StatItem icon={DollarSign} label="Cost" value={stats.totalCost} prefix="$" decimals={2} />
        </div>
      </motion.div>

      {/* ── Top-right: Connection + Nav ── */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.3 }}
        className="pointer-events-auto absolute right-5 top-5 z-40 flex flex-col items-end gap-1.5"
      >
        <div className="hud-panel flex items-center gap-2 px-3 py-1.5">
          {connected ? (
            <Wifi className="h-3.5 w-3.5 text-slate-500 dark:text-white/60" />
          ) : (
            <WifiOff className="h-3.5 w-3.5 text-red-400/60" />
          )}
          <span className={`text-[10px] tracking-wider ${connected ? 'text-slate-500 dark:text-white/60' : 'text-red-400/60'}`}>
            {connected ? 'LIVE' : 'OFFLINE'}
          </span>
          {connected && (
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-slate-400 dark:bg-amber-400 opacity-40" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-slate-400/70 dark:bg-amber-400/70" />
            </span>
          )}
        </div>
      </motion.div>

      {/* ── Bottom-left: Live feed ── */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.4 }}
        className="pointer-events-auto absolute bottom-5 left-5 hud-panel w-[380px]"
      >
        <div className="flex items-center gap-2 mb-2 border-b border-black/[0.06] dark:border-white/[0.04] pb-2">
          <Activity className="h-3.5 w-3.5 text-slate-400 dark:text-white/50" />
          <span className="text-[10px] text-slate-400 dark:text-white/50 tracking-[0.15em] uppercase">
            Live Feed
          </span>
          <span className="ml-auto text-[9px] text-slate-300 dark:text-white/20">
            {liveEvents.length}
          </span>
        </div>

        <div ref={feedRef} className="max-h-44 overflow-y-auto scrollbar-thin space-y-0.5">
          <AnimatePresence initial={false}>
            {recentEvents.map((event) => {
              const badge = DECISION_BADGE[event.decision] ?? DECISION_BADGE.ALLOW;
              const time = new Date(event.timestamp).toLocaleTimeString();
              const isBlock = event.decision === 'BLOCK';
              const blockLayer = isBlock
                ? event.layers?.find((l) => l.verdict === 'block')
                : null;
              return (
                <motion.div
                  key={event.id}
                  initial={{ opacity: 0, x: -12, height: 0, scale: isBlock ? 1.05 : 1 }}
                  animate={{ opacity: 1, x: 0, height: 'auto', scale: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: isBlock ? 0.35 : 0.25 }}
                  className={`flex items-center gap-2 py-1 text-[10px] ${
                    isBlock
                      ? 'bg-red-500/15 border-l-2 border-red-500 pl-2 rounded-r border-b border-black/[0.03] dark:border-white/[0.02]'
                      : 'border-b border-black/[0.03] dark:border-white/[0.02]'
                  }`}
                >
                  <span className="text-slate-400 dark:text-white/20 w-14 shrink-0 tabular-nums">{time}</span>
                  {isBlock && <ShieldAlert className="w-3.5 h-3.5 text-red-400 shrink-0" />}
                  <span className={`px-1.5 py-0.5 rounded text-[8px] font-medium ${badge.bg} ${badge.text}`}>
                    {event.decision}
                  </span>
                  {blockLayer && (
                    <span className="px-1 py-0.5 rounded text-[7px] font-mono bg-red-500/20 text-red-300 shrink-0">
                      L{blockLayer.layer}: {blockLayer.name}
                    </span>
                  )}
                  <span className="text-slate-500 dark:text-white/40 truncate">
                    {event.source?.agent ?? 'unknown'}
                  </span>
                  {!isBlock && (
                    <>
                      <span className="text-slate-300 dark:text-white/10">/</span>
                      <span className="text-slate-400 dark:text-white/25 truncate">
                        {event.action?.type ?? ''}
                      </span>
                    </>
                  )}
                </motion.div>
              );
            })}
          </AnimatePresence>

          {recentEvents.length === 0 && (
            <div className="text-center py-4 text-slate-300 dark:text-white/15 text-[10px]">
              Awaiting telemetry...
            </div>
          )}
        </div>
      </motion.div>

      {/* ── Bottom-right: Threats (hidden when drawer is open) ── */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: panelOpen ? 0 : 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className={`pointer-events-auto absolute bottom-5 right-5 hud-panel w-48 ${panelOpen ? 'pointer-events-none' : ''}`}
      >
        <div className="flex items-center gap-2 mb-2 border-b border-black/[0.06] dark:border-white/[0.04] pb-2">
          <AlertTriangle className="h-3.5 w-3.5 text-red-400/50" />
          <span className="text-[10px] text-red-400/50 tracking-[0.15em] uppercase">
            Threats
          </span>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-[10px] text-slate-400 dark:text-white/30">Blocked</span>
          <span className="text-xl font-light text-slate-700 dark:text-white/80 tabular-nums">
            <CountUp end={blockedCount} duration={1} preserveValue />
          </span>
        </div>

        <AnimatePresence>
          {(() => {
            const recentBlockedEvents = liveEvents.filter((e) => e.decision === 'BLOCK').slice(0, 3);
            if (recentBlockedEvents.length === 0) return null;
            return (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.3 }}
                className="mt-2 pt-2 border-t border-black/[0.06] dark:border-white/[0.04] space-y-1.5"
              >
                <span className="text-[8px] text-slate-300 dark:text-white/20 block mb-0.5 uppercase tracking-wider">Recent threats</span>
                {recentBlockedEvents.map((ev) => {
                  const layer = ev.layers?.find((l) => l.verdict === 'block');
                  return (
                    <div key={ev.id} className="flex items-start gap-1.5">
                      <ShieldAlert className="w-3 h-3 text-red-400/70 mt-0.5 shrink-0" />
                      <div className="min-w-0">
                        <div className="text-[10px] text-red-400/70 truncate">
                          {ev.source?.agent ?? 'unknown'}
                        </div>
                        {layer && (
                          <div className="text-[8px] text-red-300/50 font-mono truncate">
                            L{layer.layer}: {layer.name}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </motion.div>
            );
          })()}
        </AnimatePresence>
      </motion.div>
    </div>
  );
};

// ── Puffer Score Gauge ──────────────────────────────────────
const PufferScoreGauge: React.FC<{ stats: HUDOverlayProps['stats'] }> = ({ stats }) => {
  const total = stats.totalEvents || 1;
  const blockRatio = (stats.blocked || stats.blockedEvents) / total;
  const hasAgents = stats.activeAgents > 0;
  const modeBonus = stats.mode === 'paranoid' ? 20 : stats.mode === 'enforce' ? 15 : 5;

  // Score: higher = more protected. Low block ratio = good (nothing to block).
  // But if zero events, start at 70 (baseline).
  const raw = stats.totalEvents === 0
    ? 70
    : Math.round(
        (1 - blockRatio) * 50
        + (hasAgents ? 20 : 0)
        + modeBonus
        + Math.min(stats.eventsPerMinute, 10)
      );
  const score = Math.max(0, Math.min(100, raw));

  const radius = 36;
  const stroke = 5;
  const circumference = 2 * Math.PI * radius;
  const arc = circumference * 0.75; // 270-degree arc
  const filled = (score / 100) * arc;
  const color = score >= 71 ? '#22c55e' : score >= 41 ? '#eab308' : '#ef4444';

  return (
    <div className="flex items-center gap-3 pb-2 border-b border-black/[0.06] dark:border-white/[0.04]">
      <div className="relative" style={{ width: 80, height: 80 }}>
        <svg width={80} height={80} viewBox="0 0 80 80">
          {/* Background arc */}
          <circle
            cx={40} cy={40} r={radius}
            fill="none"
            stroke="currentColor"
            className="text-slate-200 dark:text-white/[0.06]"
            strokeWidth={stroke}
            strokeDasharray={`${arc} ${circumference}`}
            strokeDashoffset={0}
            strokeLinecap="round"
            transform="rotate(135 40 40)"
          />
          {/* Filled arc */}
          <circle
            cx={40} cy={40} r={radius}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeDasharray={`${filled} ${circumference}`}
            strokeDashoffset={0}
            strokeLinecap="round"
            transform="rotate(135 40 40)"
            style={{ transition: 'stroke-dasharray 1s ease, stroke 0.5s ease' }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold tabular-nums" style={{ color }}>
            {score}
          </span>
        </div>
      </div>
      <div className="flex flex-col">
        <span className="text-[10px] font-medium text-slate-600 dark:text-white/50 tracking-[0.15em] uppercase">
          Puffer Score
        </span>
        <span className="text-[8px] text-slate-400 dark:text-white/25 mt-0.5">
          {score >= 71 ? 'Well protected' : score >= 41 ? 'Moderate risk' : 'High risk'}
        </span>
      </div>
    </div>
  );
};

interface StatItemProps {
  icon: React.FC<{ className?: string }>;
  label: string;
  value: number;
  prefix?: string;
  decimals?: number;
  accent?: boolean;
  sparkData?: { v: number }[];
  sparkColor?: string;
}

const StatItem: React.FC<StatItemProps> = ({ icon: Icon, label, value, prefix, decimals, accent, sparkData, sparkColor }) => (
  <div className="flex items-center gap-2 py-0.5">
    <Icon className={`h-3 w-3 ${accent ? 'text-red-400/40' : 'text-slate-400 dark:text-white/20'}`} />
    <div className="flex flex-col flex-1 min-w-0">
      <span className="text-[8px] text-slate-400 dark:text-white/25 uppercase tracking-wider">{label}</span>
      <div className="flex items-center gap-1.5">
        <span className={`text-sm font-light tabular-nums ${accent ? 'text-red-400/70' : 'text-slate-700 dark:text-white/70'}`}>
          {prefix}
          <CountUp end={value} duration={1.5} decimals={decimals ?? 0} preserveValue />
        </span>
        {sparkData && (
          <div className="w-[50px] h-[16px] opacity-60">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={sparkData} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                <Area
                  type="monotone"
                  dataKey="v"
                  stroke={sparkColor ?? '#fbbf24'}
                  fill={sparkColor ?? '#fbbf24'}
                  fillOpacity={0.15}
                  strokeWidth={1}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  </div>
);

export default HUDOverlay;
