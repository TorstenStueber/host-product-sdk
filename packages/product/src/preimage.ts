/**
 * Preimage manager.
 *
 * Provides lookup subscriptions and submission of preimages through the
 * host transport layer.
 *
 * Ported from product-sdk/preimage.ts, adapted to use the HostApi facade.
 */

import type { HostApi } from '@polkadot/host-api';
import { hostApi as defaultHostApi } from '@polkadot/host-api';
import type { HexString } from './types.js';

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a preimage manager.
 *
 * @param hostApi - The HostApi instance to use. Defaults to the singleton.
 */
export const createPreimageManager = (hostApi: HostApi = defaultHostApi) => {
  return {
    /**
     * Subscribe to a preimage lookup by key.
     *
     * The callback fires whenever the preimage is available (or `null`
     * if it has been removed / is not yet known).
     */
    lookup(key: HexString, callback: (preimage: Uint8Array | null) => void) {
      return hostApi.preimageLookupSubscribe(key, payload => {
        callback(payload as Uint8Array | null);
      });
    },

    /**
     * Submit a preimage to the host.
     */
    async submit(value: Uint8Array): Promise<void> {
      const result = await hostApi.preimageSubmit(value);
      result.match(
        () => {},
        err => {
          throw err;
        },
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
