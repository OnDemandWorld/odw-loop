/**
 * App-level error boundary (audit #99): a render-time exception (e.g. a
 * malformed server payload) must show a recoverable error card, not unmount
 * the whole SPA to a blank page.
 */

import React from 'react';

interface Props {
  children: React.ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error('Unhandled render error', error, info.componentStack);
  }

  override render(): React.ReactNode {
    if (this.state.error) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-ink-950 px-4">
          <div className="panel max-w-md p-6 text-center space-y-3">
            <h1 className="font-display text-lg font-semibold text-ink-100">Something went wrong</h1>
            <p className="text-sm text-ink-400 break-words">{this.state.error.message}</p>
            <button className="btn-primary justify-center" onClick={() => window.location.reload()}>
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
