import React, { useState, useEffect, useRef } from 'react';
import { useApi } from '../hooks/useApi';
import type { LiveEvent } from '../App';
import { cn } from '@/lib/utils';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';

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

const decisionVariant: Record<string, 'default' | 'destructive' | 'secondary' | 'outline'> = {
  ALLOW: 'default',
  BLOCK: 'destructive',
  AUDIT: 'secondary',
  ESCALATE: 'outline',
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
        <div className="text-muted-foreground">Loading events...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-6">
        <p className="text-destructive">Failed to load events: {error}</p>
      </div>
    );
  }

  const events = data?.events ?? [];
  const total = data?.total ?? 0;

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 space-y-0 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <CardTitle className="text-base">
            Events ({total + liveEvents.length})
          </CardTitle>
          {liveEvents.length > 0 && (
            <Badge variant="outline" className="gap-1.5 border-puffer-green/30 bg-puffer-green/10 text-puffer-green">
              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-puffer-green" />
              Live
            </Badge>
          )}
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setOffset(Math.max(0, offset - limit))}
            disabled={offset === 0}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setOffset(offset + limit)}
            disabled={offset + limit >= total}
          >
            Next
          </Button>
        </div>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <Table className="w-full">
          <TableHeader>
            <TableRow>
              <TableHead>Time</TableHead>
              <TableHead>Agent</TableHead>
              <TableHead>Provider</TableHead>
              <TableHead>Action Type</TableHead>
              <TableHead>Decision</TableHead>
              <TableHead>Layers</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {liveEvents.map((event, idx) => (
              <TableRow
                key={`live-${event.id}`}
                className={cn(
                  idx < (liveEvents.length - prevLiveCountRef.current) && hasNewLive
                    && 'animate-pulse bg-puffer-green/5'
                )}
              >
                <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                  {new Date(event.timestamp).toLocaleString()}
                </TableCell>
                <TableCell>{event.source.agent}</TableCell>
                <TableCell className="text-muted-foreground">{event.source.provider}</TableCell>
                <TableCell className="text-muted-foreground">
                  {event.action.type}
                </TableCell>
                <TableCell>
                  <Badge variant={decisionVariant[event.decision] ?? 'outline'}>
                    {event.decision}
                  </Badge>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {event.layers?.map((l) => l.name).join(', ') ?? '-'}
                </TableCell>
              </TableRow>
            ))}
            {events.map((event) => (
              <React.Fragment key={event.id}>
                <TableRow
                  onClick={() =>
                    setExpandedId(
                      expandedId === event.id ? null : event.id
                    )
                  }
                  className="cursor-pointer"
                >
                  <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                    {new Date(event.timestamp).toLocaleString()}
                  </TableCell>
                  <TableCell>{event.agent}</TableCell>
                  <TableCell className="text-muted-foreground">{event.provider}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {event.actionType}
                  </TableCell>
                  <TableCell>
                    <Badge variant={decisionVariant[event.decision] ?? 'outline'}>
                      {event.decision}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {event.layers?.join(', ') ?? '-'}
                  </TableCell>
                </TableRow>
                {expandedId === event.id && (
                  <TableRow>
                    <TableCell colSpan={6} className="bg-muted/30">
                      <pre className="overflow-x-auto rounded-md bg-background p-3 text-xs text-muted-foreground">
                        {JSON.stringify(event.details ?? event, null, 2)}
                      </pre>
                    </TableCell>
                  </TableRow>
                )}
              </React.Fragment>
            ))}
            {events.length === 0 && liveEvents.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="py-8 text-center text-muted-foreground"
                >
                  No events recorded yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
};

export default EventList;
