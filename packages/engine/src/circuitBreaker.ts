/**
 * Circuit breaker pattern for external service calls (§6.5).
 */

import { createLogger } from '@loop/observability';
import { metricsRegistry } from '@loop/observability';

const logger = createLogger({ name: 'loop:engine:circuitBreaker', component: 'engine' });

export type CircuitBreakerState = 'closed' | 'open' | 'half_open';

export class CircuitBreaker {
  private state: CircuitBreakerState = 'closed';
  private failures = 0;
  private lastFailure = 0;
  private readonly metrics = metricsRegistry();

  constructor(
    private name: string,
    private threshold = 5,
    private cooldownMs = 30_000,
  ) {}

  /** Execute a function through the circuit breaker. */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      if (Date.now() - this.lastFailure > this.cooldownMs) {
        this.state = 'half_open';
        logger.info({ name: this.name }, 'Circuit breaker → half_open');
        this.updateMetric();
      } else {
        throw new Error(`Circuit breaker '${this.name}' is open`);
      }
    }

    try {
      const result = await fn();
      if (this.state === 'half_open') {
        this.state = 'closed';
        this.failures = 0;
        logger.info({ name: this.name }, 'Circuit breaker → closed');
        this.updateMetric();
      }
      return result;
    } catch (err) {
      this.failures++;
      this.lastFailure = Date.now();
      if (this.failures >= this.threshold) {
        this.state = 'open';
        logger.warn({ name: this.name, failures: this.failures }, 'Circuit breaker → open');
        this.updateMetric();
      }
      throw err;
    }
  }

  getState(): CircuitBreakerState {
    return this.state;
  }

  reset(): void {
    this.state = 'closed';
    this.failures = 0;
    this.lastFailure = 0;
    this.updateMetric();
  }

  private updateMetric(): void {
    const stateValue = this.state === 'closed' ? 0 : this.state === 'open' ? 1 : 2;
    this.metrics.circuitBreakerState.set({ connector_type: this.name }, stateValue);
  }
}
