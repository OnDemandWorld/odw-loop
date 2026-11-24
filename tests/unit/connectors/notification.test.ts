import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';

// Capture outbound requests made by the notifier; response is configurable.
const sent: Array<{ url: string; options: Record<string, unknown> }> = [];
const mockState = vi.hoisted(() => ({ status: 200, body: '{"ok":true}' }));
vi.mock('undici', () => ({
  request: vi.fn(async (url: string, options: Record<string, unknown>) => {
    sent.push({ url, options });
    return { statusCode: mockState.status, body: { text: async () => mockState.body } };
  }),
}));

import { WebhookNotifier, SlackNotifier } from '../../../packages/connectors/src/notification/index';

beforeEach(() => {
  sent.length = 0;
  mockState.status = 200;
  mockState.body = '{"ok":true}';
});

describe('WebhookNotifier', () => {
  it('signs the raw body with HMAC-SHA256 matching the inbound trigger verification', async () => {
    const secret = 'shared-webhook-secret';
    const payload = { meeting_id: 'm-1', action_items: ['follow up'] };

    const notifier = new WebhookNotifier('http://downstream/webhooks/t-1', secret);
    await notifier.send(payload);

    expect(sent).toHaveLength(1);
    const body = sent[0].options.body as string;
    const headers = sent[0].options.headers as Record<string, string>;

    // The receiver (WebhookTriggerHandler) computes
    // sha256=HMAC_SHA256(secret, rawBody) — the outbound signature must match.
    const expected = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
    expect(headers['x-loop-signature']).toBe(expected);
    expect(JSON.parse(body)).toEqual(payload);
  });

  it('audit #37: HTTP failures throw so the queue retries (no false success)', async () => {
    mockState.status = 500;
    mockState.body = 'receiver exploded';
    const notifier = new WebhookNotifier('http://downstream/webhooks/t-1', 's3cret-secret-value');
    await expect(notifier.send({ x: 1 })).rejects.toThrow(/HTTP 500/);
  });

  it('audit #36: a denying egress gate stops the call before any request', async () => {
    const gate = {
      async check(): Promise<void> {
        throw new Error('Egress blocked: airgap');
      },
    };
    const notifier = new WebhookNotifier('http://downstream/webhooks/t-1', 's3cret-secret-value', gate);
    await expect(notifier.send({ x: 1 })).rejects.toThrow(/Egress blocked/);
    expect(sent).toHaveLength(0);
  });
});

describe('SlackNotifier', () => {
  it('audit #35: {ok:false} on HTTP 200 throws (invalid token/channel)', async () => {
    mockState.status = 200;
    mockState.body = '{"ok":false,"error":"invalid_auth"}';
    const notifier = new SlackNotifier('xoxb-bad-token');
    await expect(notifier.send('#general', 'hello')).rejects.toThrow(/invalid_auth/);
  });

  it('audit #35: ok:true resolves', async () => {
    const notifier = new SlackNotifier('xoxb-good-token');
    await expect(notifier.send('#general', 'hello')).resolves.toBeUndefined();
  });

  it('audit #36: a denying egress gate stops the call before any request', async () => {
    const gate = {
      async check(): Promise<void> {
        throw new Error('Egress blocked: airgap');
      },
    };
    const notifier = new SlackNotifier('xoxb-token', gate);
    await expect(notifier.send('#general', 'hello')).rejects.toThrow(/Egress blocked/);
    expect(sent).toHaveLength(0);
  });
});

describe('EmailNotifier stub (audit #110)', () => {
  it('throws instead of silently reporting success', async () => {
    const { EmailNotifier } = await import('../../../packages/connectors/src/notification/index');
    const notifier = new EmailNotifier({ host: 'smtp.test', port: 587, user: 'u', pass: 'p' });
    await expect(notifier.send('to@test', 'subject', 'body')).rejects.toThrow(/not implemented/);
  });
});

describe('NotificationQueue — no head-of-line blocking (audit #111)', () => {
  it('a failing item does not delay ready items behind it', async () => {
    const { NotificationQueue } = await import('../../../packages/connectors/src/notification/index');
    const queue = new NotificationQueue();
    let okCalled = false;
    queue.enqueue(async () => {
      throw new Error('always fails');
    });
    queue.enqueue(async () => {
      okCalled = true;
    });
    await new Promise((r) => setTimeout(r, 50));
    // The second item ran immediately — the old inline 5s sleep blocked it.
    expect(okCalled).toBe(true);
  });
});
