/**
 * LLM router — tries providers in configured fallback chain order.
 * Each provider has a circuit breaker so a failing provider is skipped quickly.
 */

import { createLogger } from '@loop/observability';
import type { LLMProvider, CompletionRequest, CompletionResponse } from './interface.js';

const logger = createLogger({ name: 'loop:llm:router', component: 'llm' });

interface CircuitState {
  failures: number;
  state: 'closed' | 'open' | 'half_open';
  lastFailure: number;
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
  async complete(req: CompletionRequest, fallbackChain?: string[]): Promise<CompletionResponse> {
    const chain = fallbackChain?.map((name) => this.providers.find((p) => p.name === name)).filter(Boolean) as LLMProvider[] | undefined;
    const providers = chain ?? this.providers;

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
        const result = await provider.complete(req);
        // Success — close circuit
        circuit.failures = 0;
        circuit.state = 'closed';
        return result;
      } catch (err) {
        lastError = err as Error;
        circuit.failures++;
        circuit.lastFailure = Date.now();
        if (circuit.failures >= this.threshold) {
          circuit.state = 'open';
          logger.warn({ provider: provider.name, failures: circuit.failures }, 'Circuit opened');
        }
      }
    }

    throw lastError ?? new Error('No LLM providers available');
  }
}
