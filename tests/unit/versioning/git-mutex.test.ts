/**
 * Unit tests — GitBackend commit serialization (audit #69).
 *
 * isomorphic-git has no cross-call locking; concurrent createVersion calls
 * raced on the shared index/HEAD and could orphan commits. All mutations must
 * be serialized per repo.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, it, expect } from 'vitest';

import { GitBackend } from '../../../packages/versioning/src/git';

const WF_A = 'aaaaaaaa-0000-0000-0000-000000000000';
const WF_B = 'bbbbbbbb-0000-0000-0000-000000000000';

describe('GitBackend — concurrent commits (audit #69)', () => {
  it('serializes concurrent commits without losing history', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loop-git-mutex-'));
    try {
      const git = new GitBackend({ repoPath: dir });
      await git.initialise();

      const shas = await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          git.commit({
            workflow_id: i % 2 === 0 ? WF_A : WF_B,
            version: i + 1,
            definition: JSON.stringify({ v: i }),
            author: 'tester',
            message: `v${i + 1}`,
          }),
        ),
      );

      // Every commit landed, all distinct.
      expect(new Set(shas).size).toBe(10);
      expect(await git.log(WF_A)).toHaveLength(5);
      expect(await git.log(WF_B)).toHaveLength(5);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
