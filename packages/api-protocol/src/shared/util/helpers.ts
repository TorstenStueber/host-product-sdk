/**
 * Miscellaneous helper utilities ported from triangle-js-sdks.
 */

/**
 * Return a promise that resolves after `ttl` milliseconds.
 */
export function delay(ttl: number): Promise<void> {
  return new Promise<void>(resolve => setTimeout(resolve, ttl));
}

/**
 * Ponyfill for `Promise.withResolvers()` (available natively from ES2024).
 */
export function promiseWithResolvers<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * Build an action string from a method name and a suffix.
 *
 * Example: `composeAction('host_account_get', 'request')` produces
 * `'host_account_get_request'`.
 */
export function composeAction<M extends string, S extends string>(method: M, suffix: S): `${M}_${S}` {
  return `${method}_${suffix}`;
}

/**
 * Extract a human-readable message from an unknown thrown value.
 */
export function extractErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  if (err) {
    return String(err);
  }
  return 'Unknown error occurred.';
}
