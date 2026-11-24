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
      // Audit #151: provide workflows so the version-snapshot path runs for
      // real (it previously always fell into the catch and defaulted to 1).
      workflows: {
        getById: vi.fn().mockResolvedValue({ id: 'workflow-1', version: 3, status: 'active' }),
      },
    } as any;

    const handler = new WebhookTriggerHandler(mockStore);
    const result = await handler.handle({ triggerId, signature, body, rawBody });

    expect(result.execution_id).toBeDefined();
    expect(mockStore.executions.create).toHaveBeenCalledWith(
      expect.objectContaining({ workflow_version: 3 }),
    );
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

  it('rejects a missing signature when the trigger has a secret (no bypass)', async () => {
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

    await expect(
      handler.handle({ triggerId, signature: null, body: {}, rawBody: '{}' })
    ).rejects.toThrow('Missing webhook signature');
    expect(mockStore.executions.create).not.toHaveBeenCalled();
  });

  it('rejects a wrong-length signature without crashing', async () => {
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

    await expect(
      handler.handle({ triggerId, signature: 'sha256=short', body: {}, rawBody: '{}' })
    ).rejects.toThrow('Invalid webhook signature');
  });

  it('accepts unsigned events for triggers without a secret', async () => {
    const triggerId = uniqueTriggerId();
    const mockStore = {
      triggers: {
        getById: vi.fn().mockResolvedValue({
          id: triggerId,
          workflow_id: 'workflow-1',
          enabled: true,
          config: {},
        }),
      },
      executions: {
        create: vi.fn().mockResolvedValue({}),
      },
    } as any;

    const handler = new WebhookTriggerHandler(mockStore);
    const result = await handler.handle({ triggerId, signature: null, body: { ok: true }, rawBody: '{"ok":true}' });

    expect(result.execution_id).toBeDefined();
    expect(mockStore.executions.create).toHaveBeenCalled();
  });
});

describe('WebhookTriggerHandler — raw-byte HMAC pin (audit #87)', () => {
  function mockStore(triggerId: string, secret: string) {
    return {
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
    } as unknown as ConstructorParameters<typeof WebhookTriggerHandler>[0];
  }

  it('accepts a signature over received bytes that differ from JSON.stringify(body)', async () => {
    const triggerId = uniqueTriggerId();
    const secret = 'test-secret';
    const body = { data: 'test' };
    // Same semantics, different serialization (extra whitespace) — exactly
    // what non-V8 senders (e.g. Python json.dumps) produce.
    const rawBody = '{ "data" : "test" }';
    const signature = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;

    const handler = new WebhookTriggerHandler(mockStore(triggerId, secret));
    const result = await handler.handle({ triggerId, signature, body, rawBody });
    expect(result.execution_id).toBeDefined();
  });

  it('rejects a signature computed over re-serialized JSON when the bytes differ', async () => {
    const triggerId = uniqueTriggerId();
    const secret = 'test-secret';
    const body = { data: 'test' };
    const rawBody = '{ "data" : "test" }';
    // WRONG: signing JSON.stringify(body) instead of the received bytes.
    const signature = `sha256=${createHmac('sha256', secret).update(JSON.stringify(body)).digest('hex')}`;

    const handler = new WebhookTriggerHandler(mockStore(triggerId, secret));
    await expect(handler.handle({ triggerId, signature, body, rawBody })).rejects.toThrow('Invalid webhook signature');
  });
});

describe('WebhookTriggerHandler — timestamp replay protection (audit #65)', () => {
  function storeWithConfig(triggerId: string, config: Record<string, unknown>) {
    return {
      triggers: {
        getById: vi.fn().mockResolvedValue({ id: triggerId, workflow_id: 'workflow-1', enabled: true, config }),
      },
      executions: { create: vi.fn().mockResolvedValue({}) },
    } as unknown as ConstructorParameters<typeof WebhookTriggerHandler>[0];
  }

  it('accepts a fresh timestamp signed into the HMAC', async () => {
    const triggerId = uniqueTriggerId();
    const secret = 'test-secret';
    const rawBody = '{"event":"x"}';
    const ts = String(Math.floor(Date.now() / 1000));
    const signature = `sha256=${createHmac('sha256', secret).update(`${ts}.${rawBody}`).digest('hex')}`;
    const handler = new WebhookTriggerHandler(storeWithConfig(triggerId, { secret, require_timestamp: true }));
    const result = await handler.handle({ triggerId, signature, body: { event: 'x' }, rawBody, timestamp: ts });
    expect(result.execution_id).toBeDefined();
  });

  it('rejects a stale timestamp (>5 min) even with a valid signature', async () => {
    const triggerId = uniqueTriggerId();
    const secret = 'test-secret';
    const rawBody = '{"event":"x"}';
    const ts = String(Math.floor(Date.now() / 1000) - 600);
    const signature = `sha256=${createHmac('sha256', secret).update(`${ts}.${rawBody}`).digest('hex')}`;
    const handler = new WebhookTriggerHandler(storeWithConfig(triggerId, { secret, require_timestamp: true }));
    await expect(handler.handle({ triggerId, signature, body: {}, rawBody, timestamp: ts })).rejects.toThrow(/5-minute window/);
  });

  it('rejects a missing timestamp when required', async () => {
    const triggerId = uniqueTriggerId();
    const secret = 'test-secret';
    const rawBody = '{"event":"x"}';
    const signature = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
    const handler = new WebhookTriggerHandler(storeWithConfig(triggerId, { secret, require_timestamp: true }));
    await expect(handler.handle({ triggerId, signature, body: {}, rawBody, timestamp: null })).rejects.toThrow(/Missing webhook timestamp/);
  });

  it('legacy triggers without require_timestamp keep working unchanged', async () => {
    const triggerId = uniqueTriggerId();
    const secret = 'test-secret';
    const rawBody = '{"event":"x"}';
    const signature = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
    const handler = new WebhookTriggerHandler(storeWithConfig(triggerId, { secret }));
    const result = await handler.handle({ triggerId, signature, body: {}, rawBody });
    expect(result.execution_id).toBeDefined();
  });
});
