import React, { useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import CountUp from 'react-countup';
import {
  ShieldCheck,
  ShieldOff,
  Activity,
  Users,
  Gauge,
  DollarSign,
  Zap,
  Wifi,
  WifiOff,
  AlertTriangle,
  List,
  Bot,
  Settings,
  ChevronRight,
  Sun,
  Moon,
} from 'lucide-react';
import type { LiveEvent, AgentInfo } from '../App';
import { useTheme } from '../hooks/useTheme';

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
  onOpenPanel: (panel: string) => void;
  panelOpen?: boolean;
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
  onOpenPanel,
  panelOpen,
}) => {
  const feedRef = useRef<HTMLDivElement>(null);
  const { theme, toggleTheme } = useTheme();

  useEffect(() => {
    if (feedRef.current) feedRef.current.scrollTop = 0;
  }, [liveEvents]);

  const recentEvents = liveEvents.slice(0, 12);
  const blockedCount = liveEvents.filter((e) => e.decision === 'BLOCK').length;

  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      {/* ── Top-left: Stats ── */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.2 }}
        className="pointer-events-auto absolute left-5 top-5 hud-panel w-64"
      >
        <div className="flex items-center gap-2 mb-3 border-b border-black/[0.06] dark:border-white/[0.04] pb-2">
          <ShieldCheck className="h-4 w-4 text-slate-600 dark:text-amber-400/80" />
          <span className="text-[11px] font-medium text-slate-700 dark:text-amber-400/90 tracking-[0.2em] uppercase">
            Puffer
          </span>
          <span className="ml-auto text-[9px] text-slate-400 dark:text-white/30 uppercase tracking-[0.15em]">
            {stats.mode}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-1">
          <StatItem icon={Activity} label="Events" value={stats.totalEvents} />
          <StatItem icon={ShieldOff} label="Blocked" value={stats.blocked || stats.blockedEvents} accent />
          <StatItem icon={ShieldCheck} label="Allowed" value={stats.allowed || stats.allowedEvents} />
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

        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          className="hud-panel flex items-center gap-2 px-3 py-1.5 transition-all hover:bg-black/[0.04] dark:hover:bg-white/[0.06] group"
        >
          {theme === 'dark' ? (
            <Sun className="h-3 w-3 text-slate-500 dark:text-white/30 group-hover:text-slate-700 dark:group-hover:text-white/60 transition-colors" />
          ) : (
            <Moon className="h-3 w-3 text-slate-500 dark:text-white/30 group-hover:text-slate-700 dark:group-hover:text-white/60 transition-colors" />
          )}
          <span className="text-[10px] text-slate-500 dark:text-white/30 group-hover:text-slate-700 dark:group-hover:text-white/60 tracking-wider transition-colors">
            {theme === 'dark' ? 'LIGHT' : 'DARK'}
          </span>
        </button>

        {[
          { id: 'events', icon: List, label: 'Events' },
          { id: 'agents', icon: Bot, label: 'Agents' },
          { id: 'config', icon: Settings, label: 'Config' },
        ].map((item) => (
          <button
            key={item.id}
            onClick={() => onOpenPanel(item.id)}
            className="hud-panel flex items-center gap-2 px-3 py-1.5 transition-all hover:bg-black/[0.04] dark:hover:bg-white/[0.06] group"
          >
            <item.icon className="h-3 w-3 text-slate-500 dark:text-white/30 group-hover:text-slate-700 dark:group-hover:text-white/60 transition-colors" />
            <span className="text-[10px] text-slate-500 dark:text-white/30 group-hover:text-slate-700 dark:group-hover:text-white/60 tracking-wider transition-colors">
              {item.label.toUpperCase()}
            </span>
            <ChevronRight className="h-2.5 w-2.5 text-slate-300 dark:text-white/15 group-hover:text-slate-500 dark:group-hover:text-white/40 transition-colors" />
          </button>
        ))}
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
              return (
                <motion.div
                  key={event.id}
                  initial={{ opacity: 0, x: -12, height: 0 }}
                  animate={{ opacity: 1, x: 0, height: 'auto' }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.25 }}
                  className="flex items-center gap-2 py-1 text-[10px] border-b border-black/[0.03] dark:border-white/[0.02]"
                >
                  <span className="text-slate-400 dark:text-white/20 w-14 shrink-0 tabular-nums">{time}</span>
                  <span className={`px-1.5 py-0.5 rounded text-[8px] font-medium ${badge.bg} ${badge.text}`}>
                    {event.decision}
                  </span>
                  <span className="text-slate-500 dark:text-white/40 truncate">
                    {event.source?.agent ?? 'unknown'}
                  </span>
                  <span className="text-slate-300 dark:text-white/10">/</span>
                  <span className="text-slate-400 dark:text-white/25 truncate">
                    {event.action?.type ?? ''}
                  </span>
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

        {liveEvents.find((e) => e.decision === 'BLOCK') && (
          <div className="mt-2 pt-2 border-t border-black/[0.06] dark:border-white/[0.04]">
            <span className="text-[8px] text-slate-300 dark:text-white/20 block mb-0.5 uppercase tracking-wider">Latest</span>
            <div className="text-[10px] text-red-400/60 truncate">
              {liveEvents.find((e) => e.decision === 'BLOCK')!.source?.agent}
              {' — '}
              {liveEvents.find((e) => e.decision === 'BLOCK')!.action?.type}
            </div>
          </div>
        )}
      </motion.div>
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
}

const StatItem: React.FC<StatItemProps> = ({ icon: Icon, label, value, prefix, decimals, accent }) => (
  <div className="flex items-center gap-2 py-0.5">
    <Icon className={`h-3 w-3 ${accent ? 'text-red-400/40' : 'text-slate-400 dark:text-white/20'}`} />
    <div className="flex flex-col">
      <span className="text-[8px] text-slate-400 dark:text-white/25 uppercase tracking-wider">{label}</span>
      <span className={`text-sm font-light tabular-nums ${accent ? 'text-red-400/70' : 'text-slate-700 dark:text-white/70'}`}>
        {prefix}
        <CountUp end={value} duration={1.5} decimals={decimals ?? 0} preserveValue />
      </span>
    </div>
  </div>
);

export default HUDOverlay;
