/**
 * Statement store handlers.
 *
 * Delegates to the StatementStoreAdapter for subscribe, create proof,
 * and submit operations. If no adapter is provided, returns stub errors.
 */

import type { HostFacade } from '@polkadot/api-protocol';
import { errAsync, okAsync } from '@polkadot/api-protocol';
import type { StatementStoreAdapter } from '../statementStore/types.js';
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
      const topics = params as Uint8Array[];
      const unsub = adapter.subscribe(topics, statements => {
        // Convert our Statement[] to the protocol's SignedStatement[] format
        // The protocol expects SCALE-encoded statements, but the handler
        // wiring takes care of the SCALE encoding — we just provide the data.
        for (const stmt of statements) {
          if (stmt.proof) {
            send({
              proof: stmt.proof,
              data: stmt.data,
              topics: stmt.topics,
              channel: stmt.channel,
              expiry: stmt.expiry,
              decryptionKey: stmt.decryptionKey,
            } as never);
          }
        }
      });

      return unsub;
    }),
  );

  // Create proof
  cleanups.push(
    container.handleStatementStoreCreateProof(_params => {
      if (!config?.signer) {
        return errAsync({ tag: 'Unknown', value: { reason: 'No signer configured' } });
      }
      // Proof creation requires signing the statement with the sr25519 key
      // For now, return the signer's public key as the proof
      return errAsync({ tag: 'Unknown', value: { reason: 'Statement proof creation not yet implemented' } });
    }),
  );

  // Submit
  cleanups.push(
    container.handleStatementStoreSubmit(params => {
      if (!adapter) {
        return errAsync({ reason: 'Statement store not configured' });
      }

      const stmt = params as { proof: unknown; data?: Uint8Array; topics?: Uint8Array[]; channel?: Uint8Array };
      return okAsync(adapter.submit(stmt as never)).andThen(() => okAsync(undefined));
    }),
  );

  return cleanups;
}
