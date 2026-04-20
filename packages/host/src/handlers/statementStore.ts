/**
 * Statement store handlers.
 *
 * Delegates to the StatementStoreAdapter for subscribe, create proof,
 * and submit operations. If no adapter is provided, returns stub errors.
 */

import type { HostFacade } from '@polkadot/api-protocol';
import { errAsync, ResultAsync } from '@polkadot/api-protocol';
import type { StatementStoreAdapter, SignedStatement, StatementStoreError } from '../statementStore/types.js';
import type { SsoSigner } from '../auth/sso/types.js';

export type StatementStoreHandlersConfig = {
  statementStore?: StatementStoreAdapter;
  signer?: SsoSigner;
};

function storeErrorReason(err: StatementStoreError): string {
  switch (err.tag) {
    case 'DataTooLarge':
      return `Data too large (${err.submitted}/${err.available})`;
    case 'ExpiryTooLow':
      return `Expiry too low (${err.submitted} < ${err.min})`;
    case 'AccountFull':
      return `Account full (${err.submitted} < ${err.min})`;
    case 'StorageFull':
      return 'Storage full';
    case 'NoAllowance':
      return 'No allowance';
    case 'NoProof':
      return 'No proof';
    case 'BadProof':
      return 'Bad proof';
    case 'EncodingTooLarge':
      return `Encoding too large (${err.submitted}/${err.max})`;
    case 'AlreadyExpired':
      return 'Already expired';
    case 'KnownExpired':
      return 'Known but expired';
    case 'InternalStore':
      return `Internal store error: ${err.detail}`;
    case 'Transport':
      return `Transport error: ${err.message}`;
    case 'Unknown':
      return `Unknown error: ${err.detail}`;
  }
}

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
      return adapter
        .submit(params)
        .map((): undefined => undefined)
        .mapErr(err => ({ reason: storeErrorReason(err) }));
    }),
  );

  return cleanups;
}
