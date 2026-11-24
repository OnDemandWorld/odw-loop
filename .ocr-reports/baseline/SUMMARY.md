# Baseline verification — fix/ocr-full-audit-round-1 (before any fixes)

Run at main@27b79fd + reports commit 7c6f1dd, 2026-11-24, Node v26.8.1, pnpm 9.4.0.

| Check | Command | Exit | Result |
|---|---|---|---|
| Type check | `pnpm typecheck` | 0 | clean |
| Lint | `pnpm lint` | 1 | **PRE-EXISTING: 46 errors / 404 warnings across 17 files** (see lint.json / lint.txt; mostly `no-explicit-any`, `no-unused-vars`, import-resolver warnings per finding #88) |
| Unit tests | `pnpm test:unit` | 0 | 50 files / 664 tests passed |
| Integration tests | `pnpm test:integration` | 1 | **PRE-EXISTING: 1 failure** — `tests/integration/connectors/vault.test.ts > create_document → POST /files/upload as multipart "files"` (UpstreamError: SocketError: other side closed); 25 files / 168 tests passed |
| E2E tests | `pnpm test:e2e` | 0 | 7 files / 29 tests passed |
| Docker build | `docker build …` | n/a | docker CLI not available on this machine; Dockerfile fixes verified statically (CI runs the builds) |

Acceptance rule for fix batches: exit 0 for typecheck/unit/e2e; lint and integration must show **no new failures beyond this baseline** (compare against lint.json and the single vault multipart failure).

Files with pre-existing lint errors (error counts): apps/api/src/routes/index.ts (1), apps/canvas/src/components/canvas/CanvasEditor.tsx (2), apps/canvas/src/pages/Dashboard.tsx (1), tests/e2e/code-node-isolation.test.ts (1), tests/e2e/failover.test.ts (2), tests/integration/api/auth.test.ts (3), tests/integration/api/executions.test.ts (1), tests/integration/security/egress.test.ts (1), tests/integration/state/migration.test.ts (1), tests/unit/api/errorHandler.test.ts (5), tests/unit/engine/scheduler.test.ts (1), tests/unit/engine/stateMachine.test.ts (2), tests/unit/llm/router.test.ts (1), tests/unit/review-round4.test.ts (3), tests/unit/triggers/cron.test.ts (9), tests/unit/triggers/dispatcher.test.ts (4), tests/unit/triggers/webhook.test.ts (8).
