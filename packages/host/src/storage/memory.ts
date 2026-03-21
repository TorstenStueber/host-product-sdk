/**
 * In-memory storage adapter.
 *
 * Useful for testing or non-persistent scenarios.
 */

import type { StorageAdapter } from './types.js';

export function createMemoryStorageAdapter(initial?: Record<string, Uint8Array>): StorageAdapter {
  const storage = new Map<string, Uint8Array>(initial ? Object.entries(initial) : []);

  return {
    async read(key: string): Promise<Uint8Array | null> {
      return storage.get(key) ?? null;
    },

    async write(key: string, value: Uint8Array): Promise<void> {
      storage.set(key, value);
    },

    async clear(key: string): Promise<void> {
      storage.delete(key);
    },
  };
}
