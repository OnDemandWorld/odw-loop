/**
 * Network call interceptor — wraps undici to enforce egress policies.
 */

import { request as undiciRequest, type Dispatcher } from 'undici';
import { createLogger } from '@loop/observability';
import type { EgressEngine } from './engine.js';
import { LoopError } from '@loop/types';

const logger = createLogger({ name: 'loop:egress:interceptor', component: 'egress' });

export class EgressInterceptor {
  constructor(private engine: EgressEngine) {}

  /** Make an HTTP request that is subject to egress policy. */
  async request(url: string, opts?: Dispatcher.RequestOptions) {
    const decision = await this.engine.evaluate(url);
    if (!decision.allowed) {
      logger.warn({ url, reason: decision.reason }, 'Egress blocked');
      throw new LoopError('NODE_EGRESS_BLOCKED', `Egress blocked: ${decision.reason}`, 403);
    }
    return undiciRequest(url, opts);
  }
}
