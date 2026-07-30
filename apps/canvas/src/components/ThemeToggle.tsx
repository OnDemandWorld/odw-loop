import React from 'react';
import { clsx } from 'clsx';
import { toggleTheme, useTheme } from '../lib/theme';

/** Sun / moon switch for dark ⇄ light mode. */
export function ThemeToggle({ className }: { className?: string }) {
  const theme = useTheme();
  const dark = theme === 'dark';

  return (
    <button
      type="button"
      onClick={toggleTheme}
      title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      className={clsx(
        'inline-flex items-center justify-center w-8 h-8 rounded-md text-ink-400',
        'border border-ink-700 bg-ink-800/60 transition-all duration-150',
        'hover:text-ink-100 hover:border-ink-600 hover:bg-ink-750 active:scale-[0.95]',
        className,
      )}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="w-[16px] h-[16px]"
      >
        {dark ? (
          // sun
          <>
            <circle cx="12" cy="12" r="4.5" />
            <path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8" />
          </>
        ) : (
          // moon
          <path d="M20.5 14.5A8.5 8.5 0 019.5 3.5a8.5 8.5 0 1011 11z" />
        )}
      </svg>
    </button>
  );
}
