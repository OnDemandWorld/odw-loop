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
    /** Unix seconds from x-loop-timestamp (audit #65 replay protection). */
    timestamp?: string | null;
  }): Promise<{ execution_id: string; workflow_id: string }> {
    // Find the trigger. Disabled triggers report the same 404 as missing ones
    // so unauthenticated callers cannot enumerate valid trigger ids.
    const trigger = await this.store.triggers.getById(params.triggerId);
    if (!trigger || !trigger.enabled) throw new NotFoundError('trigger', params.triggerId);

    const config = trigger.config as { secret?: string; require_timestamp?: boolean };

    // Verify HMAC signature. Mandatory when the trigger has a secret —
    // omitting the header must not bypass verification (tsd §11.6).
    // Triggers without a secret accept unsigned events.
    if (config.secret) {
      if (!params.signature) {
        throw new AuthenticationError('AUTH_INVALID_TOKEN', 'Missing webhook signature');
      }
      // Audit #65 (TSD §11.6 replay protection): triggers opted into
      // require_timestamp sign `${unixSeconds}.${rawBody}` and must present a
      // fresh x-loop-timestamp (±5 min). Opt-in keeps existing senders working;
      // captured requests can no longer be replayed indefinitely on opted-in
      // triggers.
      let signedPayload = params.rawBody;
      if (config.require_timestamp) {
        if (!params.timestamp) {
          throw new AuthenticationError('AUTH_INVALID_TOKEN', 'Missing webhook timestamp (x-loop-timestamp)');
        }
        const ts = Number(params.timestamp);
        if (!Number.isFinite(ts) || Math.abs(Date.now() - ts * 1000) > 5 * 60_000) {
          throw new AuthenticationError('AUTH_INVALID_TOKEN', 'Webhook timestamp outside the 5-minute window');
        }
        signedPayload = `${params.timestamp}.${params.rawBody}`;
      }
      const expected = Buffer.from(
        `sha256=${createHmac('sha256', config.secret).update(signedPayload).digest('hex')}`,
      );
      const provided = Buffer.from(params.signature);
      if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
        throw new AuthenticationError('AUTH_INVALID_TOKEN', 'Invalid webhook signature');
      }
    }

    // Rate limit check
    if (!this.checkRateLimit(params.triggerId)) {
      throw new AuthenticationError('RATE_LIMIT_EXCEEDED', 'Rate limit exceeded (60 events/min)');
    }

    // Create execution
    const executionId = randomUUID();
    // Snapshot the workflow's current version so replay resolves the same
    // definition that actually runs.
    let workflowVersion = 1;
    try {
      const workflow = await this.store.workflows.getById(trigger.workflow_id);
      if (workflow) {
        // Archived workflows must not be triggerable — report the same 404
        // as a disabled trigger so callers cannot probe workflow state.
        if (workflow.status === 'archived') {
          logger.warn({ triggerId: params.triggerId, workflowId: trigger.workflow_id }, 'Webhook trigger skipped: workflow is archived');
          throw new NotFoundError('trigger', params.triggerId);
        }
        workflowVersion = workflow.version;
      }
    } catch (err) {
      if (err instanceof NotFoundError) throw err;
      logger.warn({ workflowId: trigger.workflow_id }, 'Failed to read workflow version, defaulting to 1');
    }
    await this.store.executions.create({
      id: executionId,
      workflow_id: trigger.workflow_id,
      workflow_version: workflowVersion,
      trigger_type: 'webhook',
      trigger_payload: params.body as Record<string, unknown>,
    });

    logger.info({ triggerId: params.triggerId, executionId }, 'Webhook trigger fired');
    return { execution_id: executionId, workflow_id: trigger.workflow_id };
  }

  private checkRateLimit(triggerId: string): boolean {
    const now = Date.now();
    // Long-lived map hygiene: drop fully-expired buckets once the map grows,
    // so deleted triggers do not leak entries forever.
    if (rateLimitBuckets.size > 1_000) {
      for (const [id, times] of rateLimitBuckets) {
        if (times.every((t) => now - t >= RATE_LIMIT_WINDOW_MS)) rateLimitBuckets.delete(id);
      }
    }
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
