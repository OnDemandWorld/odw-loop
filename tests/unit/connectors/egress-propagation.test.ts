/**
 * Unit tests — egress denial propagation (audit #41).
 *
 * The ODW adapters (vault/desk/recap) wrapped EVERY non-UpstreamError —
 * including the egress gate's LoopError('NODE_EGRESS_BLOCKED') — into
 * UPSTREAM_*_UNAVAILABLE, masking policy blocks as outages and making the
 * executor retry permanently-blocked calls. Denials must propagate unchanged.
 */

import { describe, it, expect } from 'vitest';
import { VaultAdapter } from '../../../packages/connectors/src/vault/adapter';
import { DeskAdapter } from '../../../packages/connectors/src/desk/adapter';
import { RecapAdapter } from '../../../packages/connectors/src/recap/adapter';
import { LoopError, UpstreamError } from '../../../packages/types/src/errors';

const denyingGate = {
  async check(_url: string): Promise<void> {
    throw new LoopError('NODE_EGRESS_BLOCKED', 'Egress blocked: test deny', 403);
  },
};

const cases: Array<{ name: string; adapter: { execute: (p: never) => Promise<unknown> }; operation: string }> = [
  { name: 'VaultAdapter', adapter: new VaultAdapter() as never, operation: 'rag_query' },
  { name: 'DeskAdapter', adapter: new DeskAdapter() as never, operation: 'list_conversations' },
  { name: 'RecapAdapter', adapter: new RecapAdapter() as never, operation: 'list_meetings' },
];

describe('egress denial propagation (audit #41)', () => {
  for (const { name, adapter, operation } of cases) {
    it(`${name} propagates NODE_EGRESS_BLOCKED unchanged (no UPSTREAM wrap, no retry bait)`, async () => {
      const promise = adapter.execute({
        operation,
        input: {},
        config: { base_url: 'http://127.0.0.1:9' },
        egress: denyingGate,
      } as never);
      await expect(promise).rejects.toBeInstanceOf(LoopError);
      await expect(promise).rejects.toMatchObject({ code: 'NODE_EGRESS_BLOCKED' });
      await expect(promise).rejects.not.toBeInstanceOf(UpstreamError);
    });
  }
});
