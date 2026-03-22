/**
 * Request-ID generation.
 *
 * Each factory has its own independent counter with a prefix
 * (e.g. "h:" for host, "p:" for product) so IDs from both sides
 * never collide on the shared postMessage channel.
 */

export function createIdFactory(prefix: string): () => string {
  let id = 0;
  return () => `${prefix}${++id}`;
}
