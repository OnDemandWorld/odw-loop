/**
 * Workflow authoring service — CRUD + validation + versioning.
 */

import { randomUUID } from 'node:crypto';
import { createLogger } from '@loop/observability';
import type { Workflow, WorkflowDefinition } from '@loop/types';
import { NotFoundError, ValidationError } from '@loop/types';
import type { StateStore } from '@loop/state';
import type { VersioningService } from '@loop/versioning';
import { validateWorkflow } from './validator.js';

const logger = createLogger({ name: 'loop:workflow-authoring', component: 'workflow-authoring' });

export class WorkflowAuthoringService {
  constructor(
    private store: StateStore,
    private versioning: VersioningService,
  ) {}

  /** Create a new workflow. */
  async create(params: {
    name: string;
    description?: string;
    definition: WorkflowDefinition;
    tags?: string[];
    created_by: string;
  }): Promise<Workflow> {
    // Validate topology
    const validation = validateWorkflow(params.definition);
    if (!validation.valid) {
      throw new ValidationError('Invalid workflow topology', validation.errors);
    }

    const id = randomUUID();
    const workflow = await this.store.workflows.create({
      id,
      name: params.name,
      description: params.description ?? '',
      definition: params.definition,
      created_by: params.created_by,
      tags: params.tags,
    });

    // Create initial version snapshot
    await this.versioning.createVersion({
      workflow_id: id,
      version: 1,
      definition: params.definition,
      created_by: params.created_by,
      change_summary: 'Initial version',
    });

    logger.info({ workflow_id: id, name: params.name }, 'Workflow created');
    return workflow;
  }

  /** Get a workflow by ID. */
  async getById(id: string): Promise<Workflow> {
    const workflow = await this.store.workflows.getById(id);
    if (!workflow) throw new NotFoundError('workflow', id);
    return workflow;
  }

  /** List workflows with filtering and pagination. */
  async list(filter: { status?: 'draft' | 'active' | 'archived'; tag?: string; search?: string; sort?: string }, page = 1, per_page = 20) {
    return this.store.workflows.list(filter, { page, per_page });
  }

  /** Update a workflow (creates a new version). */
  async update(
    id: string,
    params: {
      name?: string;
      description?: string;
      definition?: WorkflowDefinition;
      status?: 'draft' | 'active' | 'archived';
      tags?: string[];
      updated_by: string;
    },
  ): Promise<Workflow> {
    await this.getById(id);

    // Validate new definition if provided
    if (params.definition) {
      const validation = validateWorkflow(params.definition);
      if (!validation.valid) {
        throw new ValidationError('Invalid workflow topology', validation.errors);
      }
    }

    const updated = await this.store.workflows.update(id, params);

    // Create version snapshot if definition changed
    if (params.definition) {
      await this.versioning.createVersion({
        workflow_id: id,
        version: updated.version,
        definition: params.definition,
        created_by: params.updated_by,
        change_summary: `Updated by ${params.updated_by}`,
      });
    }

    logger.info({ workflow_id: id, version: updated.version }, 'Workflow updated');
    return updated;
  }

  /** Soft-delete (archive) a workflow. */
  async archive(id: string): Promise<void> {
    await this.getById(id); // ensure it exists
    await this.store.workflows.archive(id);
    logger.info({ workflow_id: id }, 'Workflow archived');
  }

  /** Validate a workflow definition without saving. */
  async validate(definition: WorkflowDefinition) {
    return validateWorkflow(definition);
  }

  /** Get version history for a workflow. */
  async getVersions(workflowId: string) {
    return this.versioning.listVersions(workflowId);
  }

  /** Restore a previous version (creates a new version from the historical definition). */
  async restoreVersion(workflowId: string, version: number, restored_by: string): Promise<Workflow> {
    const historical = await this.versioning.getVersion(workflowId, version);
    if (!historical) throw new NotFoundError('workflow_version', `${workflowId}@${version}`);

    return this.update(workflowId, {
      definition: historical.definition,
      updated_by: restored_by,
    });
  }
}
