/**
 * Unit tests — timeout schema bounds (audit #67, #68).
 *
 * setTimeout delays above 2^31-1 ms overflow and fire after ~1ms, so a
 * "generous" 30-day timeout instantly failed every node/execution. The
 * schemas must reject such values, and the executor clamps legacy rows.
 */

import { describe, it, expect } from 'vitest';
import { WorkflowNodeSchema, WorkflowSettingsSchema } from '../../../packages/types/src/schemas/workflow';

const MAX = 2_147_483_647;

describe('timeout bounds (audit #67, #68)', () => {
  it('node timeout_ms accepts up to the setTimeout maximum', () => {
    const node = { id: 'n1', type: 'vault.search', position: { x: 0, y: 0 }, config: {}, timeout_ms: MAX };
    expect(WorkflowNodeSchema.safeParse(node).success).toBe(true);
  });

  it('node timeout_ms rejects overflowing values', () => {
    const node = { id: 'n1', type: 'vault.search', position: { x: 0, y: 0 }, config: {}, timeout_ms: 3_000_000_000 };
    expect(WorkflowNodeSchema.safeParse(node).success).toBe(false);
  });

  it('workflow_timeout_ms accepts up to the setTimeout maximum', () => {
    expect(WorkflowSettingsSchema.safeParse({ workflow_timeout_ms: MAX }).success).toBe(true);
  });

  it('workflow_timeout_ms rejects overflowing values (30 days)', () => {
    expect(WorkflowSettingsSchema.safeParse({ workflow_timeout_ms: 2_592_000_000 }).success).toBe(false);
  });
});
