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
import {
  Activity,
  ShieldOff,
  ShieldCheck,
  Users,
  Gauge,
  DollarSign,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
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

const statCards = [
  {
    key: 'totalEvents',
    label: 'Total Events',
    icon: Activity,
    color: 'text-puffer-blue',
    iconBg: 'bg-puffer-blue/10',
    borderColor: 'border-puffer-blue/20',
  },
  {
    key: 'blocked',
    label: 'Blocked',
    icon: ShieldOff,
    color: 'text-puffer-red',
    iconBg: 'bg-puffer-red/10',
    borderColor: 'border-puffer-red/20',
  },
  {
    key: 'allowed',
    label: 'Allowed',
    icon: ShieldCheck,
    color: 'text-puffer-green',
    iconBg: 'bg-puffer-green/10',
    borderColor: 'border-puffer-green/20',
  },
  {
    key: 'activeAgents',
    label: 'Active Agents',
    icon: Users,
    color: 'text-puffer-purple',
    iconBg: 'bg-puffer-purple/10',
    borderColor: 'border-puffer-purple/20',
  },
  {
    key: 'eventsPerMinute',
    label: 'Events/min',
    icon: Gauge,
    color: 'text-cyan-400',
    iconBg: 'bg-cyan-400/10',
    borderColor: 'border-cyan-400/20',
  },
  {
    key: 'totalCost',
    label: 'Est. Cost',
    icon: DollarSign,
    color: 'text-amber-400',
    iconBg: 'bg-amber-400/10',
    borderColor: 'border-amber-400/20',
  },
] as const;

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

  const values: Record<string, number> = {
    totalEvents,
    blocked,
    allowed,
    activeAgents,
    eventsPerMinute,
    totalCost,
  };

  return (
    <div className="space-y-6">
      {/* Stat Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {statCards.map((stat) => {
          const Icon = stat.icon;
          return (
            <Card key={stat.key} className={`${stat.borderColor} bg-card`}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {stat.label}
                </CardTitle>
                <div className={`rounded-md p-1.5 ${stat.iconBg}`}>
                  <Icon className={`h-4 w-4 ${stat.color}`} />
                </div>
              </CardHeader>
              <CardContent>
                <p className={`text-3xl font-bold ${stat.color}`}>
                  {values[stat.key].toLocaleString()}
                </p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Chart */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg text-card-foreground">
            Events Over Time
          </CardTitle>
        </CardHeader>
        <CardContent>
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
                  backgroundColor: 'hsl(222.2 84% 6.9%)',
                  border: '1px solid hsl(217.2 32.6% 17.5%)',
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
        </CardContent>
      </Card>
    </div>
  );
};

export default Overview;
