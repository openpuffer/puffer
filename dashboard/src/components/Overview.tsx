import React, { useMemo } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import type { LiveEvent } from '../App';

interface OverviewProps {
  totalEvents: number;
  blocked: number;
  allowed: number;
  activeAgents: number;
  liveEvents: LiveEvent[];
  eventsPerMinute: number;
  totalCost: number;
}

function buildChartData(liveEvents: LiveEvent[]) {
  const now = Date.now();
  const oneHourAgo = now - 60 * 60 * 1000;
  const bucketSize = 5 * 60 * 1000; // 5 minutes
  const bucketCount = 12;

  // Initialize empty buckets
  const buckets: { time: string; events: number; blocked: number }[] = [];
  for (let i = 0; i < bucketCount; i++) {
    const bucketStart = oneHourAgo + i * bucketSize;
    const d = new Date(bucketStart);
    const label = `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
    buckets.push({ time: label, events: 0, blocked: 0 });
  }

  // Fill buckets from live events
  for (const event of liveEvents) {
    const ts = new Date(event.timestamp).getTime();
    if (ts < oneHourAgo || ts > now) continue;
    const idx = Math.min(Math.floor((ts - oneHourAgo) / bucketSize), bucketCount - 1);
    buckets[idx].events++;
    if (event.decision === 'BLOCK') {
      buckets[idx].blocked++;
    }
  }

  return buckets;
}

const StatCard: React.FC<{
  label: string;
  value: number;
  color: string;
  borderColor: string;
}> = ({ label, value, color, borderColor }) => (
  <div
    className={`rounded-lg border bg-slate-800/50 p-6 ${borderColor}`}
  >
    <p className="text-sm font-medium text-slate-400">{label}</p>
    <p className={`mt-2 text-3xl font-bold ${color}`}>
      {value.toLocaleString()}
    </p>
  </div>
);

const Overview: React.FC<OverviewProps> = ({
  totalEvents,
  blocked,
  allowed,
  activeAgents,
  liveEvents,
  eventsPerMinute,
  totalCost,
}) => {
  const chartData = useMemo(() => buildChartData(liveEvents), [liveEvents]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard
          label="Total Events"
          value={totalEvents}
          color="text-puffer-blue"
          borderColor="border-puffer-blue/20"
        />
        <StatCard
          label="Blocked"
          value={blocked}
          color="text-puffer-red"
          borderColor="border-puffer-red/20"
        />
        <StatCard
          label="Allowed"
          value={allowed}
          color="text-puffer-green"
          borderColor="border-puffer-green/20"
        />
        <StatCard
          label="Active Agents"
          value={activeAgents}
          color="text-puffer-purple"
          borderColor="border-puffer-purple/20"
        />
        <StatCard
          label="Events/min"
          value={eventsPerMinute}
          color="text-cyan-400"
          borderColor="border-cyan-400/20"
        />
        <StatCard
          label="Est. Cost"
          value={totalCost}
          color="text-amber-400"
          borderColor="border-amber-400/20"
        />
      </div>

      <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-6">
        <h3 className="mb-4 text-lg font-semibold text-slate-200">
          Events Over Time
        </h3>
        <ResponsiveContainer width="100%" height={300}>
          <AreaChart data={chartData}>
            <defs>
              <linearGradient id="colorEvents" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#06b6d4" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="colorBlocked" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis dataKey="time" stroke="#94a3b8" fontSize={12} />
            <YAxis stroke="#94a3b8" fontSize={12} />
            <Tooltip
              contentStyle={{
                backgroundColor: '#1e293b',
                border: '1px solid #334155',
                borderRadius: '8px',
                color: '#e2e8f0',
              }}
            />
            <Area
              type="monotone"
              dataKey="events"
              stroke="#06b6d4"
              fill="url(#colorEvents)"
              strokeWidth={2}
            />
            <Area
              type="monotone"
              dataKey="blocked"
              stroke="#ef4444"
              fill="url(#colorBlocked)"
              strokeWidth={2}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default Overview;
