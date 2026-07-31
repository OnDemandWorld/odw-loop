import React from 'react';
import { clsx } from 'clsx';
import { STATUS_META } from '../lib/api';

export function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status] ?? { color: 'text-ink-300', bg: 'bg-ink-500', label: status };
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold font-display',
        'bg-ink-900/80 border border-ink-700',
        meta.color,
      )}
    >
      <span
        className={clsx('w-1.5 h-1.5 rounded-full', meta.bg, status === 'running' && 'animate-pulse-dot')}
      />
      {meta.label}
    </span>
  );
}

export function Card({
  children,
  className,
  hover,
}: {
  children: React.ReactNode;
  className?: string;
  hover?: boolean;
}) {
  return <div className={clsx('panel', hover && 'panel-hover', className)}>{children}</div>;
}

export function SectionTitle({
  children,
  action,
}: {
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between mb-3">
      <h2 className="font-display font-semibold text-sm uppercase tracking-widest text-ink-400">
        {children}
      </h2>
      {action}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  hint,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center animate-fade-in">
      <div className="w-14 h-14 rounded-xl bg-ink-800 border border-ink-700 flex items-center justify-center text-2xl mb-4 text-ink-400">
        {icon}
      </div>
      <p className="font-display font-semibold text-ink-200">{title}</p>
      {hint && <p className="text-sm text-ink-400 mt-1 max-w-sm">{hint}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={clsx(
        'inline-block w-4 h-4 rounded-full border-2 border-ink-600 border-t-volt animate-spin',
        className,
      )}
    />
  );
}

export function LoadingBlock({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-20 text-ink-400 text-sm animate-fade-in">
      <Spinner />
      {label}
    </div>
  );
}

export function ErrorBlock({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 animate-fade-in">
      <div className="text-bad text-sm bg-bad/10 border border-bad/30 rounded-md px-4 py-2.5 max-w-md text-center">
        {message}
      </div>
      {onRetry && (
        <button className="btn-ghost" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}

/** Small inline SVG icon set (stroke-based, inherits currentColor). */
export function Icon({ name, className }: { name: string; className?: string }) {
  const paths: Record<string, React.ReactNode> = {
    dashboard: (
      <>
        <rect x="3" y="3" width="7" height="9" rx="1.5" />
        <rect x="14" y="3" width="7" height="5" rx="1.5" />
        <rect x="14" y="12" width="7" height="9" rx="1.5" />
        <rect x="3" y="16" width="7" height="5" rx="1.5" />
      </>
    ),
    workflow: (
      <>
        <rect x="2" y="4" width="6" height="6" rx="1.5" />
        <rect x="16" y="14" width="6" height="6" rx="1.5" />
        <path d="M8 7h4a3 3 0 013 3v4" />
      </>
    ),
    bolt: <path d="M13 2L4.5 13.5H11L9.5 22 19 10h-6.5L13 2z" />,
    play: <path d="M7 4.5v15l12-7.5L7 4.5z" />,
    plus: <path d="M12 5v14M5 12h14" />,
    search: (
      <>
        <circle cx="11" cy="11" r="7" />
        <path d="M20 20l-3.5-3.5" />
      </>
    ),
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3.5 2" />
      </>
    ),
    check: <path d="M4.5 12.5l5 5L19.5 7" />,
    x: <path d="M6 6l12 12M18 6L6 18" />,
    arrowLeft: <path d="M19 12H5m6-7l-7 7 7 7" />,
    refresh: (
      <>
        <path d="M20 11a8 8 0 10-1.2 5.5" />
        <path d="M20 5v6h-6" />
      </>
    ),
    trash: (
      <>
        <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
        <path d="M10 11v6M14 11v6" />
      </>
    ),
    edit: (
      <>
        <path d="M4 20h4L20 8l-4-4L4 16v4z" />
        <path d="M13.5 6.5l4 4" />
      </>
    ),
    database: (
      <>
        <ellipse cx="12" cy="5.5" rx="8" ry="2.8" />
        <path d="M4 5.5v13c0 1.5 3.6 2.8 8 2.8s8-1.3 8-2.8v-13" />
        <path d="M4 12c0 1.5 3.6 2.8 8 2.8s8-1.3 8-2.8" />
      </>
    ),
    globe: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3c2.5 2.6 3.8 5.7 3.8 9S14.5 18.4 12 21c-2.5-2.6-3.8-5.7-3.8-9S9.5 5.6 12 3z" />
      </>
    ),
    shield: <path d="M12 3l8 3.5v5c0 5-3.4 8.6-8 9.5-4.6-.9-8-4.5-8-9.5v-5L12 3z" />,
    cpu: (
      <>
        <rect x="6" y="6" width="12" height="12" rx="2" />
        <rect x="10" y="10" width="4" height="4" />
        <path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" />
      </>
    ),
  };
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className ?? 'w-4 h-4'}
    >
      {paths[name] ?? null}
    </svg>
  );
}
