/**
 * Retry logic with exponential, linear, and fixed backoff (§6.3).
 */

export interface RetryConfig {
  max_attempts: number;
  backoff: 'exponential' | 'linear' | 'fixed';
  initial_delay_ms: number;
  jitter?: boolean; // ±10% random variation
}

/** Calculate delay for a given attempt and backoff strategy. */
export function calculateBackoff(strategy: string, baseDelay: number, attempt: number, jitter = false): number {
  let delay: number;
  switch (strategy) {
    case 'exponential':
      delay = baseDelay * Math.pow(2, attempt);
      break;
    case 'linear':
      delay = baseDelay * (attempt + 1);
      break;
    case 'fixed':
      delay = baseDelay;
      break;
    default:
      delay = baseDelay;
  }

  if (jitter) {
    const variation = delay * 0.1;
    delay += (Math.random() * 2 - 1) * variation;
  }

  return Math.max(0, Math.round(delay));
}

/** Sleep for a given number of milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Execute a function with retry logic. */
export async function executeWithRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig,
  onRetry?: (attempt: number, error: Error) => void,
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= config.max_attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err as Error;
      if (attempt < config.max_attempts) {
        const delay = calculateBackoff(config.backoff, config.initial_delay_ms, attempt, config.jitter);
        onRetry?.(attempt + 1, lastError);
        await sleep(delay);
      }
    }
  }

  throw lastError!;
}
