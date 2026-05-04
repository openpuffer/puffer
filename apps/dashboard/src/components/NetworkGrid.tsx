import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LiveEvent, AgentInfo } from '../App';
import { useGridStats, type EntityCard } from '../hooks/useGridStats';
import { useConnections, type Edge } from '../hooks/useConnections';
import NetworkGridCard from './NetworkGridCard';
import ConnectionsLayer from './ConnectionsLayer';

interface NetworkGridProps {
  liveEvents: LiveEvent[];
  agents: AgentInfo[];
  selectedIds: Set<string>;
  onCardSelect: (card: EntityCard) => void;
  onCardOpenDetail: (card: EntityCard) => void;
}

interface SectionProps {
  title: string;
  cards: EntityCard[];
  recentBlocks: Set<string>;
  selectedIds: Set<string>;
  linkedIds: Set<string>;
  onCardSelect: (card: EntityCard) => void;
  onCardOpenDetail: (card: EntityCard) => void;
  registerRef: (id: string, el: HTMLElement | null) => void;
  emptyHint?: string;
}

const Section: React.FC<SectionProps> = ({
  title,
  cards,
  recentBlocks,
  selectedIds,
  linkedIds,
  onCardSelect,
  onCardOpenDetail,
  registerRef,
  emptyHint,
}) => {
  const activeCount = cards.filter((c) => c.state !== 'IDLE').length;
  const focusMode = selectedIds.size > 0;
  return (
    <section className="flex flex-col gap-2">
      <header className="flex items-baseline justify-between border-b border-white/[0.05] pb-1.5">
        <h2 className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-slate-300/90">
          {title}
        </h2>
        <span className="font-mono text-[9px] uppercase tracking-wider text-slate-500">
          {cards.length === 0 ? '—' : `${activeCount} active · ${cards.length} total`}
        </span>
      </header>
      {cards.length === 0 ? (
        <p className="px-1 py-2 font-mono text-[10px] italic text-slate-600">
          {emptyHint ?? 'No data yet'}
        </p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-2.5">
          {cards.map((c) => {
            const selected = selectedIds.has(c.id);
            const linked = !selected && linkedIds.has(c.id);
            const dimmed = focusMode && !selected && !linked;
            return (
              <NetworkGridCard
                key={c.id}
                card={c}
                blocked={recentBlocks.has(c.id)}
                selected={selected}
                linked={linked}
                dimmed={dimmed}
                onSelect={onCardSelect}
                onOpenDetail={onCardOpenDetail}
                registerRef={registerRef}
              />
            );
          })}
        </div>
      )}
    </section>
  );
};

function buildLinkedSet(edges: Edge[], selected: Set<string>): Set<string> {
  if (selected.size === 0) return new Set();
  const linked = new Set<string>();
  for (const edge of edges) {
    if (selected.has(edge.from)) linked.add(edge.to);
    if (selected.has(edge.to)) linked.add(edge.from);
  }
  return linked;
}

const NetworkGrid: React.FC<NetworkGridProps> = ({
  liveEvents,
  agents,
  selectedIds,
  onCardSelect,
  onCardOpenDetail,
}) => {
  const stats = useGridStats(liveEvents, agents);
  const edges = useConnections(liveEvents);

  // Card refs registry — used by the ConnectionsLayer to compute endpoints.
  const cardElsRef = useRef<Map<string, HTMLElement>>(new Map());
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [cardRects, setCardRects] = useState<Map<string, DOMRect>>(new Map());
  const [containerRect, setContainerRect] = useState<DOMRect | null>(null);

  const registerRef = useCallback((id: string, el: HTMLElement | null) => {
    if (el) cardElsRef.current.set(id, el);
    else cardElsRef.current.delete(id);
  }, []);

  // Recompute rects on layout-relevant changes: card set changes or window resize.
  // We intentionally skip recomputing on scroll because the SVG lives inside the
  // scrolling container, so its coordinate space scrolls with the cards.
  const recomputeRects = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const containerBox = container.getBoundingClientRect();
    setContainerRect(containerBox);
    const next = new Map<string, DOMRect>();
    for (const [id, el] of cardElsRef.current) {
      next.set(id, el.getBoundingClientRect());
    }
    setCardRects(next);
  }, []);

  useEffect(() => {
    recomputeRects();
  }, [
    stats.agents.length,
    stats.providers.length,
    stats.mcps.length,
    stats.subagents.length,
    recomputeRects,
  ]);

  useEffect(() => {
    const onResize = () => recomputeRects();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [recomputeRects]);

  // ResizeObserver on the container catches CSS-driven layout changes that
  // window resize misses (e.g. drawer opening shifts the grid).
  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => recomputeRects());
    ro.observe(container);
    return () => ro.disconnect();
  }, [recomputeRects]);

  const linkedIds = useMemo(() => buildLinkedSet(edges, selectedIds), [edges, selectedIds]);

  // Aggregated Puffer card — sums everything routed through the daemon.
  const pufferCard: EntityCard = useMemo(() => {
    const totalEv = stats.agents.reduce((s, a) => s + a.eventsPerMin, 0);
    const totalTok = stats.providers.reduce((s, p) => s + (p.tokens ?? 0), 0);
    const totalCost = stats.providers.reduce((s, p) => s + (p.costUsd ?? 0), 0);
    const recentlyActive = stats.agents.some((a) => a.recentlyActive);
    const buckets = new Array(12).fill(0);
    for (const a of stats.agents) {
      a.sparkline.forEach((v, i) => {
        buckets[i] += v;
      });
    }
    const card: EntityCard = {
      id: 'puffer:root',
      kind: 'agent',
      name: 'puffer',
      state: stats.recentBlocks.size > 0 ? 'BLOCK' : totalEv > 0 ? 'ALLOW' : 'IDLE',
      eventsPerMin: totalEv,
      sparkline: buckets,
      recentlyActive,
    };
    if (totalTok > 0) card.tokens = totalTok;
    if (totalCost > 0) card.costUsd = totalCost;
    return card;
  }, [stats]);

  return (
    <div className="absolute inset-0 z-0 overflow-y-auto overflow-x-hidden pt-32 pb-32 pl-[260px] pr-[110px]">
      <div ref={containerRef} className="relative mx-auto flex max-w-[1500px] flex-col gap-5">
        <ConnectionsLayer
          edges={edges}
          cardRects={cardRects}
          containerRect={containerRect}
          selectedIds={selectedIds}
        />
        {/* Central Puffer card */}
        <section className="flex justify-center">
          <div className="grid w-full max-w-[420px] grid-cols-2 gap-2.5">
            <NetworkGridCard
              card={pufferCard}
              isPuffer
              selected={selectedIds.has(pufferCard.id)}
              linked={!selectedIds.has(pufferCard.id) && linkedIds.has(pufferCard.id)}
              dimmed={
                selectedIds.size > 0 &&
                !selectedIds.has(pufferCard.id) &&
                !linkedIds.has(pufferCard.id)
              }
              onSelect={onCardSelect}
              onOpenDetail={onCardOpenDetail}
              registerRef={registerRef}
            />
            <div className="flex flex-col items-start justify-center gap-1 px-3 font-mono text-[10px] text-slate-400">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-300">
                Hub
              </div>
              <div className="text-slate-500">
                {stats.agents.length} agents · {stats.providers.length} providers
              </div>
              <div className="text-slate-500">
                {stats.mcps.length} mcps · {stats.subagents.length} subagents
              </div>
            </div>
          </div>
        </section>

        <Section
          title="Agents"
          cards={stats.agents}
          recentBlocks={stats.recentBlocks}
          selectedIds={selectedIds}
          linkedIds={linkedIds}
          onCardSelect={onCardSelect}
          onCardOpenDetail={onCardOpenDetail}
          registerRef={registerRef}
          emptyHint="Waiting for agent traffic…"
        />
        <Section
          title="Providers"
          cards={stats.providers}
          recentBlocks={stats.recentBlocks}
          selectedIds={selectedIds}
          linkedIds={linkedIds}
          onCardSelect={onCardSelect}
          onCardOpenDetail={onCardOpenDetail}
          registerRef={registerRef}
          emptyHint="No LLM providers seen yet"
        />
        <Section
          title="MCP Servers"
          cards={stats.mcps}
          recentBlocks={stats.recentBlocks}
          selectedIds={selectedIds}
          linkedIds={linkedIds}
          onCardSelect={onCardSelect}
          onCardOpenDetail={onCardOpenDetail}
          registerRef={registerRef}
          emptyHint="No MCP tool calls yet"
        />
        <Section
          title="Subagents"
          cards={stats.subagents}
          recentBlocks={stats.recentBlocks}
          selectedIds={selectedIds}
          linkedIds={linkedIds}
          onCardSelect={onCardSelect}
          onCardOpenDetail={onCardOpenDetail}
          registerRef={registerRef}
          emptyHint="No spawned subagents"
        />
      </div>
    </div>
  );
};

export default NetworkGrid;
