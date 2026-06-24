/**
 * Git operations via isomorphic-git (§7.4 — versioning service).
 *
 * Uses a bare git repository on disk to store workflow definition history.
 * Each workflow update creates a commit with the definition as the commit body.
 */

import git from 'isomorphic-git';
import fs from 'node:fs';
import path from 'node:path';
import { createLogger } from '@loop/observability';

const logger = createLogger({ name: 'loop:versioning:git', component: 'versioning' });

export interface GitBackendOptions {
  /** Path to the bare git repository on disk. */
  repoPath: string;
}

export class GitBackend {
  private repoPath: string;

  constructor(opts: GitBackendOptions) {
    this.repoPath = opts.repoPath;
  }

  /** Initialise the bare repository if it doesn't exist yet. */
  async initialise(): Promise<void> {
    if (!fs.existsSync(this.repoPath)) {
      fs.mkdirSync(this.repoPath, { recursive: true });
    }
    const gitDir = path.join(this.repoPath, '.git');
    if (!fs.existsSync(gitDir)) {
      await git.init({ fs, dir: this.repoPath });
      logger.info({ repoPath: this.repoPath }, 'Git repository initialised');
    }
  }

  /** Commit a workflow definition snapshot. */
  async commit(params: {
    workflow_id: string;
    version: number;
    definition: string;
    author: string;
    message: string;
  }): Promise<string> {
    const filePath = path.join(this.repoPath, `${params.workflow_id}.json`);
    fs.writeFileSync(filePath, params.definition, 'utf8');

    await git.add({ fs, dir: this.repoPath, filepath: `${params.workflow_id}.json` });

    const sha = await git.commit({
      fs,
      dir: this.repoPath,
      message: params.message,
      author: {
        name: params.author,
        email: `${params.author}@loop.internal`,
      },
    });

    logger.info(
      { workflow_id: params.workflow_id, version: params.version, sha: sha.slice(0, 12) },
      'Git commit created',
    );
    return sha;
  }

  /** List commits for a specific workflow. */
  async log(workflow_id: string): Promise<Array<{ sha: string; message: string; timestamp: number }>> {
    try {
      const commits = await git.log({
        fs,
        dir: this.repoPath,
        filepath: `${workflow_id}.json`,
      });
      return commits.map((c) => ({
        sha: c.oid,
        message: c.commit.message,
        timestamp: c.commit.author.timestamp,
      }));
    } catch {
      return [];
    }
  }

  /** Read the definition at a specific commit. */
  async readAtCommit(workflow_id: string, sha: string): Promise<string | null> {
    try {
      const { blob } = await git.readBlob({
        fs,
        dir: this.repoPath,
        oid: sha,
        filepath: `${workflow_id}.json`,
      });
      return Buffer.from(blob).toString('utf8');
    } catch {
      return null;
    }
  }
}
