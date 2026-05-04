import React, { useEffect, useRef } from 'react';
import type { EntityCard, EntityState } from '../hooks/useGridStats';
import { findDraw, drawPuffer } from '../lib/agentIcons';

interface NetworkGridCardProps {
  card: EntityCard;
  blocked?: boolean;
  isPuffer?: boolean;
  selected?: boolean;
  linked?: boolean;
  dimmed?: boolean;
  onSelect?: (card: EntityCard) => void;
  onOpenDetail?: (card: EntityCard) => void;
  registerRef?: (id: string, el: HTMLElement | null) => void;
}

const CLICK_DELAY_MS = 220;

const STATE_STYLES: Record<EntityState, { border: string; glow: string; badge: string }> = {
  ALLOW: {
    border: 'border-emerald-500/40',
    glow: 'shadow-[0_0_18px_-4px_rgba(16,185,129,0.45)]',
    badge: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
  },
  AUDIT: {
    border: 'border-amber-500/40',
    glow: 'shadow-[0_0_18px_-4px_rgba(245,158,11,0.45)]',
    badge: 'text-amber-400 bg-amber-500/10 border-amber-500/30',
  },
  ESCALATE: {
    border: 'border-violet-500/50',
    glow: 'shadow-[0_0_18px_-4px_rgba(139,92,246,0.45)]',
    badge: 'text-violet-400 bg-violet-500/10 border-violet-500/30',
  },
  BLOCK: {
    border: 'border-rose-500/70',
    glow: 'shadow-[0_0_24px_-2px_rgba(244,63,94,0.6)]',
    badge: 'text-rose-300 bg-rose-500/15 border-rose-500/40',
  },
  IDLE: {
    border: 'border-white/[0.08]',
    glow: '',
    badge: 'text-slate-400 bg-white/[0.03] border-white/[0.08]',
  },
};

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function formatCost(usd: number): string {
  if (usd >= 1) return `$${usd.toFixed(2)}`;
  if (usd >= 0.01) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(4)}`;
}

const Sparkline: React.FC<{ values: number[]; color: string }> = ({ values, color }) => {
  const max = Math.max(1, ...values);
  const w = 100;
  const h = 18;
  const step = w / Math.max(1, values.length - 1);
  const pts = values
    .map((v, i) => `${(i * step).toFixed(1)},${(h - (v / max) * h).toFixed(1)}`)
    .join(' ');
  const isFlat = values.every((v) => v === 0);
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="h-[18px] w-full"
      preserveAspectRatio="none"
      aria-hidden
    >
      <polyline
        fill="none"
        stroke={isFlat ? 'rgba(148,163,184,0.25)' : color}
        strokeWidth="1.25"
        strokeLinejoin="round"
        strokeLinecap="round"
        points={pts}
      />
    </svg>
  );
};

const IconCanvas: React.FC<{ name: string; isPuffer?: boolean; color: string; size?: number }> = ({
  name,
  isPuffer,
  color,
  size = 22,
}) => {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, size, size);
    const fn = isPuffer ? drawPuffer : findDraw(name);
    fn(ctx, size, color);
  }, [name, isPuffer, color, size]);
  return <canvas ref={ref} aria-hidden />;
};

const NetworkGridCard: React.FC<NetworkGridCardProps> = ({
  card,
  blocked = false,
  isPuffer = false,
  selected = false,
  linked = false,
  dimmed = false,
  onSelect,
  onOpenDetail,
  registerRef,
}) => {
  const effectiveState: EntityState = blocked ? 'BLOCK' : card.state;
  const styles = STATE_STYLES[effectiveState];
  const sparkColor =
    effectiveState === 'BLOCK'
      ? 'rgb(244,63,94)'
      : effectiveState === 'AUDIT'
        ? 'rgb(245,158,11)'
        : effectiveState === 'ESCALATE'
          ? 'rgb(139,92,246)'
          : effectiveState === 'IDLE'
            ? 'rgba(148,163,184,0.4)'
            : 'rgb(16,185,129)';

  const iconColor = isPuffer ? '#fbbf24' : effectiveState === 'IDLE' ? '#94a3b8' : '#fef3c7';

  // Distinguish single-click (toggle select) from double-click (open drawer).
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleClick = () => {
    if (clickTimerRef.current) return; // already waiting — second click handler will fire
    clickTimerRef.current = setTimeout(() => {
      onSelect?.(card);
      clickTimerRef.current = null;
    }, CLICK_DELAY_MS);
  };
  const handleDoubleClick = () => {
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
    onOpenDetail?.(card);
  };
  useEffect(() => {
    return () => {
      if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
    };
  }, []);

  // Card root ref bridge — forward to parent registry.
  const rootRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    registerRef?.(card.id, rootRef.current);
    return () => registerRef?.(card.id, null);
  }, [card.id, registerRef]);

  return (
    <button
      type="button"
      ref={rootRef}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      className={[
        'relative group flex flex-col gap-1.5 rounded-lg border bg-[rgba(8,11,18,0.65)] dark:bg-[rgba(8,11,18,0.65)]',
        'px-3 py-2.5 text-left transition-all duration-200',
        'hover:bg-[rgba(20,26,40,0.85)] hover:scale-[1.015]',
        styles.border,
        styles.glow,
        selected
          ? 'ring-2 ring-cyan-300/80 ring-offset-2 ring-offset-[#06080d] shadow-[0_0_28px_-2px_rgba(34,211,238,0.55)]'
          : linked
            ? 'ring-1 ring-cyan-400/40'
            : card.recentlyActive
              ? 'ring-2 ring-cyan-400/40 ring-offset-0'
              : '',
        dimmed && !selected && !linked ? 'opacity-30' : '',
        effectiveState === 'BLOCK' ? 'animate-[pulse_1.4s_ease-in-out_infinite]' : '',
        isPuffer
          ? 'col-span-2 sm:col-span-2 border-amber-400/60 shadow-[0_0_28px_-4px_rgba(251,191,36,0.55)]'
          : '',
      ].join(' ')}
    >
      <div className="flex items-center gap-2">
        <span
          className={[
            'flex h-7 w-7 items-center justify-center rounded-md',
            isPuffer
              ? 'bg-amber-500/20'
              : effectiveState === 'IDLE'
                ? 'bg-white/[0.04]'
                : 'bg-white/[0.06]',
          ].join(' ')}
        >
          <IconCanvas name={card.name} isPuffer={isPuffer} color={iconColor} size={isPuffer ? 22 : 18} />
        </span>
        <div className="min-w-0 flex-1">
          <div
            className={[
              'truncate font-mono text-[11px] font-semibold tracking-wider',
              isPuffer ? 'text-amber-200' : 'text-slate-100',
            ].join(' ')}
            title={card.name}
          >
            {isPuffer ? 'YOUR COMPUTER' : card.name.toUpperCase()}
          </div>
          {card.hostProgram && !isPuffer && (
            <div className="truncate font-mono text-[9px] text-slate-500" title={card.hostProgram}>
              {card.hostProgram}
            </div>
          )}
          {card.parentAgent && (
            <div className="truncate font-mono text-[9px] text-violet-300/70">
              parent: {card.parentAgent}
            </div>
          )}
        </div>
        <span
          className={[
            'shrink-0 rounded border px-1.5 py-px font-mono text-[8px] font-semibold tracking-widest uppercase',
            styles.badge,
          ].join(' ')}
        >
          {effectiveState}
        </span>
      </div>

      <div className="flex items-end justify-between gap-2">
        <div className="flex flex-col">
          <span className="font-mono text-[16px] font-semibold leading-none text-slate-100">
            {card.eventsPerMin}
          </span>
          <span className="font-mono text-[8px] uppercase tracking-wider text-slate-500">ev/min</span>
        </div>
        <div className="min-w-0 flex-1">
          <Sparkline values={card.sparkline} color={sparkColor} />
        </div>
      </div>

      {(card.tokens !== undefined || card.costUsd !== undefined) && (
        <div className="flex items-center justify-between border-t border-white/[0.04] pt-1.5 font-mono text-[9px] text-slate-400">
          {card.tokens !== undefined && (
            <span>
              <span className="text-slate-600">tok</span> {formatTokens(card.tokens)}
            </span>
          )}
          {card.costUsd !== undefined && (
            <span>
              <span className="text-slate-600">cost</span> {formatCost(card.costUsd)}
            </span>
          )}
        </div>
      )}
    </button>
  );
};

export default NetworkGridCard;
