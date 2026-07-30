import type { Config } from 'tailwindcss';

/**
 * ODW.ai brand theme — tokens are CSS variables (RGB triplets) defined in
 * src/index.css, with a light (:root) and dark (.dark) value set.
 * Palette reference: https://odw.ai/ (--ink #14110F, --paper #F6F2EC,
 * --accent #FF5A1F) + logo brand red #CD2028.
 */
function v(name: string): string {
  return `rgb(var(--${name}) / <alpha-value>)`;
}

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        display: ['Inter', 'system-ui', 'sans-serif'],
        body: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      colors: {
        // Surface → text scale. In dark mode 950 is the deepest surface and
        // 100 the strongest text; light mode inverts to paper/white surfaces.
        ink: {
          950: v('ink-950'),
          900: v('ink-900'),
          850: v('ink-850'),
          800: v('ink-800'),
          750: v('ink-750'),
          700: v('ink-700'),
          600: v('ink-600'),
          500: v('ink-500'),
          400: v('ink-400'),
          300: v('ink-300'),
          200: v('ink-200'),
          100: v('ink-100'),
        },
        // ODW accent orange (was cyan "volt"; name kept to avoid churn)
        volt: {
          DEFAULT: v('accent'),
          dim: v('accent-dim'),
          glow: 'rgb(var(--accent) / 0.12)',
        },
        brand: v('brand'),
        // Semantic status colors (theme-aware)
        good: v('good'),
        bad: v('bad'),
        warn: v('warn'),
        paused: v('paused'),
        agent: {
          vault: '#3b82f6',
          desk: '#10b981',
          recap: '#8b5cf6',
          control: '#f59e0b',
          code: '#ec4899',
        },
      },
      boxShadow: {
        panel: 'var(--shadow-panel)',
        glow: '0 0 0 1px rgb(var(--accent) / 0.25), 0 0 24px -4px rgb(var(--accent) / 0.35)',
      },
      keyframes: {
        'pulse-dot': {
          '0%, 100%': { opacity: '1', transform: 'scale(1)' },
          '50%': { opacity: '0.45', transform: 'scale(0.8)' },
        },
        'slide-up': {
          from: { opacity: '0', transform: 'translateY(10px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        shimmer: {
          from: { backgroundPosition: '200% 0' },
          to: { backgroundPosition: '-200% 0' },
        },
        'dash-flow': {
          to: { strokeDashoffset: '-20' },
        },
      },
      animation: {
        'pulse-dot': 'pulse-dot 1.6s ease-in-out infinite',
        'slide-up': 'slide-up 0.35s cubic-bezier(0.22, 1, 0.36, 1) both',
        'fade-in': 'fade-in 0.3s ease both',
        shimmer: 'shimmer 2.4s linear infinite',
        'dash-flow': 'dash-flow 1s linear infinite',
      },
    },
  },
  plugins: [],
} satisfies Config;
