import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import NetworkGrid from '../components/NetworkGrid';
import HUDOverlay from '../components/HUDOverlay';
import AgentDetailPanel from '../components/AgentDetailPanel';
import { useDashboard } from '../context/DashboardContext';
import type { LiveEvent } from '../context/DashboardContext';

function buildSparkData(
  events: LiveEvent[],
  filterFn?: (e: LiveEvent) => boolean,
): { v: number }[] {
  const now = Date.now();
  const BUCKET_MS = 5 * 60 * 1000;
  const BUCKETS = 12;
  const counts = new Array(BUCKETS).fill(0);
  for (const ev of events) {
    if (filterFn && !filterFn(ev)) continue;
    const age = now - new Date(ev.timestamp).getTime();
    const idx = Math.floor(age / BUCKET_MS);
    if (idx >= 0 && idx < BUCKETS) counts[BUCKETS - 1 - idx]++;
  }
  return counts.map((v) => ({ v }));
}

const DashboardPage: React.FC = () => {
  const {
    stats,
    liveEvents,
    agents,
    connected,
    selectedCardIds,
    toggleCardSelection,
    clearSelection,
    selectedEntity,
    openCardDetail,
    closeDetail,
    skillInventory,
  } = useDashboard();

  return (
    <>
      <NetworkGrid
        liveEvents={liveEvents}
        agents={agents}
        selectedIds={selectedCardIds}
        onCardSelect={toggleCardSelection}
        onCardOpenDetail={openCardDetail}
      />

      {selectedCardIds.size > 0 && (
        <div className="absolute left-1/2 top-4 z-30 -translate-x-1/2">
          <button
            type="button"
            onClick={clearSelection}
            className="flex items-center gap-2 rounded-full border border-cyan-400/40 bg-[rgba(8,11,18,0.85)] px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest text-cyan-200 shadow-[0_0_18px_-4px_rgba(34,211,238,0.55)] transition-colors hover:bg-[rgba(20,26,40,0.95)]"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-cyan-300 shadow-[0_0_8px_rgba(34,211,238,0.8)]" />
            <span>{selectedCardIds.size} focused</span>
            <span className="text-slate-500">·</span>
            <span className="text-slate-300">clear</span>
            <span className="text-slate-500">×</span>
          </button>
        </div>
      )}

      <HUDOverlay
        stats={stats}
        liveEvents={liveEvents}
        agents={agents}
        connected={connected}
        panelOpen={false}
        sparkEvents={buildSparkData(liveEvents)}
        sparkBlocked={buildSparkData(liveEvents, (e) => e.decision === 'BLOCK')}
        sparkAllowed={buildSparkData(liveEvents, (e) => e.decision === 'ALLOW')}
      />

      {/* Drawer for entity drill-down (double-click on card) */}
      <AnimatePresence>
        {selectedEntity && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="absolute inset-0 z-20 bg-black/20 backdrop-blur-sm dark:bg-black/40"
              onClick={closeDetail}
            />
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 250 }}
              className="drawer-panel absolute bottom-0 right-0 top-0 z-30 w-[900px] max-w-[90vw]"
            >
              <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
                <span className="font-mono text-sm font-bold tracking-wider text-slate-800 dark:text-cyan-400">
                  ENTITY DETAIL
                </span>
                <button
                  onClick={closeDetail}
                  className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-black/5 hover:text-slate-800 dark:hover:bg-white/10 dark:hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="scrollbar-thin h-[calc(100%-57px)] overflow-y-auto overflow-x-hidden p-5 pb-10">
                <AgentDetailPanel node={selectedEntity} agents={agents} liveEvents={liveEvents} skillInventory={skillInventory} />
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
};

export default DashboardPage;
