/**
 * Unit tests — SQLite store parity fixes (audit #61, #57).
 *
 * #61: an empty egress-policy patch must no-op (PG parity), not throw
 *      drizzle's 'No values to set' (500 on Core, 200 on Scale).
 * #57: tag filtering and search use identical substring semantics on both
 *      tiers (PG previously used exact @> and FTS).
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  createSqliteConnection,
  SqliteStateStore,
  type SqliteConnection,
} from '../../../packages/state/src';
import type { WorkflowDefinition } from '../../../packages/types/src';

const EMPTY_DEF: WorkflowDefinition = {
  version: '1.0',
  nodes: [],
  edges: [],
  variables: {},
  metadata: { name: 'x', description: '', tags: [] },
};

describe('SQLite store parity (audit #61, #57)', () => {
  const conns: SqliteConnection[] = [];
  afterEach(() => {
    while (conns.length > 0) conns.pop()!.close();
  });

  async function setup(): Promise<SqliteStateStore> {
    const conn = createSqliteConnection({ path: ':memory:', wal: false });
    conns.push(conn);
    const store = new SqliteStateStore(conn);
    await store.initialise();
    await store.users.create({ id: 'system', username: 'system', password_hash: '', email: 's@loop.test', role: 'admin' });
    return store;
  }

  it('egressPolicies.update with an empty patch no-ops instead of throwing', async () => {
    const store = await setup();
    await store.egressPolicies.create({ id: 'p-1', name: 'p', rule_type: 'deny', target_type: 'domain', target_value: 'x.test' });
    await expect(store.egressPolicies.update('p-1', {})).resolves.toBeUndefined();
    await store.egressPolicies.update('p-1', { enabled: false });
    const rows = await store.egressPolicies.list();
    expect(rows.find((r) => r.id === 'p-1')?.enabled).toBe(false);
  });

  it('tag filter and search both use substring semantics (PG parity)', async () => {
    const store = await setup();
    await store.workflows.create({ id: 'wf-a', name: 'workflow-alpha', description: '', definition: EMPTY_DEF, created_by: 'system', tags: ['production'] });
    await store.workflows.create({ id: 'wf-b', name: 'beta', description: '', definition: EMPTY_DEF, created_by: 'system', tags: ['prod'] });

    // Substring tag match: 'prod' matches both 'production' and 'prod' —
    // identical to the PG tier's tags::text LIKE (audit #57).
    const tagged = await store.workflows.list({ tag: 'prod' }, { page: 1, per_page: 10 });
    expect(tagged.data.map((w) => w.id).sort()).toEqual(['wf-a', 'wf-b']);

    const searched = await store.workflows.list({ search: 'work' }, { page: 1, per_page: 10 });
    expect(searched.data.map((w) => w.id)).toEqual(['wf-a']);
  });
});
