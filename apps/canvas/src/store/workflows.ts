/**
 * Workflow store (V1.1 M2, F4) — global state for the workflow list.
 *
 * Wraps the REST layer so components can read workflows and trigger
 * create/archive without threading callbacks through the tree.
 */

import { create } from 'zustand';
import { api, type Workflow, type WorkflowDefinition } from '../lib/api';

export interface CreateWorkflowInput {
  name: string;
  description: string;
  definition: WorkflowDefinition;
  tags?: string[];
}

export interface WorkflowStore {
  workflows: Workflow[];
  /** True once the first load has completed (success or failure). */
  loaded: boolean;
  loading: boolean;
  error: string | null;
  load: (params?: { status?: string; search?: string; per_page?: number }) => Promise<void>;
  createWorkflow: (input: CreateWorkflowInput) => Promise<Workflow>;
  /** Archives (soft-deletes) a workflow and drops it from the local list. */
  deleteWorkflow: (id: string) => Promise<void>;
}

export const useWorkflowStore = create<WorkflowStore>((set, get) => ({
  workflows: [],
  loaded: false,
  loading: false,
  error: null,

  async load(params) {
    set({ loading: true, error: null });
    try {
      const result = await api.listWorkflows({
        per_page: params?.per_page ?? 100,
        status: params?.status,
        search: params?.search,
      });
      set({ workflows: result.data ?? [], loaded: true, loading: false });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err), loading: false, loaded: true });
    }
  },

  async createWorkflow(input) {
    const workflow = await api.createWorkflow(input);
    set({ workflows: [workflow, ...get().workflows] });
    return workflow;
  },

  async deleteWorkflow(id) {
    await api.archiveWorkflow(id);
    set({ workflows: get().workflows.filter((w) => w.id !== id) });
  },
}));
