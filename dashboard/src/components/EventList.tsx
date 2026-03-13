import React, { useState, useEffect, useRef } from 'react';
import { useApi } from '../hooks/useApi';
import type { LiveEvent } from '../App';

interface PufferEvent {
  id: string;
  timestamp: string;
  agent: string;
  provider: string;
  actionType: string;
  decision: 'ALLOW' | 'BLOCK' | 'AUDIT' | 'ESCALATE';
  layers: string[];
  details?: Record<string, unknown>;
}

interface EventsResponse {
  events: PufferEvent[];
  total: number;
}

interface EventListProps {
  liveEvents: LiveEvent[];
}

const decisionColors: Record<string, string> = {
  ALLOW: 'bg-puffer-green/20 text-puffer-green border-puffer-green/30',
  BLOCK: 'bg-puffer-red/20 text-puffer-red border-puffer-red/30',
  AUDIT: 'bg-puffer-yellow/20 text-puffer-yellow border-puffer-yellow/30',
  ESCALATE: 'bg-puffer-purple/20 text-puffer-purple border-puffer-purple/30',
};

const EventList: React.FC<EventListProps> = ({ liveEvents }) => {
  const [offset, setOffset] = useState(0);
  const limit = 20;
  const { data, loading, error, refetch } = useApi<EventsResponse>(
    `/api/events?limit=${limit}&offset=${offset}`
  );
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const prevLiveCountRef = useRef(0);
  const hasNewLive = liveEvents.length > prevLiveCountRef.current;

  // Track previous live event count (mark as "seen" after render)
  useEffect(() => {
    const timer = setTimeout(() => {
      prevLiveCountRef.current = liveEvents.length;
    }, 2000);
    return () => clearTimeout(timer);
  }, [liveEvents.length]);

  // Auto-refresh API events every 10 seconds
  useEffect(() => {
    const interval = setInterval(refetch, 10000);
    return () => clearInterval(interval);
  }, [refetch]);

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-slate-400">Loading events...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-puffer-red/20 bg-puffer-red/5 p-6">
        <p className="text-puffer-red">Failed to load events: {error}</p>
      </div>
    );
  }

  const events = data?.events ?? [];
  const total = data?.total ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="text-lg font-semibold text-slate-200">
            Events ({total + liveEvents.length})
          </h3>
          {liveEvents.length > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-puffer-green/10 px-2.5 py-0.5 text-xs font-semibold text-puffer-green">
              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-puffer-green" />
              Live
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setOffset(Math.max(0, offset - limit))}
            disabled={offset === 0}
            className="rounded-md border border-slate-600 px-3 py-1 text-sm text-slate-300 hover:bg-slate-700 disabled:opacity-40"
          >
            Previous
          </button>
          <button
            onClick={() => setOffset(offset + limit)}
            disabled={offset + limit >= total}
            className="rounded-md border border-slate-600 px-3 py-1 text-sm text-slate-300 hover:bg-slate-700 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-700">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-700 bg-slate-800/80">
            <tr>
              <th className="px-4 py-3 font-medium text-slate-400">Time</th>
              <th className="px-4 py-3 font-medium text-slate-400">Agent</th>
              <th className="px-4 py-3 font-medium text-slate-400">Provider</th>
              <th className="px-4 py-3 font-medium text-slate-400">
                Action Type
              </th>
              <th className="px-4 py-3 font-medium text-slate-400">Decision</th>
              <th className="px-4 py-3 font-medium text-slate-400">Layers</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700/50">
            {liveEvents.map((event, idx) => (
              <tr
                key={`live-${event.id}`}
                className={`transition-colors hover:bg-slate-800/50 ${
                  idx < (liveEvents.length - prevLiveCountRef.current) && hasNewLive
                    ? 'animate-pulse bg-puffer-green/5'
                    : ''
                }`}
              >
                <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-slate-300">
                  {new Date(event.timestamp).toLocaleString()}
                </td>
                <td className="px-4 py-3 text-slate-200">{event.source.agent}</td>
                <td className="px-4 py-3 text-slate-300">{event.source.provider}</td>
                <td className="px-4 py-3 text-slate-300">
                  {event.action.type}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
                      decisionColors[event.decision] ?? 'text-slate-400'
                    }`}
                  >
                    {event.decision}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-400">
                  {event.layers?.map((l) => l.name).join(', ') ?? '-'}
                </td>
              </tr>
            ))}
            {events.map((event) => (
              <React.Fragment key={event.id}>
                <tr
                  onClick={() =>
                    setExpandedId(
                      expandedId === event.id ? null : event.id
                    )
                  }
                  className="cursor-pointer transition-colors hover:bg-slate-800/50"
                >
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-slate-300">
                    {new Date(event.timestamp).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-slate-200">{event.agent}</td>
                  <td className="px-4 py-3 text-slate-300">{event.provider}</td>
                  <td className="px-4 py-3 text-slate-300">
                    {event.actionType}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
                        decisionColors[event.decision] ?? 'text-slate-400'
                      }`}
                    >
                      {event.decision}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-400">
                    {event.layers?.join(', ') ?? '-'}
                  </td>
                </tr>
                {expandedId === event.id && (
                  <tr>
                    <td colSpan={6} className="bg-slate-800/30 px-4 py-4">
                      <pre className="overflow-x-auto rounded-md bg-slate-900 p-3 text-xs text-slate-300">
                        {JSON.stringify(event.details ?? event, null, 2)}
                      </pre>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
            {events.length === 0 && liveEvents.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-8 text-center text-slate-500"
                >
                  No events recorded yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default EventList;
