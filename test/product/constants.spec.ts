/**
 * Product constants tests.
 *
 * Tests for WellKnownChain and SpektrExtensionName.
 */

import { describe, it, expect } from 'vitest';
import { WellKnownChain, SpektrExtensionName } from '@polkadot/product';

describe('WellKnownChain', () => {
  it('is a non-empty object', () => {
    expect(typeof WellKnownChain).toBe('object');
    expect(Object.keys(WellKnownChain).length).toBeGreaterThan(0);
  });

  it('has polkadotRelay chain', () => {
    expect(WellKnownChain.polkadotRelay).toBeDefined();
    expect(typeof WellKnownChain.polkadotRelay).toBe('string');
    expect(WellKnownChain.polkadotRelay.startsWith('0x')).toBe(true);
  });

  it('has polkadotAssetHub chain', () => {
    expect(WellKnownChain.polkadotAssetHub).toBeDefined();
    expect(WellKnownChain.polkadotAssetHub.startsWith('0x')).toBe(true);
  });

  it('has kusamaRelay chain', () => {
    expect(WellKnownChain.kusamaRelay).toBeDefined();
    expect(WellKnownChain.kusamaRelay.startsWith('0x')).toBe(true);
  });

  it('has kusamaAssetHub chain', () => {
    expect(WellKnownChain.kusamaAssetHub).toBeDefined();
    expect(WellKnownChain.kusamaAssetHub.startsWith('0x')).toBe(true);
  });

  it('has westendRelay chain', () => {
    expect(WellKnownChain.westendRelay).toBeDefined();
    expect(WellKnownChain.westendRelay.startsWith('0x')).toBe(true);
  });

  it('has westendAssetHub chain', () => {
    expect(WellKnownChain.westendAssetHub).toBeDefined();
    expect(WellKnownChain.westendAssetHub.startsWith('0x')).toBe(true);
  });

  it('has rococo chain', () => {
    expect(WellKnownChain.rococo).toBeDefined();
    expect(WellKnownChain.rococo.startsWith('0x')).toBe(true);
  });

  it('all chain hashes are unique', () => {
    const hashes = Object.values(WellKnownChain);
    const uniqueHashes = new Set(hashes);
    expect(uniqueHashes.size).toBe(hashes.length);
  });

  it('all chain hashes are valid hex strings (0x-prefixed, 66 chars)', () => {
    for (const [name, hash] of Object.entries(WellKnownChain)) {
      expect(hash.startsWith('0x'), `${name} should start with 0x`).toBe(true);
      // Genesis hashes are 32 bytes = 64 hex chars + '0x' = 66 chars
      expect(hash.length, `${name} hash should be 66 chars`).toBe(66);
      expect(/^0x[0-9a-f]{64}$/.test(hash), `${name} hash should be valid lowercase hex`).toBe(true);
    }
  });

  it('has expected number of chains (7)', () => {
    expect(Object.keys(WellKnownChain)).toHaveLength(7);
  });
});

describe('SpektrExtensionName', () => {
  it('is set to "spektr"', () => {
    expect(SpektrExtensionName).toBe('spektr');
  });

  it('is a string', () => {
    expect(typeof SpektrExtensionName).toBe('string');
  });
});
