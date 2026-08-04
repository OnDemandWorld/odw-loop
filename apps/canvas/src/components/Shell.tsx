import React, { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { clsx } from 'clsx';
import { api } from '../lib/api';
import { Icon } from './ui';
import { ThemeToggle } from './ThemeToggle';

const NAV = [
  { to: '/', label: 'Dashboard', icon: 'dashboard', end: true },
  { to: '/workflows', label: 'Workflows', icon: 'workflow', end: false },
  { to: '/executions', label: 'Executions', icon: 'bolt', end: false },
];

function useApiStatus() {
  const [status, setStatus] = useState<'checking' | 'online' | 'offline'>('checking');
  useEffect(() => {
    let alive = true;
    const check = () =>
      api
        .health()
        .then(() => alive && setStatus('online'))
        .catch(() => alive && setStatus('offline'));
    check();
    const timer = setInterval(check, 10_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  return status;
}

export function Shell() {
  const status = useApiStatus();
  const location = useLocation();

  return (
    <div className="app-bg min-h-screen flex">
      {/* ambient grid layer */}
      <div className="grid-overlay fixed inset-0 pointer-events-none" />

      {/* ── Sidebar ─────────────────────────────────────────────────────── */}
      <aside className="relative z-10 w-60 shrink-0 border-r border-ink-700/60 bg-ink-900/70 backdrop-blur-md flex flex-col">
        {/* Brand — ODW.ai logo (light/dark variants), links to official site */}
        <div className="px-5 pt-6 pb-5 border-b border-ink-700/60">
          <a href="https://odw.ai/" target="_blank" rel="noopener">
            <img
              src="/brand/odwai-logo.png"
              alt="ODW.ai"
              className="h-10 w-auto dark:hidden"
            />
            <img
              src="/brand/odwai-logo-dark.png"
              alt="ODW.ai"
              className="h-10 w-auto hidden dark:block"
            />
          </a>
          <div className="flex items-center justify-between mt-3">
            <div>
              <span className="font-display font-bold text-base leading-none tracking-tight text-ink-100">
                Loop
              </span>
              <span className="ml-2 text-[10px] font-mono uppercase tracking-widest text-ink-400">
                Orchestration
              </span>
            </div>
            <ThemeToggle />
          </div>
          <a
            href="https://odw.ai/"
            target="_blank"
            rel="noopener"
            className="inline-block mt-2.5 font-mono text-[9px] uppercase tracking-[0.12em] text-ink-500 hover:text-volt transition-colors"
          >
            odw.ai &nearr;
          </a>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-1">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                clsx('nav-link', isActive && 'nav-link-active')
              }
            >
              <Icon name={item.icon} className="w-[18px] h-[18px]" />
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* Agent legend */}
        <div className="px-5 py-4 border-t border-ink-700/60">
          <div className="text-[10px] font-display font-semibold uppercase tracking-widest text-ink-500 mb-2.5">
            Sovereign Agents
          </div>
          <div className="space-y-1.5">
            {[
              { name: 'Vault', desc: 'Knowledge', color: 'bg-agent-vault' },
              { name: 'Desk', desc: 'Tasks', color: 'bg-agent-desk' },
              { name: 'Recap', desc: 'Meetings', color: 'bg-agent-recap' },
            ].map((a) => (
              <div key={a.name} className="flex items-center gap-2 text-xs">
                <span className={clsx('w-2 h-2 rounded-full', a.color)} />
                <span className="text-ink-300 font-medium">{a.name}</span>
                <span className="text-ink-500 ml-auto font-mono text-[10px]">{a.desc}</span>
              </div>
            ))}
          </div>
        </div>

        {/* API status */}
        <div className="px-5 py-4 border-t border-ink-700/60">
          <div className="flex items-center gap-2.5">
            <span
              className={clsx(
                'w-2 h-2 rounded-full',
                status === 'online' && 'bg-good animate-pulse-dot',
                status === 'offline' && 'bg-bad',
                status === 'checking' && 'bg-warn animate-pulse-dot',
              )}
            />
            <span className="text-xs text-ink-300">
              {status === 'online' ? 'API connected' : status === 'offline' ? 'API unreachable' : 'Connecting…'}
            </span>
            <span className="ml-auto font-mono text-[10px] text-ink-500">:3000</span>
          </div>
        </div>
      </aside>

      {/* ── Main ────────────────────────────────────────────────────────── */}
      <main className="relative z-10 flex-1 min-w-0 flex flex-col">
        <div key={location.pathname} className="flex-1 animate-slide-up">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
