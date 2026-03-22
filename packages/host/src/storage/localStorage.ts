/**
 * Browser localStorage adapter.
 *
 * Stores byte values as base64-encoded strings under a scoped key prefix.
 * Supports reactive subscriptions: listeners are notified on write and clear.
 */

import type { ReactiveStorageAdapter } from './types.js';

export function createLocalStorageAdapter(prefix: string): ReactiveStorageAdapter {
  const withPrefix = (key: string) => `${prefix}${key}`;
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
      const raw = localStorage.getItem(withPrefix(key));
      if (raw === null) return undefined;
      return Uint8Array.from(atob(raw), c => c.charCodeAt(0));
    },

    async write(key: string, value: Uint8Array): Promise<void> {
      const b64 = btoa(Array.from(value, byte => String.fromCharCode(byte)).join(''));
      localStorage.setItem(withPrefix(key), b64);
      notify(key, value);
    },

    async clear(key: string): Promise<void> {
      localStorage.removeItem(withPrefix(key));
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
