import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/integration/**/*.test.ts', 'tests/e2e/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
    testTimeout: 120000,
    // V1.5 (F-4'): run integration/e2e files serially to remove inter-file
    // contention for the native better-sqlite3 module — the root cause of the
    // rare high-load SIGSEGV seen when `make verify` runs all suites in sequence.
    fileParallelism: false,
  },
});
