/**
 * Host local storage provider.
 *
 * Provides a simple key-value storage API backed by the host's
 * localStorage through the transport layer. Supports raw bytes,
 * string, and JSON serialisation.
 *
 * Ported from product-sdk/localStorage.ts, adapted to use the
 * HostApi facade.
 */

import type { HostApi } from '@polkadot/host-api';
import { hostApi as defaultHostApi } from '@polkadot/host-api';

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a local storage provider.
 *
 * @param hostApi - The HostApi instance to use. Defaults to the singleton.
 */
export const createLocalStorage = (hostApi: HostApi = defaultHostApi) => {
  const textEncoder = new TextEncoder();
  const textDecoder = new TextDecoder();

  function readBytes(key: string): Promise<Uint8Array | undefined> {
    return new Promise<Uint8Array | undefined>((resolve, reject) =>
      hostApi.localStorageRead(key).match(resolve, reject),
    );
  }

  function writeBytes(key: string, value: Uint8Array): Promise<void> {
    return new Promise<void>((resolve, reject) =>
      hostApi.localStorageWrite([key, value]).match(resolve, reject),
    );
  }

  function clearKey(key: string): Promise<void> {
    return new Promise<void>((resolve, reject) =>
      hostApi.localStorageClear(key).match(resolve, reject),
    );
  }

  return {
    /**
     * Clear the value stored at `key`.
     */
    async clear(key: string): Promise<void> {
      return clearKey(key);
    },

    /**
     * Read raw bytes stored at `key`.
     */
    async readBytes(key: string): Promise<Uint8Array | undefined> {
      return readBytes(key);
    },

    /**
     * Write raw bytes to `key`.
     */
    async writeBytes(key: string, value: Uint8Array): Promise<void> {
      return writeBytes(key, value);
    },

    /**
     * Read a UTF-8 string from `key`.
     */
    async readString(key: string): Promise<string> {
      return readBytes(key).then(bytes => textDecoder.decode(bytes));
    },

    /**
     * Write a UTF-8 string to `key`.
     */
    async writeString(key: string, value: string): Promise<void> {
      return writeBytes(key, textEncoder.encode(value));
    },

    /**
     * Read and JSON-parse the value at `key`.
     */
    async readJSON<T = unknown>(key: string): Promise<T> {
      return readBytes(key)
        .then(bytes => textDecoder.decode(bytes))
        .then(str => JSON.parse(str) as T);
    },

    /**
     * JSON-stringify and write `value` to `key`.
     */
    async writeJSON(key: string, value: unknown): Promise<void> {
      return writeBytes(key, textEncoder.encode(JSON.stringify(value)));
    },
  };
};

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

/**
 * Default host local storage instance bound to the sandbox transport.
 */
export const hostLocalStorage = createLocalStorage();
