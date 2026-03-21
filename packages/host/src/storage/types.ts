/**
 * Storage adapter interface for the host package.
 *
 * A simple async key-value store with byte-level values.
 * Implementations include in-memory and browser localStorage.
 */

export type StorageAdapter = {
  read(key: string): Promise<Uint8Array | undefined>;
  write(key: string, value: Uint8Array): Promise<void>;
  clear(key: string): Promise<void>;
};
