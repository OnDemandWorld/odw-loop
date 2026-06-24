import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { WebhookTriggerHandler } from '../../../packages/triggers/src/webhook';

// Use a unique triggerId per test to avoid shared module-level rate-limit bucket.
let testTriggerCounter = 0;
function uniqueTriggerId(): string {
  return `trigger-${Date.now()}-${++testTriggerCounter}`;
}

describe('WebhookTriggerHandler', () => {
  it('accepts valid HMAC signature', async () => {
    const triggerId = uniqueTriggerId();
    const secret = 'test-secret';
    const body = { data: 'test' };
    const rawBody = JSON.stringify(body);
    const signature = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;

    const mockStore = {
      triggers: {
        getById: vi.fn().mockResolvedValue({
          id: triggerId,
          workflow_id: 'workflow-1',
          enabled: true,
          config: { secret },
        }),
      },
      executions: {
        create: vi.fn().mockResolvedValue({}),
      },
    } as any;

    const handler = new WebhookTriggerHandler(mockStore);
    const result = await handler.handle({ triggerId, signature, body, rawBody });

    expect(result.execution_id).toBeDefined();
    expect(mockStore.executions.create).toHaveBeenCalled();
  });

  it('rejects invalid signature with 401', async () => {
    const triggerId = uniqueTriggerId();
    const mockStore = {
      triggers: {
        getById: vi.fn().mockResolvedValue({
          id: triggerId,
          workflow_id: 'workflow-1',
          enabled: true,
          config: { secret: 'test-secret' },
        }),
      },
    } as any;

    const handler = new WebhookTriggerHandler(mockStore);
    const body = { data: 'test' };
    const rawBody = JSON.stringify(body);
    // Use a same-length fake hash so timingSafeEqual doesn't throw on buffer length mismatch
    const fakeHash = '0'.repeat(64);

    await expect(
      handler.handle({ triggerId, signature: `sha256=${fakeHash}`, body, rawBody })
    ).rejects.toThrow('Invalid webhook signature');
  });

  it('returns 404 for unknown trigger', async () => {
    const mockStore = {
      triggers: {
        getById: vi.fn().mockResolvedValue(null),
      },
    } as any;

    const handler = new WebhookTriggerHandler(mockStore);

    await expect(
      handler.handle({ triggerId: 'unknown-trigger-xyz', signature: null, body: {}, rawBody: '{}' })
    ).rejects.toThrow('trigger');
  });

  it('enforces rate limit of 60 events per minute', async () => {
    const triggerId = uniqueTriggerId();
    const mockStore = {
      triggers: {
        getById: vi.fn().mockResolvedValue({
          id: triggerId,
          workflow_id: 'workflow-1',
          enabled: true,
          config: { secret: 'test-secret' },
        }),
      },
      executions: {
        create: vi.fn().mockResolvedValue({}),
      },
    } as any;

    const handler = new WebhookTriggerHandler(mockStore);
    const body = { data: 'test' };
    const rawBody = JSON.stringify(body);
    const signature = `sha256=${createHmac('sha256', 'test-secret').update(rawBody).digest('hex')}`;

    // Fire 60 requests (should all succeed)
    for (let i = 0; i < 60; i++) {
      await handler.handle({ triggerId, signature, body, rawBody });
    }

    // 61st should be rate limited
    await expect(
      handler.handle({ triggerId, signature, body, rawBody })
    ).rejects.toThrow('Rate limit exceeded');
  });
});
