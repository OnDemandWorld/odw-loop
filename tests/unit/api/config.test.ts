import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../../../apps/api/src/config.js';

/**
 * V1.6 correctness regression: boolean env vars must parse conventional
 * truthy/falsy strings correctly. `z.coerce.boolean()` treated the string
 * "false" as true (Boolean("false") === true), so e.g. LOOP_REQUIRE_AUTH=false
 * wrongly enabled auth. These tests lock in the fixed booleanEnv behavior.
 */
describe('config boolean env parsing', () => {
  const saved = { ...process.env };

  afterEach(() => {
    process.env = { ...saved };
  });

  const parseWith = (vars: Record<string, string>) => {
    process.env = { ...saved, ...vars };
    return loadConfig();
  };

  it('treats "false"/"0"/"no"/"off" as false', () => {
    for (const v of ['false', '0', 'no', 'off', 'FALSE', 'No']) {
      const cfg = parseWith({ LOOP_REQUIRE_AUTH: v, LOOP_METRICS_ENABLED: v });
      expect(cfg.LOOP_REQUIRE_AUTH, `REQUIRE_AUTH=${v}`).toBe(false);
      expect(cfg.LOOP_METRICS_ENABLED, `METRICS_ENABLED=${v}`).toBe(false);
    }
  });

  it('treats "true"/"1"/"yes"/"on" as true', () => {
    for (const v of ['true', '1', 'yes', 'on', 'TRUE']) {
      const cfg = parseWith({ LOOP_REQUIRE_AUTH: v, LOOP_OTEL_ENABLED: v });
      expect(cfg.LOOP_REQUIRE_AUTH, `REQUIRE_AUTH=${v}`).toBe(true);
      expect(cfg.LOOP_OTEL_ENABLED, `OTEL_ENABLED=${v}`).toBe(true);
    }
  });

  it('falls back to defaults when unset (REQUIRE_AUTH false, METRICS_ENABLED true)', () => {
    const env = { ...saved };
    delete env.LOOP_REQUIRE_AUTH;
    delete env.LOOP_METRICS_ENABLED;
    delete env.LOOP_DB_SSL;
    process.env = env;
    const cfg = loadConfig();
    expect(cfg.LOOP_REQUIRE_AUTH).toBe(false);
    expect(cfg.LOOP_METRICS_ENABLED).toBe(true);
    expect(cfg.LOOP_DB_SSL).toBe(false);
  });

  it('parses LOOP_DB_SSL="false" as false (would previously be true)', () => {
    const cfg = parseWith({ LOOP_DB_SSL: 'false' });
    expect(cfg.LOOP_DB_SSL).toBe(false);
  });
});
