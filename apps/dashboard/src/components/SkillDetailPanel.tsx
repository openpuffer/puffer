import React, { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Copy, Check } from 'lucide-react';
import type { SkillManifest } from '@puffer/core';
import type { LiveEvent } from '../App';

interface SkillDetailPanelProps {
  skill: SkillManifest | null;
  liveEvents: LiveEvent[];
  onClose: () => void;
}

// Derives client-side status from the config (future: fetch /api/config for real policy).
// Since /api/config does not expose allow/denylist we cannot derive a real status.
// All skills are shown as MONITORED with an informational note.
type SkillStatus = 'MONITORED';

function deriveStatus(_skill: SkillManifest): SkillStatus {
  return 'MONITORED';
}

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

function formatAbsolute(ts: string): string {
  try {
    return new Date(ts).toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return ts;
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

const SOURCE_CHIP_STYLES: Record<string, string> = {
  'claude-code-global': 'bg-blue-500/15 text-blue-300 border-blue-500/20',
  'claude-code-project': 'bg-cyan-500/15 text-cyan-300 border-cyan-500/20',
  'openclaw-bundled': 'bg-purple-500/15 text-purple-300 border-purple-500/20',
  'openclaw-user': 'bg-violet-500/15 text-violet-300 border-violet-500/20',
  unknown: 'bg-slate-500/15 text-slate-400 border-slate-500/20',
};

const CopyButton: React.FC<{ text: string; className?: string }> = ({ text, className = '' }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [text]);

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-mono transition-colors ${
        copied
          ? 'bg-emerald-500/15 text-emerald-400'
          : 'bg-white/[0.04] text-slate-400 hover:bg-white/[0.08] hover:text-slate-200'
      } ${className}`}
      title="Copy to clipboard"
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
};

const PolicyClipboardButton: React.FC<{
  label: string;
  yaml: string;
  accentClass: string;
}> = ({ label, yaml, accentClass }) => {
  const [copied, setCopied] = useState(false);

  const handleClick = useCallback(async () => {
    await navigator.clipboard.writeText(yaml);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [yaml]);

  return (
    <button
      type="button"
      onClick={handleClick}
      className={[
        'flex-1 rounded-md border px-3 py-2 text-[11px] font-mono font-semibold uppercase tracking-wider transition-colors',
        accentClass,
        copied ? 'opacity-80' : '',
      ].join(' ')}
    >
      {copied ? '✓ Copied — paste into ~/.puffer/config.yaml' : label}
    </button>
  );
};

const SkillDetailPanel: React.FC<SkillDetailPanelProps> = ({ skill, liveEvents, onClose }) => {
  const [manifestText, setManifestText] = useState<string | null>(null);
  const [manifestLoading, setManifestLoading] = useState(false);

  useEffect(() => {
    if (!skill?.manifestPath || !skill.id) {
      setManifestText(null);
      return;
    }

    setManifestLoading(true);
    setManifestText(null);

    const encodedId = encodeURIComponent(skill.id);
    fetch(`/api/skills/${encodedId}/manifest`)
      .then((res) => {
        if (!res.ok) throw new Error('Not found');
        return res.text();
      })
      .then((text) => {
        setManifestText(text);
      })
      .catch(() => {
        setManifestText(null);
      })
      .finally(() => {
        setManifestLoading(false);
      });
  }, [skill?.id, skill?.manifestPath]);

  if (!skill) return null;

  const status = deriveStatus(skill);
  const sourceStyle = SOURCE_CHIP_STYLES[skill.source] ?? SOURCE_CHIP_STYLES.unknown;

  // Filter skill_invoke events for this skill (last 5).
  const skillInvocations = liveEvents
    .filter(
      (e) =>
        e.action.type === 'skill_invoke' &&
        (e.action as unknown as { skill?: { id?: string } }).skill?.id === skill.id,
    )
    .slice(0, 5);

  const denylistYaml = `layers:\n  skills:\n    denylist:\n      - "${skill.name}"`;
  const allowlistYaml = `layers:\n  skills:\n    allowlist:\n      - "${skill.name}"`;

  return (
    <div className="flex h-full flex-col space-y-0 overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 border-b border-white/[0.05] px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="font-mono text-base font-bold text-slate-100 tracking-wide">
                {skill.name}
              </h2>
              <span
                className={`inline-block rounded border px-1.5 py-px font-mono text-[9px] uppercase tracking-wider ${sourceStyle}`}
              >
                {skill.source}
              </span>
              <span className="inline-block rounded border border-slate-600/30 bg-slate-500/10 px-1.5 py-px font-mono text-[9px] uppercase tracking-wider text-slate-400">
                {status}
                {status === 'MONITORED' && (
                  <span
                    title="Status requires server-side policy data — wire up after enabling allow/denylist"
                    className="ml-1 cursor-help"
                  >
                    ℹ
                  </span>
                )}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close skill detail"
            className="flex-shrink-0 rounded-md p-1.5 text-slate-400 hover:bg-white/[0.06] hover:text-slate-100 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Body — scrollable */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
        {/* Identity */}
        <section className="rounded-lg border border-white/[0.05] bg-white/[0.02] p-3 space-y-2">
          <h3 className="font-mono text-[10px] font-bold uppercase tracking-wider text-sky-400 mb-2">
            Identity
          </h3>
          <div className="flex items-center justify-between text-xs gap-2">
            <span className="text-slate-500 shrink-0">id</span>
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-mono text-slate-300 truncate">{skill.id}</span>
            </div>
          </div>
          <div className="flex items-start justify-between text-xs gap-2">
            <span className="text-slate-500 shrink-0 mt-0.5">hash</span>
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-mono text-slate-400 text-[10px] break-all">
                {skill.contentHash}
              </span>
              <CopyButton text={skill.contentHash} className="flex-shrink-0" />
            </div>
          </div>
          <div className="flex items-center justify-between text-xs gap-2">
            <span className="text-slate-500 shrink-0">modified</span>
            <span
              className="font-mono text-slate-400 cursor-default"
              title={formatAbsolute(skill.lastModified)}
            >
              {formatRelativeTime(skill.lastModified)}
            </span>
          </div>
        </section>

        {/* Description */}
        {skill.description && (
          <section>
            <h3 className="font-mono text-[10px] font-bold uppercase tracking-wider text-violet-400 mb-2">
              Description
            </h3>
            <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap">
              {skill.description}
            </p>
          </section>
        )}

        {/* Files */}
        <section className="rounded-lg border border-white/[0.05] bg-white/[0.02] p-3 space-y-1.5">
          <h3 className="font-mono text-[10px] font-bold uppercase tracking-wider text-emerald-400 mb-2">
            Files
          </h3>
          <div className="flex justify-between text-xs">
            <span className="text-slate-500">count</span>
            <span className="font-mono text-slate-300">
              {/* TODO: add a dedicated file-listing endpoint to show individual file paths */}
              {skill.fileCount} file{skill.fileCount !== 1 ? 's' : ''}
            </span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-slate-500">total size</span>
            <span className="font-mono text-slate-300">{formatBytes(skill.sizeBytes)}</span>
          </div>
          {skill.manifestPath && (
            <div className="flex justify-between text-xs">
              <span className="text-slate-500">manifest</span>
              <span className="font-mono text-slate-400 text-[10px] truncate max-w-[180px]">
                SKILL.md present
              </span>
            </div>
          )}
        </section>

        {/* Manifest content */}
        {skill.manifestPath && (
          <section>
            <h3 className="font-mono text-[10px] font-bold uppercase tracking-wider text-amber-400 mb-2">
              Manifest (SKILL.md)
            </h3>
            {manifestLoading && (
              <p className="font-mono text-[11px] text-slate-500">Loading…</p>
            )}
            {!manifestLoading && manifestText !== null && (
              <pre className="overflow-x-auto rounded-lg border border-white/[0.05] bg-black/30 p-3 font-mono text-[11px] text-slate-300 leading-relaxed max-h-64">
                {manifestText}
              </pre>
            )}
            {!manifestLoading && manifestText === null && (
              <p className="font-mono text-[11px] text-slate-500 italic">
                Manifest file not readable.
              </p>
            )}
          </section>
        )}

        {/* Recent invocations */}
        <section>
          <h3 className="font-mono text-[10px] font-bold uppercase tracking-wider text-orange-400 mb-2">
            Recent Invocations (this session)
          </h3>
          {skillInvocations.length === 0 ? (
            <p className="font-mono text-[11px] text-slate-500 italic">
              No invocations recorded in this session.
            </p>
          ) : (
            <div className="space-y-1.5">
              {skillInvocations.map((ev) => {
                const action = ev.action as unknown as {
                  skill?: { id?: string };
                };
                void action; // used above for filtering
                return (
                  <div
                    key={ev.id}
                    className="flex items-center gap-2 rounded border border-white/[0.05] bg-white/[0.02] px-2.5 py-1.5 text-xs"
                  >
                    <span
                      className="inline-block h-1.5 w-1.5 rounded-full flex-shrink-0"
                      style={{
                        backgroundColor:
                          ev.decision === 'ALLOW'
                            ? '#4ade80'
                            : ev.decision === 'BLOCK'
                              ? '#f87171'
                              : '#fbbf24',
                      }}
                    />
                    <span className="font-mono text-slate-400 shrink-0">
                      {ev.source.agent}
                    </span>
                    <span className="font-mono text-slate-500 text-[10px] ml-auto shrink-0">
                      {formatRelativeTime(ev.timestamp)}
                    </span>
                    <span
                      className={`font-mono text-[9px] uppercase px-1 py-px rounded ${
                        ev.decision === 'ALLOW'
                          ? 'bg-emerald-500/20 text-emerald-400'
                          : ev.decision === 'BLOCK'
                            ? 'bg-red-500/20 text-red-400'
                            : 'bg-amber-500/20 text-amber-400'
                      }`}
                    >
                      {ev.decision}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {/* Footer — policy actions */}
      <div className="flex-shrink-0 border-t border-white/[0.05] px-5 py-4">
        <p className="font-mono text-[10px] text-slate-500 mb-3">
          Policy actions copy a YAML snippet. Paste into{' '}
          <span className="text-slate-400">~/.puffer/config.yaml</span> and restart daemon.
        </p>
        <div className="flex gap-2">
          <PolicyClipboardButton
            label="Add to denylist"
            yaml={denylistYaml}
            accentClass="border-red-500/30 bg-red-500/[0.05] text-red-400 hover:bg-red-500/[0.10]"
          />
          <PolicyClipboardButton
            label="Add to allowlist"
            yaml={allowlistYaml}
            accentClass="border-emerald-500/30 bg-emerald-500/[0.05] text-emerald-400 hover:bg-emerald-500/[0.10]"
          />
        </div>
      </div>
    </div>
  );
};

interface SkillDetailDrawerProps {
  skill: SkillManifest | null;
  liveEvents: LiveEvent[];
  onClose: () => void;
}

/**
 * Slide-in drawer wrapping SkillDetailPanel.
 * Mirrors the AgentDetailPanel UX — same framer-motion slide, same backdrop.
 */
const SkillDetailDrawer: React.FC<SkillDetailDrawerProps> = ({ skill, liveEvents, onClose }) => {
  return (
    <AnimatePresence>
      {skill && (
        <>
          {/* Backdrop */}
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
            onClick={onClose}
          />
          {/* Panel */}
          <motion.aside
            key="panel"
            initial={{ x: '100%', opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: '100%', opacity: 0 }}
            transition={{ type: 'spring', stiffness: 320, damping: 35 }}
            className={[
              'fixed right-0 top-0 z-50 h-full',
              'w-[420px] max-w-[90vw]',
              'border-l border-white/[0.05]',
              'bg-[rgba(8,11,18,0.97)] backdrop-blur-xl',
              'shadow-2xl',
            ].join(' ')}
          >
            <SkillDetailPanel skill={skill} liveEvents={liveEvents} onClose={onClose} />
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
};

export default SkillDetailDrawer;
