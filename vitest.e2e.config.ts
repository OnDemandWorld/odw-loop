import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // V1.6 M1 (F-1, DB2): global safety net — closes any SQLite connection a
    // test leaked (see tests/setup.ts + tests/helpers/testStore.ts).
    setupFiles: ['tests/setup.ts'],
    include: ['tests/e2e/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
    testTimeout: 30000,
    // V1.5 (F-4'): run e2e files serially to remove inter-file contention for
    // the native better-sqlite3 module (root cause of the rare high-load
    // SIGSEGV under `make verify`).
    fileParallelism: false,
  },
});
