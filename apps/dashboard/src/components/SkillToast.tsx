import React, { useEffect, useState, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

export type SkillToastVariant = 'skill_added' | 'skill_modified' | 'skill_removed';

export interface SkillToastItem {
  id: string;
  variant: SkillToastVariant;
  skillName: string;
  source?: string;
}

interface SkillToastProps {
  toasts: SkillToastItem[];
  onDismiss: (id: string) => void;
}

const VARIANT_STYLES: Record<SkillToastVariant, { bg: string; border: string; icon: string }> = {
  skill_added: {
    bg: 'bg-yellow-500/10',
    border: 'border-yellow-400/30',
    icon: '🆕',
  },
  skill_modified: {
    bg: 'bg-orange-500/10',
    border: 'border-orange-400/30',
    icon: '⚠️',
  },
  skill_removed: {
    bg: 'bg-slate-500/10',
    border: 'border-slate-400/20',
    icon: '🗑',
  },
};

const VARIANT_TEXT: Record<SkillToastVariant, string> = {
  skill_added: 'New skill detected',
  skill_modified: 'Skill modified',
  skill_removed: 'Skill removed',
};

const AUTO_DISMISS_MS = 5_000;

const SkillToastEntry: React.FC<{
  toast: SkillToastItem;
  onDismiss: (id: string) => void;
}> = ({ toast, onDismiss }) => {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [toast.id, onDismiss]);

  const styles = VARIANT_STYLES[toast.variant];

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 40, scale: 0.95 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 40, scale: 0.95 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
      className={[
        'flex items-start gap-3 rounded-lg border px-3.5 py-3 shadow-xl',
        'max-w-[320px] min-w-[240px]',
        styles.bg,
        styles.border,
        'bg-[rgba(8,11,18,0.95)] backdrop-blur-md',
      ].join(' ')}
    >
      <span className="text-base leading-none mt-0.5 flex-shrink-0">{styles.icon}</span>
      <div className="min-w-0 flex-1">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-wider text-slate-300">
          {VARIANT_TEXT[toast.variant]}
        </p>
        <p className="font-mono text-[10px] text-slate-400 truncate mt-0.5">
          <span className="text-amber-300">{toast.skillName}</span>
          {toast.source && toast.variant === 'skill_added' && (
            <span className="text-slate-500"> · {toast.source}</span>
          )}
        </p>
      </div>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss"
        className="flex-shrink-0 text-slate-500 hover:text-slate-300 transition-colors mt-0.5"
      >
        <span className="text-xs">✕</span>
      </button>
    </motion.div>
  );
};

/**
 * Mounts a fixed toast container in the top-right corner.
 * Render this once inside App.tsx at the root level so it persists across routes.
 */
const SkillToastContainer: React.FC<SkillToastProps> = ({ toasts, onDismiss }) => {
  return (
    <div
      className="fixed right-4 top-4 z-[9999] flex flex-col gap-2 items-end pointer-events-none"
      aria-live="polite"
      aria-label="Skill notifications"
    >
      <AnimatePresence mode="popLayout">
        {toasts.map((t) => (
          <div key={t.id} className="pointer-events-auto">
            <SkillToastEntry toast={t} onDismiss={onDismiss} />
          </div>
        ))}
      </AnimatePresence>
    </div>
  );
};

/**
 * Hook to manage the toast list. Returns [toasts, addToast, dismissToast].
 */
export function useSkillToasts(): [
  SkillToastItem[],
  (variant: SkillToastVariant, skillName: string, source?: string) => void,
  (id: string) => void,
] {
  const [toasts, setToasts] = useState<SkillToastItem[]>([]);

  const addToast = useCallback(
    (variant: SkillToastVariant, skillName: string, source?: string) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      setToasts((prev) => [...prev.slice(-4), { id, variant, skillName, source }]);
    },
    [],
  );

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return [toasts, addToast, dismissToast];
}

export default SkillToastContainer;
