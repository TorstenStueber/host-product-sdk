/**
 * Token-bucket rate limiter.
 *
 * Supports two strategies:
 * - `queue`: queues excess requests and processes them when tokens refill.
 * - `drop`: immediately rejects excess requests.
 *
 * Ported from triangle-js-sdks host-container/rateLimiter.ts.
 */

export const RATE_LIMITED_MESSAGE = 'Request rate limited';

export type RateLimiterConfig = {
  maxRequestsPerInterval: number;
  intervalMs: number;
  maxQueuedRequests: number;
};

export type RateLimiterStrategy = 'queue' | 'drop';

export type CreateRateLimiterConfig = RateLimiterConfig & {
  strategy: RateLimiterStrategy;
  onDrop?(): unknown;
};

type QueuedTask<T = unknown> = {
  execute: () => T | Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
};

type TokenBucketState = {
  remainingTokens: number;
  lastRefillTimestamp: number;
  queue: QueuedTask<unknown>[];
  timerId: ReturnType<typeof setTimeout> | undefined;
};

export type RateLimiter = {
  schedule<T>(execute: () => T | Promise<T>): Promise<T>;
  destroy(): void;
};

function createRateLimitError(onDrop?: () => unknown): unknown {
  return onDrop?.() ?? new Error(RATE_LIMITED_MESSAGE);
}

function createQueueStrategy(config: CreateRateLimiterConfig): RateLimiter {
  const state: TokenBucketState = {
    remainingTokens: config.maxRequestsPerInterval,
    lastRefillTimestamp: Date.now(),
    queue: [],
    timerId: undefined,
  };

  function refillTokens(): void {
    const now = Date.now();
    const elapsed = now - state.lastRefillTimestamp;
    if (elapsed <= 0) return;
    if (elapsed >= config.intervalMs) {
      state.remainingTokens = config.maxRequestsPerInterval;
      state.lastRefillTimestamp = now;
    }
  }

  function processQueue(): void {
    state.timerId = undefined;
    refillTokens();

    while (state.remainingTokens > 0 && state.queue.length > 0) {
      const task = state.queue.shift()!;
      state.remainingTokens -= 1;

      try {
        const result = task.execute();
        if (result != null && typeof (result as Promise<unknown>).then === 'function') {
          (result as Promise<unknown>).then(task.resolve).catch(task.reject);
        } else {
          task.resolve(result);
        }
      } catch (error) {
        task.reject(error);
      }
    }

    if (state.queue.length > 0) {
      state.timerId = setTimeout(processQueue, Math.floor(config.intervalMs / 2));
    }
  }

  function ensureProcessingScheduled(): void {
    if (state.timerId !== undefined) return;
    state.timerId = setTimeout(processQueue, Math.floor(config.intervalMs / 2));
  }

  function schedule<T>(execute: () => T | Promise<T>): Promise<T> {
    refillTokens();

    if (state.remainingTokens > 0 && state.queue.length === 0) {
      state.remainingTokens -= 1;
      try {
        const result = execute();
        if (result != null && typeof (result as Promise<T>).then === 'function') {
          return result as Promise<T>;
        }
        return Promise.resolve(result as T);
      } catch (error) {
        return Promise.reject(error);
      }
    }

    if (state.queue.length >= config.maxQueuedRequests) {
      return Promise.reject(createRateLimitError(config.onDrop));
    }

    return new Promise<T>((resolve, reject) => {
      state.queue.push({
        execute: execute as () => unknown | Promise<unknown>,
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      ensureProcessingScheduled();
    });
  }

  function destroy(): void {
    if (state.timerId !== undefined) {
      clearTimeout(state.timerId);
      state.timerId = undefined;
    }
    while (state.queue.length > 0) {
      const task = state.queue.shift()!;
      task.reject(createRateLimitError(config.onDrop));
    }
  }

  return { schedule, destroy };
}

function createDropStrategy(config: CreateRateLimiterConfig): RateLimiter {
  const state = {
    remainingTokens: config.maxRequestsPerInterval,
    lastRefillTimestamp: Date.now(),
  };

  const refillTokens = (): void => {
    const now = Date.now();
    const elapsed = now - state.lastRefillTimestamp;
    if (elapsed >= config.intervalMs) {
      state.remainingTokens = config.maxRequestsPerInterval;
      state.lastRefillTimestamp = now;
    }
  };

  const schedule = <T>(execute: () => T | Promise<T>): Promise<T> => {
    refillTokens();
    if (state.remainingTokens > 0) {
      state.remainingTokens -= 1;
      try {
        const result = execute();
        if (result != null && typeof (result as Promise<T>).then === 'function') {
          return result as Promise<T>;
        }
        return Promise.resolve(result as T);
      } catch (error) {
        return Promise.reject(error);
      }
    }
    return Promise.reject(createRateLimitError(config.onDrop));
  };

  return {
    schedule,
    destroy: () => {
      /* no-op: drop strategy has no timers or queue */
    },
  };
}

export function createRateLimiter(config: CreateRateLimiterConfig): RateLimiter {
  if (config.strategy === 'queue') {
    return createQueueStrategy(config);
  }
  return createDropStrategy(config);
}
