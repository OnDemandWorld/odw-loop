/**
 * LLM router — tries providers in configured fallback chain order.
 * Each provider has a circuit breaker so a failing provider is skipped quickly.
 */

import { createLogger } from '@loop/observability';
import { LoopError } from '@loop/types';
import type { LLMProvider, CompletionRequest, CompletionResponse, EmbeddingRequest, EmbeddingResponse, ProviderIO } from './interface.js';

const logger = createLogger({ name: 'loop:llm:router', component: 'llm' });

interface CircuitState {
  failures: number;
  state: 'closed' | 'open' | 'half_open';
  lastFailure: number;
}

/** Public per-provider status for the providers API endpoint. */
export interface ProviderStatus {
  name: string;
  defaultModel?: string;
  circuit: CircuitState['state'];
  failures: number;
}

export class LLMRouter {
  private circuits = new Map<string, CircuitState>();
  private readonly threshold = 5;
  private readonly cooldownMs = 30_000;

  constructor(private providers: LLMProvider[]) {
    for (const p of providers) {
      this.circuits.set(p.name, { failures: 0, state: 'closed', lastFailure: 0 });
    }
  }

  /** Try each provider in order, skipping those whose circuit breaker is open. */
  async complete(req: CompletionRequest, fallbackChain?: string[], io?: ProviderIO): Promise<CompletionResponse> {
    const providers = this.resolveChain(fallbackChain);

    let lastError: Error | undefined;
    for (const provider of providers) {
      const circuit = this.circuits.get(provider.name);
      if (!circuit) continue;

      // Check circuit state
      if (circuit.state === 'open') {
        if (Date.now() - circuit.lastFailure > this.cooldownMs) {
          circuit.state = 'half_open';
        } else {
          logger.debug({ provider: provider.name }, 'Circuit open, skipping');
          continue;
        }
      }

      try {
        // Per-vendor default model: a request without a model name uses the
        // provider's own default (e.g. deepseek → deepseek-chat).
        const effectiveReq: CompletionRequest =
          req.model ? req : { ...req, model: provider.defaultModel ?? 'default' };
        const result = await provider.complete(effectiveReq, io);
        // Success — close circuit
        circuit.failures = 0;
        circuit.state = 'closed';
        return result;
      } catch (err) {
        lastError = err as Error;
        // Audit #52: a node/workflow deadline abort is not a provider outage —
        // stop walking the chain (every remaining provider would be tried with
        // the dead signal and counted as another failure).
        if (io?.signal?.aborted) break;
        // Egress policy denials are permanent product decisions, not outages;
        // counting them opened every circuit in airgap mode and masked
        // NODE_EGRESS_BLOCKED behind 'No LLM providers available'.
        const isPolicyDenial = err instanceof LoopError && err.code === 'NODE_EGRESS_BLOCKED';
        if (!isPolicyDenial) {
          circuit.failures++;
          circuit.lastFailure = Date.now();
          if (circuit.failures >= this.threshold) {
            circuit.state = 'open';
            logger.warn({ provider: provider.name, failures: circuit.failures }, 'Circuit opened');
          }
        }
      }
    }

    throw lastError ?? new Error('No LLM providers available');
  }

  /** Embed via the first provider in the (resolved) chain that supports it. */
  async embed(req: EmbeddingRequest, fallbackChain?: string[], io?: ProviderIO): Promise<EmbeddingResponse> {
    const providers = this.resolveChain(fallbackChain);
    let lastError: Error | undefined;
    for (const provider of providers) {
      if (!provider.embed) continue;
      try {
        return await provider.embed(req, io);
      } catch (err) {
        lastError = err as Error;
      }
    }
    throw lastError ?? new Error('No LLM provider supports embeddings');
  }

  /** Registered provider names, in configured order. */
  listProviders(): ProviderStatus[] {
    return this.providers.map((p) => {
      const circuit = this.circuits.get(p.name);
      return {
        name: p.name,
        ...(p.defaultModel !== undefined ? { defaultModel: p.defaultModel } : {}),
        circuit: circuit?.state ?? 'closed',
        failures: circuit?.failures ?? 0,
      };
    });
  }

  /**
   * Resolve an explicit chain to registered providers. An unknown name is an
   * immediate, explicit error — silently ignoring it used to mean the request
   * hit an unintended fallback vendor.
   */
  private resolveChain(fallbackChain?: string[]): LLMProvider[] {
    if (!fallbackChain || fallbackChain.length === 0) return this.providers;
    const unknown = fallbackChain.filter((name) => !this.providers.some((p) => p.name === name));
    if (unknown.length > 0) {
      throw new Error(`Unknown LLM provider(s): ${unknown.join(', ')}. Configured: ${this.providers.map((p) => p.name).join(', ')}`);
    }
    return fallbackChain
      .map((name) => this.providers.find((p) => p.name === name))
      .filter(Boolean) as LLMProvider[];
  }
}
