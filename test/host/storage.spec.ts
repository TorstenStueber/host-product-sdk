/**
 * Host storage adapter tests.
 *
 * Tests for createMemoryStorageAdapter: read/write/clear,
 * missing keys, prefix isolation, and reactive subscriptions.
 */

import { describe, it, expect, vi } from 'vitest';
import { createMemoryStorageAdapter } from '@polkadot/host';

describe('createMemoryStorageAdapter', () => {
  // -----------------------------------------------------------------------
  // Basic CRUD
  // -----------------------------------------------------------------------

  it('read returns undefined for missing keys', async () => {
    const store = createMemoryStorageAdapter();
    const result = await store.read('nonexistent');
    expect(result).toBeUndefined();
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
    expect(await store.read('key')).not.toBeUndefined();

    await store.clear('key');
    expect(await store.read('key')).toBeUndefined();
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
    expect(await store.read('remove')).toBeUndefined();
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
    expect(result).not.toBeUndefined();
  });

  it('stores large Uint8Array', async () => {
    const store = createMemoryStorageAdapter();
    const large = new Uint8Array(10_000).fill(0xff);

    await store.write('large', large);
    const result = await store.read('large');

    expect(result).toEqual(large);
  });

  // -----------------------------------------------------------------------
  // Reactive subscriptions
  // -----------------------------------------------------------------------

  it('subscribe is notified on write', async () => {
    const store = createMemoryStorageAdapter();
    const callback = vi.fn();

    store.subscribe('key', callback);
    await store.write('key', new Uint8Array([1, 2, 3]));

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]));
  });

  it('subscribe is notified with undefined on clear', async () => {
    const store = createMemoryStorageAdapter();
    const callback = vi.fn();

    await store.write('key', new Uint8Array([1]));
    store.subscribe('key', callback);
    await store.clear('key');

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(undefined);
  });

  it('subscribe is not notified for other keys', async () => {
    const store = createMemoryStorageAdapter();
    const callback = vi.fn();

    store.subscribe('key-a', callback);
    await store.write('key-b', new Uint8Array([1]));

    expect(callback).not.toHaveBeenCalled();
  });

  it('multiple subscribers on the same key all fire', async () => {
    const store = createMemoryStorageAdapter();
    const cb1 = vi.fn();
    const cb2 = vi.fn();

    store.subscribe('key', cb1);
    store.subscribe('key', cb2);
    await store.write('key', new Uint8Array([42]));

    expect(cb1).toHaveBeenCalledTimes(1);
    expect(cb2).toHaveBeenCalledTimes(1);
  });

  it('unsubscribe stops notifications', async () => {
    const store = createMemoryStorageAdapter();
    const callback = vi.fn();

    const unsub = store.subscribe('key', callback);
    await store.write('key', new Uint8Array([1]));
    expect(callback).toHaveBeenCalledTimes(1);

    unsub();
    await store.write('key', new Uint8Array([2]));
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('unsubscribe one listener does not affect others', async () => {
    const store = createMemoryStorageAdapter();
    const cb1 = vi.fn();
    const cb2 = vi.fn();

    const unsub1 = store.subscribe('key', cb1);
    store.subscribe('key', cb2);

    unsub1();
    await store.write('key', new Uint8Array([1]));

    expect(cb1).not.toHaveBeenCalled();
    expect(cb2).toHaveBeenCalledTimes(1);
  });

  it('subscribe fires on each write with the latest value', async () => {
    const store = createMemoryStorageAdapter();
    const values: (Uint8Array | undefined)[] = [];

    store.subscribe('key', v => values.push(v));
    await store.write('key', new Uint8Array([1]));
    await store.write('key', new Uint8Array([2]));
    await store.clear('key');
    await store.write('key', new Uint8Array([3]));

    expect(values).toEqual([new Uint8Array([1]), new Uint8Array([2]), undefined, new Uint8Array([3])]);
  });

  it('clear on nonexistent key still notifies subscribers', async () => {
    const store = createMemoryStorageAdapter();
    const callback = vi.fn();

    store.subscribe('key', callback);
    await store.clear('key');

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(undefined);
  });
});
