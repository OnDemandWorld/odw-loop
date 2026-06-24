/**
 * Notification connectors — Slack, Email (SMTP), and generic webhook (§9.6).
 */

import { request } from 'undici';
import { createHash } from 'node:crypto';
import { createLogger } from '@loop/observability';

const logger = createLogger({ name: 'loop:connectors:notification', component: 'connectors' });

// ─── Slack ────────────────────────────────────────────────────────────────────

export class SlackNotifier {
  constructor(private token: string) {}

  async send(channel: string, text: string): Promise<void> {
    await request('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify({ channel, text }),
    });
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
  constructor(private url: string, private secret: string) {}

  async send(payload: unknown): Promise<void> {
    const body = JSON.stringify(payload);
    const signature = createHash('sha256').update(this.secret + body).digest('hex');
    await request(this.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-loop-signature': `sha256=${signature}`,
      },
      body,
    });
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
