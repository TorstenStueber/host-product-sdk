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
import type { ResultAsync } from 'neverthrow';

// ---------------------------------------------------------------------------
// Error union
// ---------------------------------------------------------------------------

/**
 * Flat discriminated union covering every failure mode of the statement
 * store adapter, tagged so callers can narrow with a simple `switch`.
 *
 * Works naturally with `neverthrow`'s `.match()` / `.mapErr()` and
 * survives structured clone (unlike Error classes).
 */
export type StatementStoreError =
  // -- Submission rejections (substrate returns status='rejected') --------
  | { tag: 'DataTooLarge'; submitted: number; available: number }
  | { tag: 'ExpiryTooLow'; submitted: bigint; min: bigint }
  | { tag: 'AccountFull'; submitted: bigint; min: bigint }
  | { tag: 'StorageFull' }
  | { tag: 'NoAllowance' }
  // -- Submission invalid (substrate returns status='invalid') -----------
  | { tag: 'NoProof' }
  | { tag: 'BadProof' }
  | { tag: 'EncodingTooLarge'; submitted: number; max: number }
  | { tag: 'AlreadyExpired' }
  // -- Submission known-but-expired (status='knownExpired') --------------
  | { tag: 'KnownExpired' }
  // -- Store internal errors --------------------------------------------
  | { tag: 'InternalStore'; detail: string }
  // -- RPC / transport failures -----------------------------------------
  | { tag: 'Transport'; message: string }
  // -- Unmapped status / reason -----------------------------------------
  | { tag: 'Unknown'; detail: string };

// ---------------------------------------------------------------------------
// Adapter interface
// ---------------------------------------------------------------------------

export type StatementStoreAdapter = {
  /**
   * Subscribe to statements whose topic set is a superset of the given
   * topics (i.e. statements carrying ALL of `topics`, matching the
   * substrate `matchAll` filter semantics).
   *
   * The callback receives batches of matching statements as they arrive.
   * Errors during the subscription lifetime are logged; the returned
   * unsubscribe function is always safe to call (idempotent).
   */
  subscribe(topics: Uint8Array[], callback: (statements: Statement[]) => void): () => void;

  /**
   * Submit a signed statement to the store.
   *
   * Errors produced by the substrate RPC are mapped into the
   * {@link StatementStoreError} union — callers do not need to parse
   * status strings.
   */
  submit(statement: SignedStatement): ResultAsync<void, StatementStoreError>;

  /**
   * Query existing statements whose topic set is a superset of the given
   * topics (matches the subscribe semantics).
   */
  query(topics: Uint8Array[]): ResultAsync<Statement[], StatementStoreError>;
};
