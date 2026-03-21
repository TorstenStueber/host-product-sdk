/**
 * Host storage adapter tests.
 *
 * Tests for createMemoryStorageAdapter: read/write/clear,
 * missing keys, and prefix isolation.
 */

import { describe, it, expect } from 'vitest';
import { createMemoryStorageAdapter } from '@polkadot/host';

describe('createMemoryStorageAdapter', () => {
  // -----------------------------------------------------------------------
  // Basic CRUD
  // -----------------------------------------------------------------------

  it('read returns null for missing keys', async () => {
    const store = createMemoryStorageAdapter();
    const result = await store.read('nonexistent');
    expect(result).toBeNull();
  });

  it('write then read returns the correct value', async () => {
    const store = createMemoryStorageAdapter();
    const data = new Uint8Array([10, 20, 30]);

    await store.write('key1', data);
    const result = await store.read('key1');

    expect(result).toEqual(data);
    expect(result).toBeInstanceOf(Uint8Array);
  });

  it('write overwrites existing value', async () => {
    const store = createMemoryStorageAdapter();

    await store.write('key', new Uint8Array([1]));
    await store.write('key', new Uint8Array([2]));

    const result = await store.read('key');
    expect(result).toEqual(new Uint8Array([2]));
  });

  it('clear removes the key', async () => {
    const store = createMemoryStorageAdapter();

    await store.write('key', new Uint8Array([1, 2, 3]));
    expect(await store.read('key')).not.toBeNull();

    await store.clear('key');
    expect(await store.read('key')).toBeNull();
  });

  it('clear on nonexistent key does not throw', async () => {
    const store = createMemoryStorageAdapter();
    await expect(store.clear('nonexistent')).resolves.toBeUndefined();
  });

  // -----------------------------------------------------------------------
  // Multiple keys
  // -----------------------------------------------------------------------

  it('stores and retrieves multiple independent keys', async () => {
    const store = createMemoryStorageAdapter();

    await store.write('a', new Uint8Array([1]));
    await store.write('b', new Uint8Array([2]));
    await store.write('c', new Uint8Array([3]));

    expect(await store.read('a')).toEqual(new Uint8Array([1]));
    expect(await store.read('b')).toEqual(new Uint8Array([2]));
    expect(await store.read('c')).toEqual(new Uint8Array([3]));
  });

  it('clearing one key does not affect others', async () => {
    const store = createMemoryStorageAdapter();

    await store.write('keep', new Uint8Array([100]));
    await store.write('remove', new Uint8Array([200]));

    await store.clear('remove');

    expect(await store.read('keep')).toEqual(new Uint8Array([100]));
    expect(await store.read('remove')).toBeNull();
  });

  // -----------------------------------------------------------------------
  // Initial data
  // -----------------------------------------------------------------------

  it('accepts initial data in constructor', async () => {
    const store = createMemoryStorageAdapter({
      preloaded: new Uint8Array([42]),
    });

    const result = await store.read('preloaded');
    expect(result).toEqual(new Uint8Array([42]));
  });

  // -----------------------------------------------------------------------
  // Prefix isolation (two adapters do not interfere)
  // -----------------------------------------------------------------------

  it('two separate adapters have isolated storage', async () => {
    const store1 = createMemoryStorageAdapter();
    const store2 = createMemoryStorageAdapter();

    await store1.write('shared_key', new Uint8Array([1]));
    await store2.write('shared_key', new Uint8Array([2]));

    // Each adapter has its own Map, so values should differ
    expect(await store1.read('shared_key')).toEqual(new Uint8Array([1]));
    expect(await store2.read('shared_key')).toEqual(new Uint8Array([2]));
  });

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------

  it('stores empty Uint8Array', async () => {
    const store = createMemoryStorageAdapter();

    await store.write('empty', new Uint8Array([]));
    const result = await store.read('empty');

    expect(result).toEqual(new Uint8Array([]));
    expect(result).not.toBeNull();
  });

  it('stores large Uint8Array', async () => {
    const store = createMemoryStorageAdapter();
    const large = new Uint8Array(10_000).fill(0xff);

    await store.write('large', large);
    const result = await store.read('large');

    expect(result).toEqual(large);
  });
});
