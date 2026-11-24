/**
 * Unit tests — version snapshot atomicity (audit #70, #139).
 *
 * createVersion persists the DB snapshot FIRST, then commits to git and
 * backfills the hash; a git failure compensates by deleting the row. The
 * (workflow_id, version) unique index prevents divergent duplicate snapshots.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, it, expect, afterEach } from 'vitest';

import {
  createSqliteConnection,
  SqliteStateStore,
  type SqliteConnection,
} from '../../../packages/state/src';
import { GitBackend } from '../../../packages/versioning/src/git';
import { VersioningService } from '../../../packages/versioning/src/service';
import type { WorkflowDefinition } from '../../../packages/types/src';

const DEF: WorkflowDefinition = {
  version: '1.0',
  nodes: [],
  edges: [],
  variables: {},
  metadata: { name: 'vtest', description: '', tags: [] },
};

describe('VersioningService — DB-first snapshot (audit #70)', () => {
  const conns: SqliteConnection[] = [];
  const dirs: string[] = [];
  afterEach(() => {
    while (conns.length > 0) conns.pop()!.close();
    while (dirs.length > 0) fs.rmSync(dirs.pop()!, { recursive: true, force: true });
  });

  async function setup(gitRepoPath?: string) {
    const conn = createSqliteConnection({ path: ':memory:', wal: false });
    conns.push(conn);
    const store = new SqliteStateStore(conn);
    await store.initialise();
    await store.users.create({ id: 'system', username: 'system', password_hash: '', email: 's@loop.test', role: 'admin' });
    const workflowId = crypto.randomUUID();
    await store.workflows.create({ id: workflowId, name: 'vtest', description: '', definition: DEF, created_by: 'system' });
    const repoPath = gitRepoPath ?? fs.mkdtempSync(path.join(os.tmpdir(), 'loop-ver-'));
    if (!gitRepoPath) dirs.push(repoPath);
    const git = new GitBackend({ repoPath });
    if (!gitRepoPath) await git.initialise();
    return { store, git, service: new VersioningService(store, git), workflowId };
  }

  it('happy path: snapshot row carries the git hash', async () => {
    const { service, store, workflowId } = await setup();
    const { id, commit_hash } = await service.createVersion({
      workflow_id: workflowId, version: 1, definition: DEF, created_by: 'system',
    });
    expect(commit_hash).toMatch(/^[0-9a-f]{40}$/);
    const rows = await store.workflowDefinitions.listByWorkflow(workflowId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(id);
    expect(rows[0]!.commit_hash).toBe(commit_hash);
  });

  it('git failure compensates: no orphan snapshot row remains', async () => {
    // repoPath pointing at a regular FILE makes the git write fail after the
    // DB row was created.
    const filePath = path.join(os.tmpdir(), `loop-ver-file-${Date.now()}`);
    fs.writeFileSync(filePath, 'not a directory');
    dirs.push(filePath);
    const { service, store, workflowId } = await setup(filePath);
    await expect(
      service.createVersion({ workflow_id: workflowId, version: 1, definition: DEF, created_by: 'system' }),
    ).rejects.toThrow();
    const rows = await store.workflowDefinitions.listByWorkflow(workflowId);
    expect(rows).toHaveLength(0);
  });
});

describe('workflow_definitions unique version (audit #139)', () => {
  const conns: SqliteConnection[] = [];
  afterEach(() => {
    while (conns.length > 0) conns.pop()!.close();
  });

  it('rejects two snapshots under the same (workflow_id, version)', async () => {
    const conn = createSqliteConnection({ path: ':memory:', wal: false });
    conns.push(conn);
    const store = new SqliteStateStore(conn);
    await store.initialise();
    await store.users.create({ id: 'system', username: 'system', password_hash: '', email: 's@loop.test', role: 'admin' });
    const workflowId = crypto.randomUUID();
    await store.workflows.create({ id: workflowId, name: 'dup', description: '', definition: DEF, created_by: 'system' });
    await store.workflowDefinitions.create({ id: crypto.randomUUID(), workflow_id: workflowId, version: 1, definition: DEF, commit_hash: 'a', created_by: 'system' });
    await expect(
      store.workflowDefinitions.create({ id: crypto.randomUUID(), workflow_id: workflowId, version: 1, definition: DEF, commit_hash: 'b', created_by: 'system' }),
    ).rejects.toThrow(/UNIQUE/);
  });
});
