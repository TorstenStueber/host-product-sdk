/**
 * Tests for createLocalStorageAdapter.
 *
 * Covers same-tab CRUD + subscription notifications and the lazy
 * `window` 'storage' event listener used for cross-tab updates.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLocalStorageAdapter } from '@polkadot/host';

type StoredMap = Map<string, string>;

function mockLocalStorage(): { storage: Storage; data: StoredMap } {
  const data: StoredMap = new Map();
  const storage: Storage = {
    get length() {
      return data.size;
    },
    clear() {
      data.clear();
    },
    getItem(key: string) {
      return data.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(data.keys())[index] ?? null;
    },
    removeItem(key: string) {
      data.delete(key);
    },
    setItem(key: string, value: string) {
      data.set(key, value);
    },
  };
  return { storage, data };
}

type StorageEventListener = (event: StorageEvent) => void;

function mockWindow(localStorageRef: Storage): {
  window: Pick<Window, 'addEventListener' | 'removeEventListener'>;
  listenerCount: () => number;
  fire: (event: Partial<StorageEvent>) => void;
} {
  const listeners = new Set<StorageEventListener>();
  return {
    window: {
      addEventListener: (type: string, listener: EventListener | EventListenerObject) => {
        if (type === 'storage' && typeof listener === 'function') {
          listeners.add(listener as StorageEventListener);
        }
      },
      removeEventListener: (type: string, listener: EventListener | EventListenerObject) => {
        if (type === 'storage' && typeof listener === 'function') {
          listeners.delete(listener as StorageEventListener);
        }
      },
    } as unknown as Window,
    listenerCount: () => listeners.size,
    fire: partial => {
      const event = { storageArea: localStorageRef, ...partial } as StorageEvent;
      for (const fn of listeners) fn(event);
    },
  };
}

describe('createLocalStorageAdapter', () => {
  let dataRef: StoredMap;
  let fireStorage: (event: Partial<StorageEvent>) => void;
  let listenerCount: () => number;

  beforeEach(() => {
    const { storage, data } = mockLocalStorage();
    dataRef = data;
    const w = mockWindow(storage);
    fireStorage = w.fire;
    listenerCount = w.listenerCount;
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('window', w.window);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // -----------------------------------------------------------------------
  // Same-tab CRUD
  // -----------------------------------------------------------------------

  it('write then read returns the original bytes', async () => {
    const store = createLocalStorageAdapter('app:');
    await store.write('k', new Uint8Array([1, 2, 3]));
    expect(await store.read('k')).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('stores values under the configured prefix', async () => {
    const store = createLocalStorageAdapter('app:');
    await store.write('k', new Uint8Array([0xff]));
    expect(dataRef.has('app:k')).toBe(true);
    expect(dataRef.has('k')).toBe(false);
  });

  it('read returns undefined for missing keys', async () => {
    const store = createLocalStorageAdapter('app:');
    expect(await store.read('missing')).toBeUndefined();
  });

  it('clear removes the key', async () => {
    const store = createLocalStorageAdapter('app:');
    await store.write('k', new Uint8Array([1]));
    await store.clear('k');
    expect(await store.read('k')).toBeUndefined();
    expect(dataRef.has('app:k')).toBe(false);
  });

  it('round-trips arbitrary byte values (including 0 and 255)', async () => {
    const store = createLocalStorageAdapter('app:');
    const payload = new Uint8Array([0, 1, 127, 128, 254, 255]);
    await store.write('k', payload);
    expect(await store.read('k')).toEqual(payload);
  });

  // -----------------------------------------------------------------------
  // Same-tab subscriptions
  // -----------------------------------------------------------------------

  it('subscribe fires on same-tab write and clear', async () => {
    const store = createLocalStorageAdapter('app:');
    const cb = vi.fn();
    store.subscribe('k', cb);

    await store.write('k', new Uint8Array([7]));
    expect(cb).toHaveBeenNthCalledWith(1, new Uint8Array([7]));

    await store.clear('k');
    expect(cb).toHaveBeenNthCalledWith(2, undefined);
  });

  it('unsubscribe stops same-tab notifications', async () => {
    const store = createLocalStorageAdapter('app:');
    const cb = vi.fn();
    const unsub = store.subscribe('k', cb);

    await store.write('k', new Uint8Array([1]));
    unsub();
    await store.write('k', new Uint8Array([2]));

    expect(cb).toHaveBeenCalledTimes(1);
  });

  // -----------------------------------------------------------------------
  // Cross-tab ('storage' event) behaviour
  // -----------------------------------------------------------------------

  it('does not attach a storage listener until the first subscribe', () => {
    createLocalStorageAdapter('app:');
    expect(listenerCount()).toBe(0);
  });

  it('attaches the storage listener on first subscribe and detaches on last unsubscribe', () => {
    const store = createLocalStorageAdapter('app:');
    const u1 = store.subscribe('k', () => {});
    expect(listenerCount()).toBe(1);
    const u2 = store.subscribe('k', () => {});
    expect(listenerCount()).toBe(1);
    u1();
    expect(listenerCount()).toBe(1);
    u2();
    expect(listenerCount()).toBe(0);
  });

  it('notifies subscribers when a cross-tab write fires a storage event', () => {
    const store = createLocalStorageAdapter('app:');
    const cb = vi.fn();
    store.subscribe('k', cb);

    const value = new Uint8Array([9, 8, 7]);
    const b64 = btoa(String.fromCharCode(...value));
    fireStorage({ key: 'app:k', newValue: b64, oldValue: null });

    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith(value);
  });

  it('notifies with undefined when a cross-tab clear fires (newValue === null)', () => {
    const store = createLocalStorageAdapter('app:');
    const cb = vi.fn();
    store.subscribe('k', cb);

    fireStorage({ key: 'app:k', newValue: null, oldValue: 'AQ==' });

    expect(cb).toHaveBeenCalledWith(undefined);
  });

  it('ignores storage events for keys outside the configured prefix', () => {
    const store = createLocalStorageAdapter('app:');
    const cb = vi.fn();
    store.subscribe('k', cb);

    fireStorage({ key: 'other:k', newValue: btoa('x'), oldValue: null });
    fireStorage({ key: null, newValue: null, oldValue: null }); // localStorage.clear()

    expect(cb).not.toHaveBeenCalled();
  });

  it('ignores storage events for keys with no registered listeners', () => {
    const store = createLocalStorageAdapter('app:');
    const cb = vi.fn();
    store.subscribe('known', cb);

    fireStorage({ key: 'app:unknown', newValue: btoa('x'), oldValue: null });

    expect(cb).not.toHaveBeenCalled();
  });

  it('routes each cross-tab event only to subscribers of the matching key', () => {
    const store = createLocalStorageAdapter('app:');
    const cbA = vi.fn();
    const cbB = vi.fn();
    store.subscribe('a', cbA);
    store.subscribe('b', cbB);

    fireStorage({ key: 'app:a', newValue: btoa('\x01'), oldValue: null });

    expect(cbA).toHaveBeenCalledTimes(1);
    expect(cbB).not.toHaveBeenCalled();
  });

  it('ignores storage events from a different storageArea', () => {
    const store = createLocalStorageAdapter('app:');
    const cb = vi.fn();
    store.subscribe('k', cb);

    // storageArea intentionally unset (!== localStorage)
    fireStorage({ key: 'app:k', newValue: btoa('\x01'), oldValue: null, storageArea: undefined });

    expect(cb).not.toHaveBeenCalled();
  });
});
