/**
 * Preimage manager.
 *
 * Provides lookup subscriptions and submission of preimages through the
 * host transport layer.
 *
 * Ported from product-sdk/preimage.ts, adapted to use the ProductFacade.
 */

import type { ProductFacade } from '@polkadot/api-protocol';
import type { HexString } from './types.js';

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a preimage manager.
 *
 * @param facade - The ProductFacade instance to use.
 */
export const createPreimageManager = (facade: ProductFacade) => {
  return {
    /**
     * Subscribe to a preimage lookup by key.
     *
     * The callback fires whenever the preimage is available (or `undefined`
     * if it has been removed / is not yet known).
     */
    lookup(key: HexString, callback: (preimage: Uint8Array | undefined) => void) {
      return facade.preimageLookupSubscribe(key, payload => {
        callback(payload as Uint8Array | undefined);
      });
    },

    /**
     * Submit a preimage to the host.
     */
    async submit(value: Uint8Array): Promise<void> {
      const result = await facade.preimageSubmit(value);
      result.match(
        () => {},
        err => {
          throw err;
        },
      );
    },
  };
};
