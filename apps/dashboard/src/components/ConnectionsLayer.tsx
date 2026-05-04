import React, { useMemo } from 'react';
import type { Edge } from '../hooks/useConnections';
import type { EntityState } from '../hooks/useGridStats';

interface ConnectionsLayerProps {
  edges: Edge[];
  cardRects: Map<string, DOMRect>;
  containerRect: DOMRect | null;
  selectedIds: Set<string>;
}

const COLORS: Record<EntityState, string> = {
  ALLOW: '#10b981',
  AUDIT: '#f59e0b',
  ESCALATE: '#a78bfa',
  BLOCK: '#f43f5e',
  IDLE: '#94a3b8',
};

interface Centroid {
  x: number;
  y: number;
}

function centerOf(rect: DOMRect, containerRect: DOMRect): Centroid {
  return {
    x: rect.left - containerRect.left + rect.width / 2,
    y: rect.top - containerRect.top + rect.height / 2,
  };
}

/**
 * Bezier path between two points with a curvature that bows away from the
 * straight line, so parallel edges are visually distinguishable.
 */
function bezierPath(a: Centroid, b: Centroid, bow = 0.18): string {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.max(1, Math.hypot(dx, dy));
  // Perpendicular offset for the control point.
  const offX = (-dy / len) * len * bow;
  const offY = (dx / len) * len * bow;
  const cx = mx + offX;
  const cy = my + offY;
  return `M ${a.x} ${a.y} Q ${cx} ${cy} ${b.x} ${b.y}`;
}

const ConnectionsLayer: React.FC<ConnectionsLayerProps> = ({
  edges,
  cardRects,
  containerRect,
  selectedIds,
}) => {
  const focusMode = selectedIds.size > 0;

  const renderable = useMemo(() => {
    if (!containerRect) return [] as Array<Edge & { d: string; opacity: number; isFocus: boolean }>;
    const out: Array<Edge & { d: string; opacity: number; isFocus: boolean }> = [];
    for (const edge of edges) {
      const fromRect = cardRects.get(edge.from);
      const toRect = cardRects.get(edge.to);
      if (!fromRect || !toRect) continue;

      const involvesSelected = selectedIds.has(edge.from) || selectedIds.has(edge.to);
      // In focus mode, hide edges that don't touch any selected card.
      if (focusMode && !involvesSelected) continue;

      const a = centerOf(fromRect, containerRect);
      const b = centerOf(toRect, containerRect);
      // Slight per-edge bow variation so overlapping edges separate visually.
      const seed = (edge.from.length + edge.to.length) % 5;
      const bow = 0.14 + seed * 0.04;
      const d = bezierPath(a, b, bow);
      const opacity = focusMode && involvesSelected ? 1 : Math.min(1, 0.35 + edge.intensity * 0.6);
      out.push({ ...edge, d, opacity, isFocus: focusMode && involvesSelected });
    }
    return out;
  }, [edges, cardRects, containerRect, selectedIds, focusMode]);

  if (!containerRect) return null;

  const w = containerRect.width;
  const h = Math.max(containerRect.height, 1);

  return (
    <svg
      className="pointer-events-none absolute left-0 top-0 z-0"
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      style={{ overflow: 'visible' }}
      aria-hidden
    >
      <defs>
        {/* Pulse animation for the moving dash pattern */}
        <style>{`
          .energy-line {
            stroke-dasharray: 5 14;
            animation: energy-flow 1.1s linear infinite;
          }
          .energy-line.block { animation-duration: 0.55s; }
          .energy-line.focus { stroke-dasharray: 0; animation: none; }
          @keyframes energy-flow {
            from { stroke-dashoffset: 0; }
            to { stroke-dashoffset: -38; }
          }
        `}</style>
      </defs>
      {renderable.map((edge) => {
        const stroke = COLORS[edge.decision] ?? COLORS.ALLOW;
        const widthPx = edge.decision === 'BLOCK' ? 2.4 : edge.isFocus ? 2 : 1.4;
        const cls = [
          'energy-line',
          edge.decision === 'BLOCK' ? 'block' : '',
          edge.isFocus ? 'focus' : '',
        ]
          .filter(Boolean)
          .join(' ');
        return (
          <g key={edge.id} opacity={edge.opacity}>
            {/* Soft glow underlay */}
            <path
              d={edge.d}
              fill="none"
              stroke={stroke}
              strokeWidth={widthPx + 4}
              strokeOpacity={0.18}
              strokeLinecap="round"
            />
            {/* Main animated line */}
            <path
              d={edge.d}
              fill="none"
              stroke={stroke}
              strokeWidth={widthPx}
              strokeLinecap="round"
              className={cls}
            />
          </g>
        );
      })}
    </svg>
  );
};

export default ConnectionsLayer;
