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
    // Audit #110: fail loudly instead of reporting success for mail that was
    // never sent — wiring this stub must not silently drop notifications.
    logger.warn({ to, subject }, 'Email notification requested but SMTP is not implemented');
    throw new Error('EmailNotifier: SMTP sending is not implemented');
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
  // Audit #111: per-item due timestamps instead of an inline backoff sleep —
  // one failing item no longer head-of-line-blocks the whole queue.
  private queue: Array<{ fn: () => Promise<void>; retries: number; due: number }> = [];
  private draining = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  enqueue(fn: () => Promise<void>): void {
    this.queue.push({ fn, retries: 0, due: Date.now() });
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    const BACKOFF = [5_000, 30_000, 300_000, 1_800_000]; // 5s, 30s, 5min, 30min
    try {
      for (;;) {
        const now = Date.now();
        const idx = this.queue.findIndex((i) => i.due <= now);
        if (idx === -1) {
          if (this.queue.length === 0) return;
          // Nothing due yet — schedule a wake-up instead of blocking.
          const next = Math.min(...this.queue.map((i) => i.due));
          this.timer = setTimeout(() => void this.drain(), Math.max(0, next - Date.now()));
          if (typeof this.timer.unref === 'function') this.timer.unref();
          return;
        }
        const item = this.queue.splice(idx, 1)[0]!;
        try {
          await item.fn();
        } catch {
          if (item.retries < 4) {
            const delay = BACKOFF[item.retries] ?? BACKOFF[BACKOFF.length - 1]!;
            item.retries++;
            item.due = Date.now() + delay;
            this.queue.push(item);
          } else {
            logger.error('Notification dropped after 4 retries');
          }
        }
      }
    } finally {
      this.draining = false;
    }
  }
}
