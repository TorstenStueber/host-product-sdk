/**
 * Host local storage provider.
 *
 * Provides a simple key-value storage API backed by the host's
 * localStorage through the transport layer. Supports raw bytes,
 * string, and JSON serialisation.
 *
 * Ported from product-sdk/localStorage.ts, adapted to use the
 * Transport abstraction from @polkadot/shared.
 */

import type { Transport } from '@polkadot/shared';
import { ResultAsync } from '@polkadot/shared';

import { createHostApi } from './hostApi.js';
import { sandboxTransport } from './transport/sandboxTransport.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function enumValue<V extends string, T>(tag: V, value: T): { tag: V; value: T } {
  return { tag, value };
}

function unwrapVersionedResult<T>(
  version: string,
  result: ResultAsync<{ tag: string; value: unknown }, { tag: string; value: unknown }>,
): ResultAsync<T, unknown> {
  return result
    .mapErr((payload: { tag: string; value: unknown }) => {
      if (payload.tag !== version) {
        return new Error(`Unsupported result version ${payload.tag}`);
      }
      return payload.value;
    })
    .andThen((payload: { tag: string; value: unknown }) => {
      if (payload.tag !== version) {
        return ResultAsync.fromPromise(
          Promise.reject(new Error(`Unsupported result version ${payload.tag}`)),
          (e) => e,
        );
      }
      return ResultAsync.fromSafePromise(Promise.resolve(payload.value as T));
    });
}

function resultToPromise<T>(result: ResultAsync<T, unknown>): Promise<T> {
  return new Promise<T>((resolve, reject) => result.match(resolve, reject));
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a local storage provider bound to a transport.
 *
 * @param transport - The transport to use. Defaults to the sandbox transport.
 */
export const createLocalStorage = (transport: Transport = sandboxTransport) => {
  const supportedVersion = 'v1';
  const hostApi = createHostApi(transport);
  const textEncoder = new TextEncoder();
  const textDecoder = new TextDecoder();

  function readBytes(key: string): Promise<Uint8Array> {
    return resultToPromise(
      unwrapVersionedResult<Uint8Array>(
        supportedVersion,
        hostApi.localStorageRead(enumValue(supportedVersion, key)),
      ),
    );
  }

  function writeBytes(key: string, value: Uint8Array): Promise<void> {
    return resultToPromise(
      unwrapVersionedResult<void>(
        supportedVersion,
        hostApi.localStorageWrite(enumValue(supportedVersion, [key, value])),
      ),
    );
  }

  function clearKey(key: string): Promise<void> {
    return resultToPromise(
      unwrapVersionedResult<void>(
        supportedVersion,
        hostApi.localStorageClear(enumValue(supportedVersion, key)),
      ),
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
    async readBytes(key: string): Promise<Uint8Array> {
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
