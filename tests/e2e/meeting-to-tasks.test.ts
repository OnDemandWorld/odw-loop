/**
 * E2E — Meeting → Tasks → KB scenario.
 *
 * Deploys Loop with mocked Vault / Desk / Recap connectors, creates a workflow
 * that extracts a summary from a meeting transcript (Recap), creates a follow-up
 * task in Desk, and stores the summary in Vault. Then triggers execution and
 * verifies the connectors were invoked as expected.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createTestContext,
  meetingToTasksDefinition,
  waitForExecution,
  type TestContext,
} from './helpers';

describe('Meeting → Tasks → KB (E2E)', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestContext();
  });

  afterEach(async () => {
    await ctx.close();
  });

  it('deploys Loop, configures connectors, creates workflow, triggers via webhook, and completes', async () => {
    // 1. Register connector instances with config (mimicking what an admin would do)
    ctx.connectors.registerInstance('recap-prod', 'recap', { base_url: 'https://recap.mock' });
    ctx.connectors.registerInstance('desk-prod', 'desk', { base_url: 'https://desk.mock' });
    ctx.connectors.registerInstance('vault-prod', 'vault', { base_url: 'https://vault.mock' });

    // 2. Create the workflow definition
    const definition = meetingToTasksDefinition();
    const workflowId = 'wf-meeting-tasks';
    await ctx.store.workflows.create({
      id: workflowId,
      name: 'Meeting → Tasks → KB',
      description: 'Extract action items from meeting transcript',
      definition,
      created_by: 'system',
      tags: ['e2e'],
    });

    // 3. Create a webhook trigger bound to this workflow
    const triggerId = 'trig-meeting';
    await ctx.store.triggers.create({
      id: triggerId,
      workflow_id: workflowId,
      trigger_type: 'webhook',
      config: { secret: 'test-webhook-secret' },
    });

    // 4. Trigger via manual (simulating what the webhook handler does on receipt)
    //    The webhook trigger handler in this repo creates an execution record.
    //    Since the executor is not yet wired to auto-run from triggers, we drive
    //    execution directly to demonstrate the full pipeline.
    const executionId = 'exec-meeting-1';
    const triggerPayload = {
      transcript: 'Discussed Q3 budget. Action: review forecast by Friday.',
    };
    await ctx.store.executions.create({
      id: executionId,
      workflow_id: workflowId,
      workflow_version: 1,
      trigger_type: 'webhook',
      trigger_payload: triggerPayload,
      initiated_by: 'webhook',
    });

    // 5. Execute the workflow (this is what the engine queue would do)
    await ctx.executor.execute(executionId, definition, triggerPayload);

    // 6. Verify final execution status
    const final = await waitForExecution(ctx.store, executionId);
    expect(final.status).toBe('succeeded');
    expect(final.error).toBeNull();

    // 7. Verify all three connector calls happened
    expect(ctx.mocks.recap.calls).toHaveLength(1);
    expect(ctx.mocks.recap.calls[0]?.operation).toBe('summarize');
    expect(ctx.mocks.desk.calls).toHaveLength(1);
    expect(ctx.mocks.desk.calls[0]?.operation).toBe('create_task');
    expect(ctx.mocks.vault.calls).toHaveLength(1);
    expect(ctx.mocks.vault.calls[0]?.operation).toBe('create_document');

    // 8. Verify node execution records show outputs stored
    const nodeExecs = await ctx.store.nodeExecutions.listByExecution(executionId);
    expect(nodeExecs).toHaveLength(3);
    const succeeded = nodeExecs.filter((n) => n.status === 'succeeded');
    expect(succeeded).toHaveLength(3);

    // 9. Verify variable interpolation — Vault received the summary output
    //    (the template `{{node_1.output.summary}}` was resolved to the actual
    //    string returned by the Recap mock).
    const vaultCall = ctx.mocks.vault.calls[0];
    expect(vaultCall?.input['content']).toBe('Meeting summary');
    expect(vaultCall?.input['title']).toBe('Meeting summary');
  });

  it('fails the execution when a connector returns an error', async () => {
    // Force Recap to fail
    ctx.mocks.recap.setError(new Error('Recap service unavailable'));

    const definition = meetingToTasksDefinition();
    const workflowId = 'wf-meeting-fail';
    await ctx.store.workflows.create({
      id: workflowId,
      name: 'Failing meeting flow',
      description: '',
      definition,
      created_by: 'system',
    });

    const executionId = 'exec-fail-1';
    await ctx.store.executions.create({
      id: executionId,
      workflow_id: workflowId,
      workflow_version: 1,
      trigger_type: 'manual',
      trigger_payload: { transcript: 'test' },
    });

    // Executor rethrows; completeExecution marks it failed first
    await expect(
      ctx.executor.execute(executionId, definition, { transcript: 'test' }),
    ).rejects.toThrow(/Recap service unavailable/);

    const final = await ctx.store.executions.getById(executionId);
    expect(final?.status).toBe('failed');
    expect(final?.error).toMatch(/Recap service unavailable/);

    // Desk and Vault should NOT have been called (Recap failed before them)
    expect(ctx.mocks.desk.calls).toHaveLength(0);
    expect(ctx.mocks.vault.calls).toHaveLength(0);
  });
});
