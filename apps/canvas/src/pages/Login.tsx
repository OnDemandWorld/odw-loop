/**
 * Login page (audit #1) — obtains a JWT from POST /api/v1/auth/login and
 * stores it under 'loop.token' (the same key the WS client reads). Only
 * needed when the API runs with LOOP_REQUIRE_AUTH=true; with auth disabled
 * the rest of the SPA works without ever visiting this page.
 */

import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';

export function Login() {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.login(username, password);
      localStorage.setItem('loop.token', res.token);
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-ink-950 px-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-xl border border-ink-700/60 bg-ink-900 p-6 space-y-4">
        <div>
          <h1 className="font-display text-lg font-semibold text-ink-100">Sign in to ODW Loop</h1>
          <p className="text-xs text-ink-500 mt-1">This instance requires authentication.</p>
        </div>
        <label className="block text-xs text-ink-400">
          Username
          <input
            className="input mt-1 w-full"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoFocus
            required
          />
        </label>
        <label className="block text-xs text-ink-400">
          Password
          <input
            className="input mt-1 w-full"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        {error && <div className="text-xs text-bad">{error}</div>}
        <button className="btn-primary w-full justify-center" type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
