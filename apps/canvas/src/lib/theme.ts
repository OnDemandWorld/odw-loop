/**
 * Theme (dark / light) state — persisted to localStorage, applied as a
 * `dark` class on <html> (Tailwind darkMode: 'class').
 * index.html applies the initial class before React mounts to avoid FOUC.
 */
import { useSyncExternalStore } from 'react';

export type Theme = 'dark' | 'light';

const STORAGE_KEY = 'loop-theme';
const listeners = new Set<() => void>();

function readInitial(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'dark' || stored === 'light') return stored;
  } catch {
    /* storage unavailable */
  }
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

let current: Theme = readInitial();

function apply(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
}

// Sync in case the pre-mount script and store disagree
apply(current);

export function getTheme(): Theme {
  return current;
}

export function setTheme(theme: Theme) {
  current = theme;
  apply(theme);
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* storage unavailable */
  }
  listeners.forEach((fn) => fn());
}

export function toggleTheme() {
  setTheme(current === 'dark' ? 'light' : 'dark');
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Reactive access to the current theme. */
export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, getTheme);
}
