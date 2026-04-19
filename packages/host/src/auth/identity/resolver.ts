/**
 * Identity resolver with caching.
 *
 * Wraps an injected IdentityProvider with an in-memory cache. Resolved
 * identities are cached for the lifetime of the resolver to avoid redundant
 * chain queries. The cache can be explicitly invalidated.
 */

import type { IdentityProvider, ResolvedIdentity } from './chainProvider.js';

export type IdentityResolver = IdentityProvider & {
  /** Invalidate the cache for a specific account. */
  invalidate(accountIdHex: string): void;
  /** Clear the entire cache. */
  invalidateAll(): void;
};

/**
 * Create an identity resolver that caches results from the underlying provider.
 *
 * @param provider - The identity provider to delegate to (e.g. chain query, RPC adapter).
 */
export function createIdentityResolver(provider: IdentityProvider): IdentityResolver {
  const cache = new Map<string, ResolvedIdentity | undefined>();
  const inflight = new Map<string, Promise<ResolvedIdentity | undefined>>();

  return {
    async getIdentity(accountIdHex: string): Promise<ResolvedIdentity | undefined> {
      if (cache.has(accountIdHex)) {
        return cache.get(accountIdHex);
      }

      // Deduplicate concurrent requests for the same account
      const existing = inflight.get(accountIdHex);
      if (existing) {
        return existing;
      }

      const request = provider.getIdentity(accountIdHex).then(
        result => {
          cache.set(accountIdHex, result);
          inflight.delete(accountIdHex);
          return result;
        },
        error => {
          inflight.delete(accountIdHex);
          throw error;
        },
      );

      inflight.set(accountIdHex, request);
      return request;
    },

    invalidate(accountIdHex: string): void {
      cache.delete(accountIdHex);
    },

    invalidateAll(): void {
      cache.clear();
    },
  };
}
