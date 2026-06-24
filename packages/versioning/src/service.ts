/**
 * Versioning service — wraps git backend + state store to provide version
 * management for workflow definitions.
 */

import { randomUUID } from 'node:crypto';
import { createLogger } from '@loop/observability';
import type { WorkflowDefinition } from '@loop/types';
import type { StateStore } from '@loop/state';
import { GitBackend } from './git.js';
import { diffDefinitions } from './diff.js';

const logger = createLogger({ name: 'loop:versioning', component: 'versioning' });

export class VersioningService {
  constructor(
    private store: StateStore,
    private git: GitBackend,
  ) {}

  /** Create a new version snapshot for a workflow. */
  async createVersion(params: {
    workflow_id: string;
    version: number;
    definition: WorkflowDefinition;
    created_by: string;
    change_summary?: string;
  }): Promise<{ id: string; commit_hash: string }> {
    // Commit to git
    const commit_hash = await this.git.commit({
      workflow_id: params.workflow_id,
      version: params.version,
      definition: JSON.stringify(params.definition, null, 2),
      author: params.created_by,
      message: params.change_summary ?? `Version ${params.version}`,
    });

    // Store the versioned snapshot
    const id = randomUUID();
    await this.store.workflowDefinitions.create({
      id,
      workflow_id: params.workflow_id,
      version: params.version,
      definition: params.definition,
      commit_hash,
      created_by: params.created_by,
      change_summary: params.change_summary,
    });

    logger.info(
      { workflow_id: params.workflow_id, version: params.version, commit_hash: commit_hash.slice(0, 12) },
      'Version created',
    );

    return { id, commit_hash };
  }

  /** List all versions for a workflow. */
  async listVersions(workflow_id: string) {
    return this.store.workflowDefinitions.listByWorkflow(workflow_id);
  }

  /** Get a specific version. */
  async getVersion(workflow_id: string, version: number) {
    return this.store.workflowDefinitions.getByWorkflowAndVersion(workflow_id, version);
  }

  /** Generate a diff between two versions. */
  async diff(workflow_id: string, fromVersion: number, toVersion: number) {
    const from = await this.getVersion(workflow_id, fromVersion);
    const to = await this.getVersion(workflow_id, toVersion);
    if (!from || !to) return null;
    return diffDefinitions(from.definition, to.definition);
  }
}
