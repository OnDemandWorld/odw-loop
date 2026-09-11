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

/** Options controlling when the gate enforces policy evaluation. */
export interface EgressGateOptions {
  /** Kill switch — when true, every outbound call is blocked (fail closed). */
  airgap: boolean;
  /**
   * Decision applied when no egress policies are configured at all. `allow`
   * keeps a fresh deployment usable (the product's whole point is calling the
   * ODW agents over HTTP); set to `deny` (or add a policy) to lock down.
   */
  unconfiguredPolicy: 'allow' | 'deny';
}

/**
 * The single choke point every outbound connector call must pass through.
 *
 * Historically `EgressEngine`/`EgressInterceptor` existed but were never wired
 * into the execution path, so `LOOP_AIRGAP_MODE` and every egress policy were
 * dead config — any workflow node could reach arbitrary hosts (SSRF). Adapters
 * receive the gate via `ExecuteParams.egress` and must `check(url)` before
 * dispatching.
 */
export class EgressGate {
  constructor(
    private engine: EgressEngine,
    private opts: EgressGateOptions,
  ) {}

  /** Throw a 403 `NODE_EGRESS_BLOCKED` error when the URL may not be reached. */
  async check(url: string): Promise<void> {
    if (this.opts.airgap) {
      logger.warn({ url }, 'Egress blocked (airgap mode)');
      throw new LoopError('NODE_EGRESS_BLOCKED', 'Airgap mode is enabled — all outbound network calls are blocked', 403);
    }
    if (!(await this.engine.isConfigured())) {
      if (this.opts.unconfiguredPolicy === 'deny') {
        logger.warn({ url }, 'Egress blocked (no policies configured, default deny)');
        throw new LoopError('NODE_EGRESS_BLOCKED', 'Egress blocked: no egress policies configured and the default policy is deny', 403);
      }
      return;
    }
    const decision = await this.engine.evaluate(url);
    if (!decision.allowed) {
      logger.warn({ url, reason: decision.reason }, 'Egress blocked');
      throw new LoopError('NODE_EGRESS_BLOCKED', `Egress blocked: ${decision.reason}`, 403);
    }
  }
}
