/**
 * In-memory storage adapter.
 *
 * Useful for testing or non-persistent scenarios.
 * Listeners are notified on write and clear.
 */

import type { StorageAdapter } from './types.js';

export function createMemoryStorageAdapter(initial?: Record<string, Uint8Array>): StorageAdapter {
  const storage = new Map<string, Uint8Array>(initial ? Object.entries(initial) : []);
  const listeners = new Map<string, Set<(value: Uint8Array | undefined) => void>>();

  function notify(key: string, value: Uint8Array | undefined): void {
    const set = listeners.get(key);
    if (set) {
      for (const fn of set) {
        fn(value);
      }
    }
  }

  return {
    async read(key: string): Promise<Uint8Array | undefined> {
      return storage.get(key);
    },

    async write(key: string, value: Uint8Array): Promise<void> {
      storage.set(key, value);
      notify(key, value);
    },

    async clear(key: string): Promise<void> {
      storage.delete(key);
      notify(key, undefined);
    },

    subscribe(key: string, callback: (value: Uint8Array | undefined) => void): () => void {
      let set = listeners.get(key);
      if (!set) {
        set = new Set();
        listeners.set(key, set);
      }
      set.add(callback);
      return () => {
        set.delete(callback);
        if (set.size === 0) {
          listeners.delete(key);
        }
      };
    },
  };
}
