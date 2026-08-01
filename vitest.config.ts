import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@loop/types': resolve(__dirname, 'packages/types/src/index.ts'),
      '@loop/observability': resolve(__dirname, 'packages/observability/src/index.ts'),
      '@loop/state': resolve(__dirname, 'packages/state/src/index.ts'),
      '@loop/connectors': resolve(__dirname, 'packages/connectors/src/index.ts'),
      '@loop/engine': resolve(__dirname, 'packages/engine/src/index.ts'),
      '@loop/versioning': resolve(__dirname, 'packages/versioning/src/index.ts'),
      '@loop/triggers': resolve(__dirname, 'packages/triggers/src/index.ts'),
      '@loop/workflow-authoring': resolve(__dirname, 'packages/workflow-authoring/src/index.ts'),
      '@loop/egress': resolve(__dirname, 'packages/egress/src/index.ts'),
      '@loop/llm': resolve(__dirname, 'packages/llm/src/index.ts'),
      '@loop/secrets': resolve(__dirname, 'packages/secrets/src/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'packages/*/tests/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', 'tests/integration', 'tests/e2e'],
    // V1.5 M1 (F-4', TH2): run unit test files serially. Each file still gets its
    // own isolated worker context, but files no longer execute concurrently. This
    // removes inter-file contention for the native better-sqlite3 module (the root
    // cause of rare high-load SIGSEGV) and for CPU time (which skewed the wall-clock
    // timing assertions). Combined with the per-test fake-timer / widened-margin
    // hardening, this keeps `make verify` stably green under high load.
    fileParallelism: false,
    coverage: {
      reporter: ['text', 'json', 'html'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80
      }
    }
  }
});
