import React from 'react';
import { useApi } from '../hooks/useApi';

interface Alert {
  id: string;
  timestamp: string;
  agent: string;
  layer: string;
  reason: string;
  type: 'block' | 'escalation';
}

interface AlertsResponse {
  alerts: Alert[];
}

const AlertList: React.FC = () => {
  const { data, loading, error } = useApi<AlertsResponse>('/api/alerts');

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-slate-400">Loading alerts...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-puffer-red/20 bg-puffer-red/5 p-6">
        <p className="text-puffer-red">Failed to load alerts: {error}</p>
      </div>
    );
  }

  const alerts = data?.alerts ?? [];

  if (alerts.length === 0) {
    return (
      <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-8 text-center">
        <p className="text-slate-400">No alerts yet. All clear.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-slate-200">
        Recent Alerts ({alerts.length})
      </h3>
      <div className="space-y-3">
        {alerts.map((alert) => {
          const isBlock = alert.type === 'block';
          const accentBorder = isBlock
            ? 'border-l-puffer-red'
            : 'border-l-puffer-purple';
          const accentText = isBlock ? 'text-puffer-red' : 'text-puffer-purple';
          const typeBadgeBg = isBlock
            ? 'bg-puffer-red/20 text-puffer-red'
            : 'bg-puffer-purple/20 text-puffer-purple';

          return (
            <div
              key={alert.id}
              className={`rounded-lg border border-slate-700 border-l-4 ${accentBorder} bg-slate-800/50 p-4`}
            >
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${typeBadgeBg}`}
                  >
                    {isBlock ? 'BLOCKED' : 'ESCALATED'}
                  </span>
                  <span className="font-medium text-slate-200">
                    {alert.agent}
                  </span>
                </div>
                <time className="font-mono text-xs text-slate-500">
                  {new Date(alert.timestamp).toLocaleString()}
                </time>
              </div>
              <p className="text-sm text-slate-300">{alert.reason}</p>
              <p className="mt-1 text-xs text-slate-500">
                Layer:{' '}
                <span className={`font-medium ${accentText}`}>
                  {alert.layer}
                </span>
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default AlertList;
