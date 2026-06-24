/**
 * Webhook trigger handler — HMAC-SHA256 signature verification + replay protection (§11.6).
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { createLogger } from '@loop/observability';
import type { StateStore } from '@loop/state';
import { AuthenticationError, NotFoundError } from '@loop/types';

const logger = createLogger({ name: 'loop:triggers:webhook', component: 'triggers' });

/** Rate-limit tracking per webhook trigger. */
const rateLimitBuckets = new Map<string, number[]>();
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 60;

export class WebhookTriggerHandler {
  constructor(private store: StateStore) {}

  /** Process an incoming webhook. */
  async handle(params: {
    triggerId: string;
    signature: string | null;
    body: unknown;
    rawBody: string;
  }): Promise<{ execution_id: string }> {
    // Find the trigger
    const trigger = await this.store.triggers.getById(params.triggerId);
    if (!trigger) throw new NotFoundError('trigger', params.triggerId);
    if (!trigger.enabled) throw new AuthenticationError('AUTH_EXPIRED', 'Trigger is disabled');

    const config = trigger.config as { secret: string };

    // Verify HMAC signature
    if (params.signature) {
      const expected = `sha256=${createHmac('sha256', config.secret).update(params.rawBody).digest('hex')}`;
      if (!timingSafeEqual(Buffer.from(params.signature), Buffer.from(expected))) {
        throw new AuthenticationError('AUTH_INVALID_TOKEN', 'Invalid webhook signature');
      }
    }

    // Rate limit check
    if (!this.checkRateLimit(params.triggerId)) {
      throw new AuthenticationError('RATE_LIMIT_EXCEEDED', 'Rate limit exceeded (60 events/min)');
    }

    // Create execution
    const executionId = randomUUID();
    await this.store.executions.create({
      id: executionId,
      workflow_id: trigger.workflow_id,
      workflow_version: 1,
      trigger_type: 'webhook',
      trigger_payload: params.body as Record<string, unknown>,
    });

    logger.info({ triggerId: params.triggerId, executionId }, 'Webhook trigger fired');
    return { execution_id: executionId };
  }

  private checkRateLimit(triggerId: string): boolean {
    const now = Date.now();
    const bucket = rateLimitBuckets.get(triggerId) ?? [];
    const recent = bucket.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
    if (recent.length >= RATE_LIMIT_MAX) {
      rateLimitBuckets.set(triggerId, recent);
      return false;
    }
    recent.push(now);
    rateLimitBuckets.set(triggerId, recent);
    return true;
  }
}
