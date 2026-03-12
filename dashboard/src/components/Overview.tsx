import React from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

interface OverviewProps {
  totalEvents: number;
  blocked: number;
  allowed: number;
  activeAgents: number;
}

const mockChartData = [
  { time: '00:00', events: 12, blocked: 2, allowed: 10 },
  { time: '04:00', events: 8, blocked: 1, allowed: 7 },
  { time: '08:00', events: 34, blocked: 5, allowed: 29 },
  { time: '12:00', events: 52, blocked: 8, allowed: 44 },
  { time: '16:00', events: 41, blocked: 6, allowed: 35 },
  { time: '20:00', events: 27, blocked: 3, allowed: 24 },
  { time: '24:00', events: 18, blocked: 2, allowed: 16 },
];

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
}) => {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
      </div>

      <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-6">
        <h3 className="mb-4 text-lg font-semibold text-slate-200">
          Events Over Time
        </h3>
        <ResponsiveContainer width="100%" height={300}>
          <AreaChart data={mockChartData}>
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
