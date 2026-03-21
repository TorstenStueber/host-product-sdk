/**
 * Product-side logger singleton.
 *
 * Provides a default console logger that any product code can import
 * directly. Use `setProductLogger()` to swap in a custom implementation
 * (e.g. one that routes messages to a debug UI overlay).
 */

import type { Logger } from '../shared/util/logger.js';
import { createDefaultLogger } from '../shared/util/logger.js';

let current: Logger = createDefaultLogger('Product');

/** The product-side logger singleton. */
export const productLogger: Logger = {
  info: (...args) => current.info(...args),
  warn: (...args) => current.warn(...args),
  error: (...args) => current.error(...args),
  log: (...args) => current.log(...args),
  withPrefix: (prefix: string) => current.withPrefix(prefix),
};

/**
 * Replace the product logger implementation.
 *
 * All existing references to `productLogger` will pick up the new
 * implementation immediately because the singleton delegates through
 * the `current` variable.
 */
export function setProductLogger(logger: Logger): void {
  current = logger;
}
