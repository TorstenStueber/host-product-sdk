/**
 * Statement store handlers.
 *
 * Delegates to the StatementStoreAdapter for subscribe, create proof,
 * and submit operations. If no adapter is provided, returns stub errors.
 */

import type { HostFacade } from '@polkadot/api-protocol';
import { errAsync } from '@polkadot/api-protocol';
import { ResultAsync } from 'neverthrow';
import type { StatementStoreAdapter, SignedStatement } from '../statementStore/types.js';
import type { SsoSigner } from '../auth/sso/transport.js';

export type StatementStoreHandlersConfig = {
  statementStore?: StatementStoreAdapter;
  signer?: SsoSigner;
};

export function wireStatementStoreHandlers(
  container: HostFacade,
  config?: StatementStoreHandlersConfig,
): (() => void)[] {
  const cleanups: (() => void)[] = [];
  const adapter = config?.statementStore;

  // Subscribe
  cleanups.push(
    container.handleStatementStoreSubscribe((params, send, interrupt) => {
      if (!adapter) {
        interrupt();
        return () => {};
      }

      // params is an array of topic Uint8Arrays
      const topics = params;
      const unsub = adapter.subscribe(topics, statements => {
        // The protocol receive type is `Vector(SignedStatement)` — each
        // `send()` call must carry the whole batch as an array, not one
        // statement. Unproven statements can't satisfy the `SignedStatement`
        // shape (proof is required there), so filter them out.
        const signed = statements.filter((s): s is SignedStatement => s.proof !== undefined);
        if (signed.length > 0) send(signed);
      });

      return unsub;
    }),
  );

  // Create proof — signs a statement with the sr25519 key to produce a proof
  cleanups.push(
    container.handleStatementStoreCreateProof(params => {
      if (!config?.signer) {
        return errAsync({ tag: 'Unknown', value: { reason: 'No signer configured' } });
      }

      const s = config.signer;
      // params is [ProductAccountId, Statement] — extract the statement data
      const statement = params[1];
      const dataToSign = statement.data ?? new Uint8Array(0);

      // Sign the statement data and return the proof
      return ResultAsync.fromPromise(
        s.sign(dataToSign).then(signature => ({
          tag: 'Sr25519' as const,
          value: { signature, signer: s.publicKey },
        })),
        () => ({ tag: 'Unknown' as const, value: { reason: 'Signing failed' } }),
      );
    }),
  );

  // Submit
  cleanups.push(
    container.handleStatementStoreSubmit(params => {
      if (!adapter) {
        return errAsync({ reason: 'Statement store not configured' });
      }

      return ResultAsync.fromPromise(
        adapter.submit(params).then((): undefined => undefined),
        e => ({ reason: e instanceof Error ? e.message : String(e) }),
      );
    }),
  );

  return cleanups;
}
