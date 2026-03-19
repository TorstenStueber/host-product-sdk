/**
 * Statement store provider.
 *
 * Provides an API for subscribing to statement store topics, creating
 * proofs, and submitting signed statements through the host.
 *
 * Ported from product-sdk/statementStore.ts, adapted to use the
 * Transport abstraction from @polkadot/shared.
 */

import type { Transport } from '@polkadot/shared';

import { createHostApi } from './hostApi.js';
import { sandboxTransport } from './transport/sandboxTransport.js';
import type {
  ProductAccountId,
  SignedStatement,
  Statement,
  Topic,
} from './types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function enumValue<V extends string, T>(tag: V, value: T): { tag: V; value: T } {
  return { tag, value };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a statement store provider bound to a transport.
 *
 * @param transport - The transport to use. Defaults to the sandbox transport.
 */
export const createStatementStore = (transport: Transport = sandboxTransport) => {
  const hostApi = createHostApi(transport);

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
        enumValue('v1', topics),
        (payload: { tag: string; value: unknown }) => {
          if (payload.tag === 'v1') {
            callback(payload.value as SignedStatement[]);
          }
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
        enumValue('v1', [accountId, statement]),
      );

      return result.match(
        (payload: { tag: string; value: unknown }) => {
          if (payload.tag === 'v1') {
            return payload.value;
          }
          throw new Error(`Unknown response version ${payload.tag}`);
        },
        (err: { tag: string; value: unknown }) => {
          throw err.value;
        },
      );
    },

    /**
     * Submit a signed statement to the statement store.
     */
    async submit(signedStatement: SignedStatement): Promise<void> {
      const result = await hostApi.statementStoreSubmit(
        enumValue('v1', signedStatement),
      );

      return result.match(
        (payload: { tag: string; value: unknown }) => {
          if (payload.tag === 'v1') {
            return;
          }
          throw new Error(`Unknown response version ${payload.tag}`);
        },
        (err: { tag: string; value: unknown }) => {
          throw err.value;
        },
      );
    },
  };
};
