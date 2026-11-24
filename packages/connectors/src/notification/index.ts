/**
 * Notification connectors — Slack, Email (SMTP), and generic webhook (§9.6).
 */

import { request } from 'undici';
import { createHmac } from 'node:crypto';
import { createLogger } from '@loop/observability';

const logger = createLogger({ name: 'loop:connectors:notification', component: 'connectors' });

// ─── Slack ────────────────────────────────────────────────────────────────────

/** Minimal egress gate shape (audit #36) — same contract as ExecuteParams.egress. */
export interface EgressCheck {
  check(url: string): Promise<void>;
}

export class SlackNotifier {
  constructor(private token: string, private egress?: EgressCheck) {}

  async send(channel: string, text: string): Promise<void> {
    const url = 'https://slack.com/api/chat.postMessage';
    // Audit #36: notifications must respect the egress policy (airgap blocks
    // ALL outbound calls, including slack.com).
    await this.egress?.check(url);
    const response = await request(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify({ channel, text }),
    });
    // Audit #35: Slack answers HTTP 200 with {ok:false,error:...} for invalid
    // tokens/channels — drain, parse and throw so the queue can retry.
    const raw = await response.body.text();
    if (response.statusCode >= 400) {
      throw new Error(`Slack notification failed: HTTP ${response.statusCode}: ${raw.slice(0, 200)}`);
    }
    let parsed: { ok?: boolean; error?: string };
    try {
      parsed = JSON.parse(raw) as { ok?: boolean; error?: string };
    } catch {
      throw new Error('Slack notification failed: non-JSON response');
    }
    if (!parsed.ok) {
      throw new Error(`Slack notification failed: ${parsed.error ?? 'unknown error'}`);
    }
  }
}

// ─── Email (SMTP stub — real implementation would use nodemailer) ─────────────

export class EmailNotifier {
  constructor(private config: { host: string; port: number; user: string; pass: string }) {}

  async send(to: string, subject: string, _body: string): Promise<void> {
    // SMTP sending is a developer task; stub for now.
    logger.info({ to, subject }, 'Email notification (stub)');
  }
}

// ─── Generic webhook ──────────────────────────────────────────────────────────

export class WebhookNotifier {
  constructor(private url: string, private secret: string, private egress?: EgressCheck) {}

  async send(payload: unknown): Promise<void> {
    // Audit #36: respect the egress policy before calling the arbitrary URL.
    await this.egress?.check(this.url);
    const body = JSON.stringify(payload);
    // HMAC-SHA256 over the raw body — must match the inbound verification in
    // @loop/triggers WebhookTriggerHandler (tsd §11.6).
    const signature = createHmac('sha256', this.secret).update(body).digest('hex');
    const response = await request(this.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-loop-signature': `sha256=${signature}`,
      },
      body,
    });
    // Audit #37: drain the body (release the socket) and surface HTTP failures
    // so NotificationQueue retries them instead of reporting false success.
    const raw = await response.body.text();
    if (response.statusCode >= 400) {
      throw new Error(`Webhook notification failed: HTTP ${response.statusCode}: ${raw.slice(0, 200)}`);
    }
  }
}

// ─── Notification queue with retry (§8.5) ─────────────────────────────────────

export class NotificationQueue {
  private queue: Array<{ fn: () => Promise<void>; retries: number }> = [];

  enqueue(fn: () => Promise<void>): void {
    this.queue.push({ fn, retries: 0 });
    this.drain().catch((err) => logger.error({ error: String(err) }, 'Queue drain failed'));
  }

  private async drain(): Promise<void> {
    const BACKOFF = [5_000, 30_000, 300_000, 1_800_000]; // 5s, 30s, 5min, 30min
    while (this.queue.length > 0) {
      const item = this.queue.shift()!;
      try {
        await item.fn();
      } catch {
        if (item.retries < 4) {
          const delay = BACKOFF[item.retries] ?? BACKOFF[BACKOFF.length - 1]!;
          await new Promise((r) => setTimeout(r, delay));
          item.retries++;
          this.queue.push(item);
        } else {
          logger.error('Notification dropped after 4 retries');
        }
      }
    }
  }
}
