/**
 * Statement prover / verifier.
 *
 * `generateMessageProof` signs an unsigned statement with the local
 * sr25519 secret and returns a `SignedStatement`. The signature is
 * produced over the statement's `data` field — the substrate node
 * performs full integrity validation on ingest, so we delegate that
 * part to the node.
 *
 * `verifyMessageProof` authenticates incoming statements *against the
 * expected peer*. It checks:
 *
 *   1. A proof is present (unproven statements are rejected).
 *   2. The proof variant is `Sr25519` (ed25519/ecdsa/on-chain proofs are
 *      not used by the SSO protocol and, if seen, are treated as
 *      foreign).
 *   3. The proof's `signer` byte-equals the remote peer's public key.
 *
 * This is strictly a **peer-authentication** check, not a cryptographic
 * integrity check. Integrity comes from two places: the substrate node
 * validates the signature over the statement on ingest, and the session
 * additionally decrypts the payload with a key known only to the two
 * peers. A statement that passes all three checks was either submitted
 * by the peer or by an attacker who holds the peer's sr25519 secret AND
 * the ECDH session key — compromise of either one is out of scope.
 *
 * This check is also what filters self-echoes on the outgoing session
 * topic: our own statements carry our `signer`, not the peer's, so they
 * fail verification and get skipped without needing a tag filter.
 */

import { ResultAsync, okAsync } from 'neverthrow';
import type { Statement, SignedStatement } from '../types.js';
import type { SessionError, StatementProver } from './types.js';

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Create a StatementProver for a specific peer pair.
 *
 * @param localSigner     Signs outgoing statements.
 * @param remotePublicKey The peer's 32-byte sr25519 public key. Incoming
 *                        statements must carry this as their proof signer.
 */
export function createSr25519Prover(
  localSigner: {
    publicKey: Uint8Array;
    sign(message: Uint8Array): Promise<Uint8Array>;
  },
  remotePublicKey: Uint8Array,
): StatementProver {
  return {
    generateMessageProof(statement: Statement): ResultAsync<SignedStatement, SessionError> {
      const dataToSign = statement.data ?? new Uint8Array(0);
      return ResultAsync.fromPromise(localSigner.sign(dataToSign), e => ({
        tag: 'Unknown' as const,
        detail: e instanceof Error ? e.message : String(e),
      })).andThen(signature => {
        const signed: SignedStatement = {
          ...statement,
          proof: {
            tag: 'Sr25519',
            value: { signature, signer: localSigner.publicKey },
          },
        };
        return okAsync<SignedStatement, SessionError>(signed);
      });
    },

    verifyMessageProof(statement: Statement): boolean {
      const proof = statement.proof;
      if (!proof) return false;
      if (proof.tag !== 'Sr25519') return false;
      return bytesEqual(proof.value.signer, remotePublicKey);
    },
  };
}
