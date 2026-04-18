/**
 * Statement store handlers.
 *
 * Delegates to the StatementStoreAdapter for subscribe, create proof,
 * and submit operations. If no adapter is provided, returns stub errors.
 */

import type {
  HostFacade,
  SignedStatement as WireSignedStatement,
  StatementProof as WireStatementProof,
} from '@polkadot/api-protocol';
import { errAsync, okAsync } from '@polkadot/api-protocol';
import { ResultAsync } from 'neverthrow';
import type { StatementStoreAdapter, Statement, StatementProof } from '../statementStore/types.js';
import type { SsoSigner } from '../auth/sso/transport.js';

// ---------------------------------------------------------------------------
// Local → wire conversion
//
// Local adapter types use camelCase enum tags (`sr25519`, `onChain`, …) and
// `eventIndex`; the wire types derived from the SCALE `StatementProof` enum
// use PascalCase tags (`Sr25519`, `OnChain`, …) and `event`. These converters
// bridge the two so the send boundary is explicit and statically checked
// instead of hidden behind `as never`.
// ---------------------------------------------------------------------------

function toWireProof(p: StatementProof): WireStatementProof {
  switch (p.tag) {
    case 'sr25519':
      return { tag: 'Sr25519', value: p.value };
    case 'ed25519':
      return { tag: 'Ed25519', value: p.value };
    case 'ecdsa':
      return { tag: 'Ecdsa', value: p.value };
    case 'onChain':
      return {
        tag: 'OnChain',
        value: { who: p.value.who, blockHash: p.value.blockHash, event: p.value.eventIndex },
      };
  }
}

function toWireSignedStatement(s: Statement): WireSignedStatement | undefined {
  if (!s.proof) return undefined;
  return {
    proof: toWireProof(s.proof),
    decryptionKey: s.decryptionKey,
    expiry: s.expiry,
    channel: s.channel,
    topics: s.topics ?? [],
    data: s.data,
  };
}

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
        // shape, so `toWireSignedStatement` returns undefined for them and
        // we filter those out.
        const wire: WireSignedStatement[] = statements
          .map(toWireSignedStatement)
          .filter((s): s is WireSignedStatement => s !== undefined);
        if (wire.length > 0) send(wire);
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
      const statement = (params as [unknown, { data?: Uint8Array }])[1];
      const dataToSign = statement?.data ?? new Uint8Array(0);

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

      const stmt = params as { proof: unknown; data?: Uint8Array; topics?: Uint8Array[]; channel?: Uint8Array };
      return okAsync(adapter.submit(stmt as never)).andThen(() => okAsync(undefined));
    }),
  );

  return cleanups;
}
