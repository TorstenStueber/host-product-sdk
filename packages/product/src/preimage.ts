/**
 * Preimage manager.
 *
 * Provides lookup subscriptions and submission of preimages through the
 * host transport layer.
 *
 * Ported from product-sdk/preimage.ts, adapted to use the Transport
 * abstraction from @polkadot/shared.
 */

import type { Transport } from '@polkadot/shared';
import { ResultAsync } from '@polkadot/shared';

import { createHostApi } from './hostApi.js';
import { sandboxTransport } from './transport/sandboxTransport.js';
import type { HexString } from './types.js';

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
 * Create a preimage manager bound to a transport.
 *
 * @param transport - The transport to use. Defaults to the sandbox transport.
 */
export const createPreimageManager = (transport: Transport = sandboxTransport) => {
  const supportedVersion = 'v1';
  const hostApi = createHostApi(transport);

  return {
    /**
     * Subscribe to a preimage lookup by key.
     *
     * The callback fires whenever the preimage is available (or `null`
     * if it has been removed / is not yet known).
     */
    lookup(
      key: HexString,
      callback: (preimage: Uint8Array | null) => void,
    ) {
      return hostApi.preimageLookupSubscribe(
        enumValue(supportedVersion, key),
        (payload: { tag: string; value: unknown }) => {
          if (payload.tag === supportedVersion) {
            callback(payload.value as Uint8Array | null);
          }
        },
      );
    },

    /**
     * Submit a preimage to the host.
     */
    submit(value: Uint8Array): Promise<void> {
      return resultToPromise(
        unwrapVersionedResult<void>(
          supportedVersion,
          hostApi.preimageSubmit(enumValue(supportedVersion, value)),
        ),
      );
    },
  };
};

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

/**
 * Default preimage manager instance bound to the sandbox transport.
 */
export const preimageManager = createPreimageManager();
