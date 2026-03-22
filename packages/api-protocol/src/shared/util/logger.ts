/**
 * Minimal logger interface and default implementation.
 */

export type Logger = Record<'info' | 'warn' | 'error' | 'log', (...args: unknown[]) => void> & {
  /** Derive a child logger that prepends `prefix` to every message. */
  withPrefix(prefix: string): Logger;
};

/**
 * Create a logger that writes to the global `console`.
 *
 * @param msgPrefix - Optional prefix prepended to every log line
 *   (e.g. `"[Transport]"`).
 */
export function createDefaultLogger(msgPrefix?: string): Logger {
  const prefix = msgPrefix ? `[${msgPrefix}]` : '';
  return {
    info: (...args) => console.info(prefix, ...args),
    error: (...args) => console.error(prefix, ...args),
    warn: (...args) => console.warn(prefix, ...args),
    log: (...args) => console.log(prefix, ...args),
    withPrefix: (newPrefix: string) => createDefaultLogger(newPrefix),
  };
}
