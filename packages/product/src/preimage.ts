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
import { createHostApi } from './hostApi.js';
import { sandboxTransport } from './transport/sandboxTransport.js';
import type { HexString } from './types.js';

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a preimage manager bound to a transport.
 *
 * @param transport - The transport to use. Defaults to the sandbox transport.
 */
export const createPreimageManager = (transport: Transport = sandboxTransport) => {
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
        key,
        (payload) => {
          callback(payload as Uint8Array | null);
        },
      );
    },

    /**
     * Submit a preimage to the host.
     */
    async submit(value: Uint8Array): Promise<void> {
      const result = await hostApi.preimageSubmit(value);
      result.match(
        () => {},
        (err) => { throw err; },
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
