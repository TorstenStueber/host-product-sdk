/**
 * Statement store provider.
 *
 * Provides an API for subscribing to statement store topics, creating
 * proofs, and submitting signed statements through the host.
 *
 * Ported from product-sdk/statementStore.ts, adapted to use the
 * ProductFacade.
 */

import type { ProductFacade } from '@polkadot/api-protocol';
import type { ProductAccountId, SignedStatement, Statement, Topic } from './types.js';

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a statement store provider.
 *
 * @param facade - The ProductFacade instance to use.
 */
export const createStatementStore = (facade: ProductFacade) => {
  return {
    /**
     * Subscribe to statements matching the given topics.
     *
     * The callback fires whenever the host pushes a new batch of
     * signed statements that match at least one of the subscribed topics.
     */
    subscribe(topics: Topic[], callback: (statements: SignedStatement[]) => void) {
      return facade.statementStoreSubscribe(topics, payload => {
        callback(payload);
      });
    },

    /**
     * Create a proof for a statement using the given product account.
     *
     * Returns the signed proof that can be submitted via `submit()`.
     */
    async createProof(accountId: ProductAccountId, statement: Statement): Promise<unknown> {
      const result = await facade.statementStoreCreateProof([accountId, statement]);

      return result.match(
        payload => {
          return payload;
        },
        err => {
          throw err;
        },
      );
    },

    /**
     * Submit a signed statement to the statement store.
     */
    async submit(signedStatement: SignedStatement): Promise<void> {
      const result = await facade.statementStoreSubmit(signedStatement);

      return result.match(
        () => {
          return;
        },
        err => {
          throw err;
        },
      );
    },
  };
};
