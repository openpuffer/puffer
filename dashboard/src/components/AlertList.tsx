import React, { useEffect, useMemo } from 'react';
import { useApi } from '../hooks/useApi';
import type { LiveEvent } from '../App';
import { cn } from '@/lib/utils';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ShieldAlert, AlertTriangle } from 'lucide-react';

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

interface AlertListProps {
  liveEvents: LiveEvent[];
}

const AlertList: React.FC<AlertListProps> = ({ liveEvents }) => {
  const { data, loading, error, refetch } = useApi<AlertsResponse>('/api/alerts');

  // Auto-refresh API every 10 seconds
  useEffect(() => {
    const interval = setInterval(refetch, 10000);
    return () => clearInterval(interval);
  }, [refetch]);

  // Derive live alerts from live events (BLOCK and ESCALATE only)
  const liveAlerts = useMemo(
    () =>
      liveEvents
        .filter((e) => e.decision === 'BLOCK' || e.decision === 'ESCALATE')
        .map((e) => ({
          id: `live-${e.id}`,
          timestamp: e.timestamp,
          agent: e.source.agent,
          layer: e.layers.map((l) => l.name).join(', ') || 'Unknown',
          reason: `${e.decision} on ${e.action.type} via ${e.source.provider}`,
          type: (e.decision === 'BLOCK' ? 'block' : 'escalation') as 'block' | 'escalation',
        })),
    [liveEvents]
  );

  if (loading && !data && liveAlerts.length === 0) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-muted-foreground">Loading alerts...</div>
      </div>
    );
  }

  if (error && liveAlerts.length === 0) {
    return (
      <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-6">
        <p className="text-destructive">Failed to load alerts: {error}</p>
      </div>
    );
  }

  const apiAlerts = data?.alerts ?? [];
  const alerts = [...liveAlerts, ...apiAlerts];

  if (alerts.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <p className="text-muted-foreground">No alerts yet. All clear.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">
          Recent Alerts ({alerts.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-0">
        {alerts.map((alert, idx) => {
          const isBlock = alert.type === 'block';

          return (
            <React.Fragment key={alert.id}>
              {idx > 0 && <Separator className="my-3" />}
              <div
                className={cn(
                  'flex items-start gap-3 rounded-lg border-l-4 p-3',
                  isBlock
                    ? 'border-l-destructive'
                    : 'border-l-puffer-purple'
                )}
              >
                <div className="mt-0.5">
                  {isBlock ? (
                    <ShieldAlert className="h-5 w-5 text-destructive" />
                  ) : (
                    <AlertTriangle className="h-5 w-5 text-puffer-purple" />
                  )}
                </div>
                <div className="flex-1 space-y-1">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Badge variant={isBlock ? 'destructive' : 'secondary'}>
                        {isBlock ? 'BLOCKED' : 'ESCALATED'}
                      </Badge>
                      <span className="font-medium">
                        {alert.agent}
                      </span>
                    </div>
                    <time className="font-mono text-xs text-muted-foreground">
                      {new Date(alert.timestamp).toLocaleString()}
                    </time>
                  </div>
                  <p className="text-sm text-muted-foreground">{alert.reason}</p>
                  <p className="text-xs text-muted-foreground">
                    Layer:{' '}
                    <span
                      className={cn(
                        'font-medium',
                        isBlock ? 'text-destructive' : 'text-puffer-purple'
                      )}
                    >
                      {alert.layer}
                    </span>
                  </p>
                </div>
              </div>
            </React.Fragment>
          );
        })}
      </CardContent>
    </Card>
  );
};

export default AlertList;
