/**
 * Browser localStorage adapter.
 *
 * Stores byte values as base64-encoded strings under a scoped key prefix.
 * Listeners are notified on write and clear in the same tab, and on
 * cross-tab changes via the window 'storage' event.
 */

import type { StorageAdapter } from './types.js';

function encodeValue(value: Uint8Array): string {
  return btoa(Array.from(value, byte => String.fromCharCode(byte)).join(''));
}

function decodeValue(raw: string): Uint8Array {
  return Uint8Array.from(atob(raw), c => c.charCodeAt(0));
}

export function createLocalStorageAdapter(prefix: string): StorageAdapter {
  const withPrefix = (key: string) => `${prefix}${key}`;
  const listeners = new Map<string, Set<(value: Uint8Array | undefined) => void>>();
  let storageHandler: ((event: StorageEvent) => void) | undefined;

  function notify(key: string, value: Uint8Array | undefined): void {
    const set = listeners.get(key);
    if (set) {
      for (const fn of set) {
        fn(value);
      }
    }
  }

  function attachStorageListener(): void {
    if (storageHandler || typeof window === 'undefined') return;
    storageHandler = event => {
      // Only react to changes on our own prefix, on our own Storage object.
      if (event.storageArea !== localStorage) return;
      if (event.key === null || !event.key.startsWith(prefix)) return;
      const key = event.key.slice(prefix.length);
      if (!listeners.has(key)) return;
      const value = event.newValue === null ? undefined : decodeValue(event.newValue);
      notify(key, value);
    };
    window.addEventListener('storage', storageHandler);
  }

  function detachStorageListener(): void {
    if (!storageHandler || typeof window === 'undefined') return;
    window.removeEventListener('storage', storageHandler);
    storageHandler = undefined;
  }

  return {
    async read(key: string): Promise<Uint8Array | undefined> {
      const raw = localStorage.getItem(withPrefix(key));
      if (raw === null) return undefined;
      return decodeValue(raw);
    },

    async write(key: string, value: Uint8Array): Promise<void> {
      localStorage.setItem(withPrefix(key), encodeValue(value));
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
      attachStorageListener();
      return () => {
        set.delete(callback);
        if (set.size === 0) {
          listeners.delete(key);
          if (listeners.size === 0) {
            detachStorageListener();
          }
        }
      };
    },
  };
}
