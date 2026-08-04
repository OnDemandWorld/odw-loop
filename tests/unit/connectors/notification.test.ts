import { describe, it, expect, vi } from 'vitest';
import { createHmac } from 'node:crypto';

// Capture outbound requests made by the notifier.
const sent: Array<{ url: string; options: Record<string, unknown> }> = [];
vi.mock('undici', () => ({
  request: vi.fn(async (url: string, options: Record<string, unknown>) => {
    sent.push({ url, options });
    return { statusCode: 200 };
  }),
}));

import { WebhookNotifier } from '../../../packages/connectors/src/notification/index';

describe('WebhookNotifier', () => {
  it('signs the raw body with HMAC-SHA256 matching the inbound trigger verification', async () => {
    sent.length = 0;
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
});
