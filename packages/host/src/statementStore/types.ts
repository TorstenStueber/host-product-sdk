/**
 * Statement store adapter interface.
 *
 * Unified interface for interacting with the statement-store parachain.
 * Used by both the SSO system (pairing + signing) and the host API
 * statement store handlers (product-facing).
 *
 * Re-exports the SCALE-derived `Statement`, `SignedStatement`, and
 * `StatementProof` types from `@polkadot/api-protocol` so this adapter
 * and the TrUAPI wire format share a single type hierarchy — no
 * conversion needed at the host↔product boundary.
 *
 * `StatementProof` variants:
 * - `Sr25519` / `Ed25519` / `Ecdsa`: cryptographic signature over the
 *   statement's signature material.
 * - `OnChain`: authenticity established by a corresponding event at
 *   `event` in `blockHash` emitted by `who` — verified against the chain
 *   rather than by signature check.
 */

export type { StatementProof, Statement, SignedStatement } from '@polkadot/api-protocol';

import type { Statement, SignedStatement } from '@polkadot/api-protocol';

// ---------------------------------------------------------------------------
// Adapter interface
// ---------------------------------------------------------------------------

export type StatementStoreAdapter = {
  /**
   * Subscribe to statements matching the given topics.
   * Callback receives batches of matching statements.
   * @returns Unsubscribe function.
   */
  subscribe(topics: Uint8Array[], callback: (statements: Statement[]) => void): () => void;

  /**
   * Submit a signed statement to the store.
   * Resolves on success, rejects on failure.
   */
  submit(statement: SignedStatement): Promise<void>;

  /**
   * Query existing statements matching the given topics.
   */
  query(topics: Uint8Array[]): Promise<Statement[]>;
};
