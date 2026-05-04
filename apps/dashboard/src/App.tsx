import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import { DashboardProvider, useDashboard } from './context/DashboardContext';
import DashboardPage from './pages/DashboardPage';
import EventsPage from './pages/EventsPage';
import AgentsPage from './pages/AgentsPage';
import ConfigPage from './pages/ConfigPage';
import TestsPage from './pages/TestsPage';
import RecommendationsPage from './pages/RecommendationsPage';
import SkillsPage from './pages/SkillsPage';
import SkillToastContainer, { useSkillToasts, type SkillToastVariant } from './components/SkillToast';

// Re-export legacy types so existing components that still
// `import { LiveEvent, AgentInfo } from '../App'` keep compiling.
export type { LiveEvent, AgentInfo } from './context/DashboardContext';

/**
 * Inner shell — needs access to DashboardContext for skill event toasts.
 */
const Shell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { liveEvents } = useDashboard();
  const [toasts, addToast, dismissToast] = useSkillToasts();

  // Watch liveEvents for skill inventory change events and emit toasts.
  useEffect(() => {
    if (liveEvents.length === 0) return;
    const latest = liveEvents[0];
    if (!latest) return;

    const actionType = latest.action.type as string;
    if (
      actionType !== 'skill_added' &&
      actionType !== 'skill_modified' &&
      actionType !== 'skill_removed'
    ) {
      return;
    }

    const action = latest.action as unknown as {
      type: SkillToastVariant;
      skill?: { name?: string; source?: string };
    };
    const skillName = action.skill?.name ?? 'unknown';
    const source = action.skill?.source;

    addToast(actionType as SkillToastVariant, skillName, source);
    // We only want to react to the very latest event, not replay old ones.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveEvents[0]?.id]);

  return (
    <div className="grid-surface-bg relative flex h-screen w-screen overflow-hidden bg-slate-50 dark:bg-[#06080d]">
      <Sidebar />
      <main className="relative flex-1 overflow-hidden">{children}</main>
      <SkillToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
};

const App: React.FC = () => {
  return (
    <BrowserRouter>
      <DashboardProvider>
        <Shell>
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/events" element={<EventsPage />} />
            <Route path="/agents" element={<AgentsPage />} />
            <Route path="/skills" element={<SkillsPage />} />
            <Route path="/config" element={<ConfigPage />} />
            <Route path="/tests" element={<TestsPage />} />
            <Route path="/recommendations" element={<RecommendationsPage />} />
            <Route path="*" element={<DashboardPage />} />
          </Routes>
        </Shell>
      </DashboardProvider>
    </BrowserRouter>
  );
};

export default App;
