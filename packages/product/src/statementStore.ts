/**
 * Statement store provider.
 *
 * Provides an API for subscribing to statement store topics, creating
 * proofs, and submitting signed statements through the host.
 *
 * Ported from product-sdk/statementStore.ts, adapted to use the
 * HostApi facade.
 */

import type { HostApi } from '@polkadot/host-api';
import { hostApi as defaultHostApi } from '@polkadot/host-api';
import type {
  ProductAccountId,
  SignedStatement,
  Statement,
  Topic,
} from './types.js';

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a statement store provider.
 *
 * @param hostApi - The HostApi instance to use. Defaults to the singleton.
 */
export const createStatementStore = (hostApi: HostApi = defaultHostApi) => {
  return {
    /**
     * Subscribe to statements matching the given topics.
     *
     * The callback fires whenever the host pushes a new batch of
     * signed statements that match at least one of the subscribed topics.
     */
    subscribe(
      topics: Topic[],
      callback: (statements: SignedStatement[]) => void,
    ) {
      return hostApi.statementStoreSubscribe(
        topics,
        (payload) => {
          callback(payload);
        },
      );
    },

    /**
     * Create a proof for a statement using the given product account.
     *
     * Returns the signed proof that can be submitted via `submit()`.
     */
    async createProof(
      accountId: ProductAccountId,
      statement: Statement,
    ): Promise<unknown> {
      const result = await hostApi.statementStoreCreateProof(
        [accountId, statement],
      );

      return result.match(
        (payload) => {
          return payload;
        },
        (err) => {
          throw err;
        },
      );
    },

    /**
     * Submit a signed statement to the statement store.
     */
    async submit(signedStatement: SignedStatement): Promise<void> {
      const result = await hostApi.statementStoreSubmit(
        signedStatement,
      );

      return result.match(
        () => {
          return;
        },
        (err) => {
          throw err;
        },
      );
    },
  };
};
