import React from 'react';
import EventList from '../components/EventList';
import { useDashboard } from '../context/DashboardContext';

const EventsPage: React.FC = () => {
  const { liveEvents } = useDashboard();
  return (
    <div className="h-full overflow-y-auto px-6 py-6">
      <header className="mb-4">
        <h1 className="font-mono text-lg font-bold uppercase tracking-widest text-slate-100">
          Events
        </h1>
        <p className="font-mono text-[11px] uppercase tracking-wider text-slate-500">
          Persistent audit log · live tail via WebSocket
        </p>
      </header>
      <EventList liveEvents={liveEvents} />
    </div>
  );
};

export default EventsPage;
