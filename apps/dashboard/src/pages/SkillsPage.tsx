import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { useDashboard } from '../context/DashboardContext';
import type { SkillManifest } from '@puffer/core';
import type { SkillSource } from '@puffer/core';
import { filterAndSortSkills, type SkillSortKey } from '../lib/skillHelpers';
import SkillDetailDrawer from '../components/SkillDetailPanel';

const ALL_SOURCES: SkillSource[] = [
  'claude-code-global',
  'claude-code-project',
  'openclaw-bundled',
  'openclaw-user',
];

const SOURCE_LABELS: Record<SkillSource, string> = {
  'claude-code-global': 'CC Global',
  'claude-code-project': 'CC Project',
  'openclaw-bundled': 'OC Bundled',
  'openclaw-user': 'OC User',
  unknown: 'Unknown',
};

const SOURCE_CHIP_STYLES: Record<SkillSource | 'unknown', string> = {
  'claude-code-global': 'bg-blue-500/15 text-blue-300 border-blue-500/20',
  'claude-code-project': 'bg-cyan-500/15 text-cyan-300 border-cyan-500/20',
  'openclaw-bundled': 'bg-purple-500/15 text-purple-300 border-purple-500/20',
  'openclaw-user': 'bg-violet-500/15 text-violet-300 border-violet-500/20',
  unknown: 'bg-slate-500/15 text-slate-400 border-slate-500/20',
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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

const SkillsPage: React.FC = () => {
  const { liveEvents } = useDashboard();

  const [skills, setSkills] = useState<SkillManifest[]>([]);
  const [lastScan, setLastScan] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);

  const [query, setQuery] = useState('');
  const [activeSources, setActiveSources] = useState<Set<SkillSource>>(new Set());
  const [sortKey, setSortKey] = useState<SkillSortKey>('modified');

  const [selectedSkill, setSelectedSkill] = useState<SkillManifest | null>(null);

  // Initial fetch on mount.
  useEffect(() => {
    fetch('/api/skills')
      .then((res) => res.json())
      .then((data: SkillManifest[]) => {
        if (Array.isArray(data)) {
          setSkills(data);
          setLastScan(new Date());
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // React to WebSocket skill change events via liveEvents from DashboardContext.
  // We do NOT open a second WebSocket — we reuse the one in DashboardProvider.
  useEffect(() => {
    if (liveEvents.length === 0) return;
    const latest = liveEvents[0];
    if (!latest) return;
    const actionType = latest.action.type;
    if (
      actionType !== 'skill_added' &&
      actionType !== 'skill_modified' &&
      actionType !== 'skill_removed'
    ) {
      return;
    }

    // Re-fetch the full inventory so we stay consistent with server state.
    fetch('/api/skills')
      .then((res) => res.json())
      .then((data: SkillManifest[]) => {
        if (Array.isArray(data)) {
          setSkills(data);
          setLastScan(new Date());
        }
      })
      .catch(() => {});
  }, [liveEvents]);

  const toggleSource = useCallback((source: SkillSource) => {
    setActiveSources((prev) => {
      const next = new Set(prev);
      if (next.has(source)) next.delete(source);
      else next.add(source);
      return next;
    });
  }, []);

  const filtered = useMemo(
    () => filterAndSortSkills(skills, query, activeSources, sortKey),
    [skills, query, activeSources, sortKey],
  );

  const uniqueSources = useMemo(() => {
    const set = new Set(skills.map((s) => s.source));
    return set.size;
  }, [skills]);

  const lastScanLabel = useMemo(() => {
    if (!lastScan) return '—';
    const diffS = Math.round((Date.now() - lastScan.getTime()) / 1000);
    if (diffS < 5) return 'just now';
    return `${diffS}s ago`;
  }, [lastScan]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Page header */}
      <header className="flex-shrink-0 border-b border-white/[0.05] px-6 py-4">
        <h1 className="font-mono text-lg font-bold uppercase tracking-widest text-slate-100">
          Skills Inventory
        </h1>
        <p className="font-mono text-[11px] uppercase tracking-wider text-slate-500">
          {loading
            ? 'Scanning…'
            : `${skills.length} skill${skills.length !== 1 ? 's' : ''} tracked across ${uniqueSources} source${uniqueSources !== 1 ? 's' : ''} · last scan: ${lastScanLabel}`}
        </p>
      </header>

      {/* Filter row */}
      <div className="flex-shrink-0 border-b border-white/[0.05] px-6 py-3 flex flex-wrap gap-3 items-center">
        {/* Search */}
        <input
          type="text"
          placeholder="Search by name or description…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className={[
            'h-8 flex-1 min-w-[180px] max-w-xs rounded-md border border-white/[0.08]',
            'bg-white/[0.04] px-3 font-mono text-[12px] text-slate-200',
            'placeholder:text-slate-600 focus:outline-none focus:border-amber-400/40',
          ].join(' ')}
        />

        {/* Source chips */}
        <div className="flex gap-1.5 flex-wrap">
          {ALL_SOURCES.map((src) => {
            const active = activeSources.has(src);
            const chip = SOURCE_CHIP_STYLES[src];
            return (
              <button
                key={src}
                type="button"
                onClick={() => toggleSource(src)}
                className={[
                  'rounded border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider transition-all',
                  active
                    ? chip
                    : 'border-white/[0.06] bg-transparent text-slate-500 hover:border-white/[0.12] hover:text-slate-400',
                ].join(' ')}
              >
                {SOURCE_LABELS[src]}
              </button>
            );
          })}
        </div>

        {/* Sort */}
        <select
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as SkillSortKey)}
          className={[
            'h-8 rounded-md border border-white/[0.08] bg-[rgba(8,11,18,0.85)]',
            'px-2 font-mono text-[11px] text-slate-300',
            'focus:outline-none focus:border-amber-400/40',
          ].join(' ')}
        >
          <option value="modified">Recently Modified</option>
          <option value="alpha">Alphabetical</option>
          <option value="size">Size</option>
          <option value="source">Source</option>
        </select>
      </div>

      {/* Table area */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {loading ? (
          <p className="font-mono text-sm text-slate-500 mt-8 text-center">Scanning skills…</p>
        ) : filtered.length === 0 ? (
          <div className="mt-12 text-center">
            {skills.length === 0 ? (
              <>
                <p className="font-mono text-sm text-slate-400 mb-2">No skills detected.</p>
                <p className="font-mono text-[11px] text-slate-600 max-w-md mx-auto">
                  Puffer scans{' '}
                  <span className="text-slate-500">~/.claude/skills/</span>,{' '}
                  project <span className="text-slate-500">.claude/skills/</span>, and{' '}
                  OpenClaw&apos;s bundled skills directory every 30 seconds.
                </p>
              </>
            ) : (
              <p className="font-mono text-sm text-slate-500">
                No skills match the current filters.
              </p>
            )}
          </div>
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-white/[0.05]">
                {['Name', 'Source', 'Description', 'Files', 'Size', 'Modified', 'Hash', 'Status'].map(
                  (col) => (
                    <th
                      key={col}
                      className="pb-2 text-left font-mono text-[10px] uppercase tracking-wider text-slate-500 pr-4 first:pl-0"
                    >
                      {col}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {filtered.map((skill) => {
                const sourceStyle = SOURCE_CHIP_STYLES[skill.source] ?? SOURCE_CHIP_STYLES.unknown;
                return (
                  <tr
                    key={skill.id}
                    onClick={() => setSelectedSkill(skill)}
                    className="border-b border-white/[0.03] hover:bg-white/[0.03] cursor-pointer transition-colors"
                  >
                    <td className="py-2.5 pr-4">
                      <span className="font-mono text-[12px] font-semibold text-slate-200">
                        {skill.name}
                      </span>
                    </td>
                    <td className="py-2.5 pr-4">
                      <span
                        className={`inline-block rounded border px-1.5 py-px font-mono text-[9px] uppercase tracking-wider whitespace-nowrap ${sourceStyle}`}
                      >
                        {skill.source}
                      </span>
                    </td>
                    <td className="py-2.5 pr-4 max-w-[200px]">
                      <span
                        className="font-mono text-[11px] text-slate-400 block truncate"
                        title={skill.description}
                      >
                        {skill.description || <span className="italic text-slate-600">—</span>}
                      </span>
                    </td>
                    <td className="py-2.5 pr-4">
                      <span className="font-mono text-[11px] text-slate-400">{skill.fileCount}</span>
                    </td>
                    <td className="py-2.5 pr-4 whitespace-nowrap">
                      <span className="font-mono text-[11px] text-slate-400">
                        {formatBytes(skill.sizeBytes)}
                      </span>
                    </td>
                    <td className="py-2.5 pr-4 whitespace-nowrap">
                      <span className="font-mono text-[11px] text-slate-400">
                        {formatRelativeTime(skill.lastModified)}
                      </span>
                    </td>
                    <td className="py-2.5 pr-4">
                      <span className="font-mono text-[10px] text-slate-500">
                        {skill.contentHash.slice(0, 8)}
                      </span>
                    </td>
                    <td className="py-2.5">
                      <span className="inline-block rounded border border-slate-600/30 bg-slate-500/10 px-1.5 py-px font-mono text-[9px] uppercase tracking-wider text-slate-400">
                        MONITORED
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Skill detail drawer */}
      <SkillDetailDrawer
        skill={selectedSkill}
        liveEvents={liveEvents}
        onClose={() => setSelectedSkill(null)}
      />
    </div>
  );
};

export default SkillsPage;
