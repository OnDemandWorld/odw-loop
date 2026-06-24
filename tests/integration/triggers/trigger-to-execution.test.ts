/**
 * Integration tests — trigger → execution flow.
 *
 * Creates a webhook trigger, sends a webhook request with a valid HMAC
 * signature, and verifies an execution is created for the workflow.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildTestApp, seedWorkflow, type TestApp } from '../_helpers/app.js';

function hmacSignature(secret: string, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

describe('Trigger → Execution flow', () => {
  let ctx: TestApp;
  let app: FastifyInstance;

  beforeAll(async () => {
    ctx = await buildTestApp();
    app = ctx.app;
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    ctx.conn.close();
  });

  beforeEach(async () => {
    // Clean workflows & triggers between tests
    const existing = await ctx.store.workflows.list({}, { page: 1, per_page: 100 });
    for (const wf of existing.data) {
      try { await ctx.store.workflows.delete(wf.id); } catch { /* ignore */ }
    }
  });

  it('POST /webhooks/:triggerId with valid signature creates an execution', async () => {
    // 1. Create a workflow
    const wf = await seedWorkflow(ctx.store, { name: 'Webhook-Triggered' });

    // 2. Create a webhook trigger with a known secret
    const webhookSecret = 'super-secret-webhook-key';
    const triggerRes = await app.inject({
      method: 'POST',
      url: `/api/v1/workflows/${wf.id}/triggers`,
      payload: {
        trigger_type: 'webhook',
        config: { secret: webhookSecret, path: '/webhook' },
      },
    });
    expect(triggerRes.statusCode).toBe(201);
    const triggerId = triggerRes.json().data.id;

    // 3. Fire the webhook with valid HMAC signature
    const payload = { event: 'user.signup', user_id: 'u-123' };
    const rawBody = JSON.stringify(payload);
    const signature = hmacSignature(webhookSecret, rawBody);

    const webhookRes = await app.inject({
      method: 'POST',
      url: `/webhooks/${triggerId}`,
      headers: { 'x-loop-signature': signature, 'content-type': 'application/json' },
      payload,
    });

    expect(webhookRes.statusCode).toBe(200);
    const body = webhookRes.json();
    expect(body.accepted).toBe(true);
    expect(body.execution_id).toBeDefined();

    // 4. Verify execution was created
    const execution = await ctx.store.executions.getById(body.execution_id);
    expect(execution).not.toBeNull();
    expect(execution!.workflow_id).toBe(wf.id);
    expect(execution!.trigger_type).toBe('webhook');
    expect(execution!.trigger_payload).toMatchObject(payload);
    expect(execution!.status).toBe('pending');
  });

  it('POST /webhooks/:triggerId with invalid signature is rejected', async () => {
    const wf = await seedWorkflow(ctx.store);
    const webhookSecret = 'another-secret';
    const triggerRes = await app.inject({
      method: 'POST',
      url: `/api/v1/workflows/${wf.id}/triggers`,
      payload: { trigger_type: 'webhook', config: { secret: webhookSecret } },
    });
    const triggerId = triggerRes.json().data.id;

    const payload = { event: 'x' };
    const rawBody = JSON.stringify(payload);
    const badSignature = hmacSignature('wrong-secret', rawBody);

    const webhookRes = await app.inject({
      method: 'POST',
      url: `/webhooks/${triggerId}`,
      headers: { 'x-loop-signature': badSignature, 'content-type': 'application/json' },
      payload,
    });

    // Signature mismatch → 401
    expect(webhookRes.statusCode).toBe(401);
    const body = webhookRes.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('AUTH_INVALID_TOKEN');
  });

  it('POST /webhooks/:triggerId for unknown trigger returns 404', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/00000000-0000-0000-0000-999999999999',
      headers: { 'x-loop-signature': 'sha256=abc' },
      payload: {},
    });

    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('NOT_FOUND_TRIGGER');
  });

  it('disabled webhook trigger is rejected', async () => {
    const wf = await seedWorkflow(ctx.store);
    const triggerRes = await app.inject({
      method: 'POST',
      url: `/api/v1/workflows/${wf.id}/triggers`,
      payload: { trigger_type: 'webhook', config: { secret: 's' } },
    });
    const triggerId = triggerRes.json().data.id;
    await ctx.store.triggers.update(triggerId, { enabled: false });

    const payload = { event: 'y' };
    const rawBody = JSON.stringify(payload);
    const signature = hmacSignature('s', rawBody);

    const res = await app.inject({
      method: 'POST',
      url: `/webhooks/${triggerId}`,
      headers: { 'x-loop-signature': signature },
      payload,
    });

    expect(res.statusCode).toBe(401);
  });

  it('POST /api/v1/workflows/:id/triggers creates a trigger (round-trip)', async () => {
    const wf = await seedWorkflow(ctx.store);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/workflows/${wf.id}/triggers`,
      payload: { trigger_type: 'cron', config: { expression: '*/5 * * * *', timezone: 'UTC' } },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.data.workflow_id).toBe(wf.id);
    expect(body.data.trigger_type).toBe('cron');
    expect(body.data.config).toMatchObject({ expression: '*/5 * * * *' });

    // List triggers
    const listRes = await app.inject({
      method: 'GET',
      url: `/api/v1/workflows/${wf.id}/triggers`,
    });
    expect(listRes.statusCode).toBe(200);
    expect(listRes.json().data).toHaveLength(1);
  });

  it('manual trigger creates an execution via POST /execute', async () => {
    const wf = await seedWorkflow(ctx.store);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/workflows/${wf.id}/execute`,
      payload: { payload: { manual: true } },
    });

    expect(res.statusCode).toBe(202);
    const executionId = res.json().data.execution_id;

    const execution = await ctx.store.executions.getById(executionId);
    expect(execution!.trigger_type).toBe('manual');
    expect(execution!.trigger_payload).toEqual({ manual: true });
  });
});
