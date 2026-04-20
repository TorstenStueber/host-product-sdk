/**
 * Storage adapter interface for the host package.
 *
 * A simple async key-value store with byte-level values and per-key
 * change notifications. Implementations include in-memory and browser
 * localStorage; both notify subscribers on write and clear.
 */

export type StorageAdapter = {
  read(key: string): Promise<Uint8Array | undefined>;
  write(key: string, value: Uint8Array): Promise<void>;
  clear(key: string): Promise<void>;
  subscribe(key: string, callback: (value: Uint8Array | undefined) => void): () => void;
};
