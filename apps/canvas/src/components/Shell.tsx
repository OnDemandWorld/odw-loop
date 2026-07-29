import React, { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { clsx } from 'clsx';
import { api } from '../lib/api';
import { Icon } from './ui';

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
        {/* Brand */}
        <div className="px-5 pt-6 pb-5 border-b border-ink-700/60">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-volt to-sky-600 flex items-center justify-center shadow-glow">
              <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none">
                <path
                  d="M7 5v10a4 4 0 004 4h6"
                  stroke="#071018"
                  strokeWidth="2.6"
                  strokeLinecap="round"
                />
                <circle cx="7" cy="5" r="2.2" fill="#071018" />
                <circle cx="17" cy="19" r="2.2" fill="#071018" />
              </svg>
            </div>
            <div>
              <div className="font-display font-bold text-lg leading-none tracking-tight text-ink-100">
                Loop
              </div>
              <div className="text-[10px] font-mono uppercase tracking-widest text-ink-400 mt-1">
                Orchestration
              </div>
            </div>
          </div>
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
                status === 'online' && 'bg-emerald-400 animate-pulse-dot',
                status === 'offline' && 'bg-rose-400',
                status === 'checking' && 'bg-amber-400 animate-pulse-dot',
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
