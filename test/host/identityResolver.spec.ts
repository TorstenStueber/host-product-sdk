/**
 * Identity resolver tests.
 *
 * Tests for createIdentityResolver: caching, cache invalidation,
 * concurrent request deduplication, and error handling.
 */

import { describe, it, expect } from 'vitest';
import { createIdentityResolver } from '@polkadot/host';
import type { IdentityProvider, ResolvedIdentity } from '@polkadot/host';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeIdentity(name: string): ResolvedIdentity {
  return {
    liteUsername: name.toLowerCase(),
    fullUsername: name,
  };
}

function mockProvider(results: Record<string, ResolvedIdentity | undefined>): IdentityProvider & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async getIdentity(accountIdHex: string) {
      calls.push(accountIdHex);
      return results[accountIdHex];
    },
  };
}

function delayedProvider(
  results: Record<string, ResolvedIdentity | undefined>,
  delayMs: number = 50,
): IdentityProvider & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async getIdentity(accountIdHex: string) {
      calls.push(accountIdHex);
      await new Promise(r => setTimeout(r, delayMs));
      return results[accountIdHex];
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createIdentityResolver', () => {
  // ── Delegation ────────────────────────────────────────────

  it('delegates to the underlying provider', async () => {
    const provider = mockProvider({ '0xaa': makeIdentity('Alice') });
    const resolver = createIdentityResolver(provider);

    const result = await resolver.getIdentity('0xaa');
    expect(result).toEqual(makeIdentity('Alice'));
    expect(provider.calls).toEqual(['0xaa']);
  });

  it('returns undefined for unknown accounts', async () => {
    const provider = mockProvider({});
    const resolver = createIdentityResolver(provider);

    const result = await resolver.getIdentity('0xunknown');
    expect(result).toBeUndefined();
  });

  // ── Caching ───────────────────────────────────────────────

  it('caches resolved identities', async () => {
    const provider = mockProvider({ '0xaa': makeIdentity('Alice') });
    const resolver = createIdentityResolver(provider);

    await resolver.getIdentity('0xaa');
    await resolver.getIdentity('0xaa');

    expect(provider.calls).toEqual(['0xaa']); // Only one call
  });

  it('caches undefined results', async () => {
    const provider = mockProvider({});
    const resolver = createIdentityResolver(provider);

    await resolver.getIdentity('0xmissing');
    await resolver.getIdentity('0xmissing');

    expect(provider.calls).toEqual(['0xmissing']); // Only one call
  });

  it('caches different accounts independently', async () => {
    const provider = mockProvider({
      '0xaa': makeIdentity('Alice'),
      '0xbb': makeIdentity('Bob'),
    });
    const resolver = createIdentityResolver(provider);

    await resolver.getIdentity('0xaa');
    await resolver.getIdentity('0xbb');
    await resolver.getIdentity('0xaa');

    expect(provider.calls).toEqual(['0xaa', '0xbb']);
  });

  // ── Cache invalidation ────────────────────────────────────

  it('invalidate re-queries the provider', async () => {
    const provider = mockProvider({ '0xaa': makeIdentity('Alice') });
    const resolver = createIdentityResolver(provider);

    await resolver.getIdentity('0xaa');
    resolver.invalidate('0xaa');
    await resolver.getIdentity('0xaa');

    expect(provider.calls).toEqual(['0xaa', '0xaa']);
  });

  it('invalidateAll clears the entire cache', async () => {
    const provider = mockProvider({
      '0xaa': makeIdentity('Alice'),
      '0xbb': makeIdentity('Bob'),
    });
    const resolver = createIdentityResolver(provider);

    await resolver.getIdentity('0xaa');
    await resolver.getIdentity('0xbb');
    resolver.invalidateAll();
    await resolver.getIdentity('0xaa');
    await resolver.getIdentity('0xbb');

    expect(provider.calls).toEqual(['0xaa', '0xbb', '0xaa', '0xbb']);
  });

  // ── Concurrent request deduplication ──────────────────────

  it('deduplicates concurrent requests for the same account', async () => {
    const provider = delayedProvider({ '0xaa': makeIdentity('Alice') }, 50);
    const resolver = createIdentityResolver(provider);

    const [r1, r2] = await Promise.all([resolver.getIdentity('0xaa'), resolver.getIdentity('0xaa')]);

    expect(r1).toEqual(makeIdentity('Alice'));
    expect(r2).toEqual(makeIdentity('Alice'));
    expect(provider.calls).toEqual(['0xaa']); // Only one call
  });

  // ── Error handling ────────────────────────────────────────

  it('propagates provider errors', async () => {
    const provider: IdentityProvider = {
      async getIdentity() {
        throw new Error('network error');
      },
    };
    const resolver = createIdentityResolver(provider);

    await expect(resolver.getIdentity('0xaa')).rejects.toThrow('network error');
  });

  it('does not cache failed requests', async () => {
    let callCount = 0;
    const provider: IdentityProvider = {
      async getIdentity() {
        callCount++;
        if (callCount === 1) throw new Error('transient error');
        return makeIdentity('Alice');
      },
    };
    const resolver = createIdentityResolver(provider);

    await expect(resolver.getIdentity('0xaa')).rejects.toThrow('transient error');
    const result = await resolver.getIdentity('0xaa');
    expect(result).toEqual(makeIdentity('Alice'));
    expect(callCount).toBe(2);
  });
});
