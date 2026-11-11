/**
 * V1.6 M1 (F-1, DB2): global vitest setup — DB lifecycle safety net.
 *
 * Wired via `setupFiles` in all three vitest configs (unit / integration /
 * e2e). After every test, any SQLite connection still tracked by the
 * `tests/helpers/testStore.ts` helpers is closed best-effort, so a test that
 * leaks a store can no longer leave a native better-sqlite3 handle open for
 * GC to tear down (the root cause of the rare teardown SIGSEGV). Combined
 * with the process-exit hook in `packages/state/src/sqlite/connection.ts`
 * (DB3), every handle is released either explicitly, by this net, or at
 * process exit.
 */

import { afterEach } from 'vitest';
import { WebSocket as UndiciWebSocket } from 'undici';

import { closeTrackedConnections } from './helpers/testStore.js';

// Node exposes a global WebSocket only from v22 (unflagged) onward; CI and the
// Docker images run Node 20, so back it with undici's spec-compliant client.
if (typeof globalThis.WebSocket === 'undefined') {
  (globalThis as Record<string, unknown>).WebSocket = UndiciWebSocket;
}

afterEach(() => {
  closeTrackedConnections();
});
