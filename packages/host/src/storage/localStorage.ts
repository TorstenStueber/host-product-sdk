/**
 * Browser localStorage adapter.
 *
 * Stores byte values as base64-encoded strings under a scoped key prefix.
 */

import type { StorageAdapter } from './types.js';

export function createLocalStorageAdapter(prefix: string): StorageAdapter {
  const withPrefix = (key: string) => `${prefix}${key}`;

  return {
    async read(key: string): Promise<Uint8Array | undefined> {
      const raw = localStorage.getItem(withPrefix(key));
      if (raw === null) return undefined;
      return Uint8Array.from(atob(raw), c => c.charCodeAt(0));
    },

    async write(key: string, value: Uint8Array): Promise<void> {
      const b64 = btoa(Array.from(value, byte => String.fromCharCode(byte)).join(''));
      localStorage.setItem(withPrefix(key), b64);
    },

    async clear(key: string): Promise<void> {
      localStorage.removeItem(withPrefix(key));
    },
  };
}
