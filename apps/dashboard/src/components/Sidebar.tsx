import React, { useState, useCallback } from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  ListTree,
  Users,
  Settings,
  FlaskConical,
  Lightbulb,
  ChevronLeft,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
  ShieldCheck,
  BookOpen,
} from 'lucide-react';

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  end?: boolean;
}

const NAV: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/events', label: 'Events', icon: ListTree },
  { to: '/agents', label: 'Agents', icon: Users },
  { to: '/skills', label: 'Skills', icon: BookOpen },
  { to: '/config', label: 'Configuration', icon: Settings },
  { to: '/tests', label: 'Tests', icon: FlaskConical },
  { to: '/recommendations', label: 'Recommendations', icon: Lightbulb },
];

const SIDEBAR_COLLAPSED_KEY = 'puffer-sidebar-collapsed';

const Sidebar: React.FC = () => {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1';
  });

  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? '1' : '0');
      } catch {
        /* localStorage may be unavailable in private browsing */
      }
      return next;
    });
  }, []);

  const width = collapsed ? 'w-[64px]' : 'w-[220px]';

  return (
    <aside
      className={[
        'relative flex h-screen flex-col border-r border-white/[0.05]',
        'bg-[rgba(8,11,18,0.85)] backdrop-blur-md',
        'transition-[width] duration-200 ease-out',
        width,
      ].join(' ')}
    >
      {/* Brand + header toggle */}
      <div
        className={[
          'flex h-14 items-center border-b border-white/[0.05]',
          collapsed ? 'justify-center px-2' : 'gap-2 px-3',
        ].join(' ')}
      >
        {!collapsed ? (
          <>
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-amber-500/15 text-amber-300">
              <ShieldCheck className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate font-mono text-[12px] font-bold tracking-widest text-amber-200">
                PUFFER
              </div>
              <div className="truncate font-mono text-[8px] uppercase tracking-wider text-slate-500">
                Sentinel
              </div>
            </div>
            <button
              type="button"
              onClick={toggle}
              title="Collapse sidebar"
              aria-label="Collapse sidebar"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-white/[0.06] hover:text-slate-100"
            >
              <PanelLeftClose className="h-4 w-4" />
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={toggle}
            title="Expand sidebar"
            aria-label="Expand sidebar"
            className="flex h-9 w-9 items-center justify-center rounded-md bg-amber-500/15 text-amber-300 transition-colors hover:bg-amber-500/25"
          >
            <PanelLeftOpen className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Floating handle on the right border — always visible, always clickable */}
      <button
        type="button"
        onClick={toggle}
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        className={[
          'absolute -right-3 top-[52px] z-10 flex h-6 w-6 items-center justify-center rounded-full',
          'border border-white/[0.08] bg-[rgba(8,11,18,0.95)] text-slate-400 shadow-md',
          'transition-all duration-150 hover:scale-110 hover:border-amber-400/50 hover:text-amber-200',
        ].join(' ')}
      >
        {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronLeft className="h-3.5 w-3.5" />}
      </button>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-2 py-3">
        <ul className="flex flex-col gap-1">
          {NAV.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.end}
                title={collapsed ? item.label : undefined}
                className={({ isActive }) =>
                  [
                    'group flex items-center gap-3 rounded-md px-2.5 py-2 transition-colors',
                    'font-mono text-[11px] font-semibold uppercase tracking-wider',
                    isActive
                      ? 'bg-amber-500/10 text-amber-200 ring-1 ring-amber-400/30'
                      : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-100',
                    collapsed ? 'justify-center' : '',
                  ].join(' ')
                }
              >
                <item.icon className="h-4 w-4 shrink-0" />
                {!collapsed && <span className="truncate">{item.label}</span>}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

    </aside>
  );
};

export default Sidebar;
