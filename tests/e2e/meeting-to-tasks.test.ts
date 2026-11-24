/**
 * E2E — Meeting → Tasks → KB scenario.
 *
 * Deploys Loop with mocked Vault / Desk / Recap connectors, creates a workflow
 * that extracts a summary from a meeting transcript (Recap), creates a follow-up
 * task in Desk, and stores the summary in Vault. Then triggers execution and
 * verifies the connectors were invoked as expected.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  createTestContext,
  meetingToTasksDefinition,
  waitForExecution,
  type TestContext,
} from './helpers';
import { WebhookTriggerHandler } from '../../packages/triggers/src/webhook';

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

    // 4. Audit #141: fire the REAL webhook handler (HMAC-signed receipt) —
    //    it creates the execution record; the e2e context has no dispatcher
    //    wiring, so we then drive the executor explicitly.
    const triggerPayload = {
      meeting_id: 'm1',
      conversation_id: 'conv-42',
    };
    const rawBody = JSON.stringify(triggerPayload);
    const signature = `sha256=${createHmac('sha256', 'test-webhook-secret').update(rawBody).digest('hex')}`;
    const handler = new WebhookTriggerHandler(ctx.store);
    const { execution_id: executionId } = await handler.handle({
      triggerId, signature, body: triggerPayload, rawBody,
    });

    // 5. Execute the workflow (the dispatcher's job in production)
    await ctx.executor.execute(executionId, definition, triggerPayload);

    // 6. Verify final execution status
    const final = await waitForExecution(ctx.store, executionId);
    expect(final.status).toBe('succeeded');
    expect(final.error).toBeNull();

    // 7. Verify all three connector calls happened
    expect(ctx.mocks.recap.calls).toHaveLength(1);
    expect(ctx.mocks.recap.calls[0]?.operation).toBe('get_meeting');
    expect(ctx.mocks.desk.calls).toHaveLength(1);
    expect(ctx.mocks.desk.calls[0]?.operation).toBe('send_response');
    expect(ctx.mocks.vault.calls).toHaveLength(1);
    expect(ctx.mocks.vault.calls[0]?.operation).toBe('create_document');

    // 8. Verify node execution records show outputs stored
    const nodeExecs = await ctx.store.nodeExecutions.listByExecution(executionId);
    expect(nodeExecs).toHaveLength(3);
    const succeeded = nodeExecs.filter((n) => n.status === 'succeeded');
    expect(succeeded).toHaveLength(3);

    // 9. Verify variable interpolation — Vault and Desk received the meeting
    //    summary (the template `{{node_1.output.summary}}` was resolved to the
    //    string returned by the Recap mock).
    const vaultCall = ctx.mocks.vault.calls[0];
    expect(vaultCall?.input['content']).toBe('Meeting summary');
    expect(vaultCall?.input['title']).toBe('Meeting summary');
    const deskCall = ctx.mocks.desk.calls[0];
    expect(deskCall?.input['content']).toBe('Meeting summary');
    expect(deskCall?.input['id']).toBe('conv-42');
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
