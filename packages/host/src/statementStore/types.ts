/**
 * Statement store adapter interface.
 *
 * Unified interface for interacting with the statement-store parachain.
 * Used by both the SSO system (pairing + signing) and the host API
 * statement store handlers (product-facing).
 */

// ---------------------------------------------------------------------------
// Statement types (matching Substrate statement-store wire format)
// ---------------------------------------------------------------------------

export type StatementProof =
  | { tag: 'sr25519'; value: { signature: Uint8Array; signer: Uint8Array } }
  | { tag: 'ed25519'; value: { signature: Uint8Array; signer: Uint8Array } }
  | { tag: 'ecdsa'; value: { signature: Uint8Array; signer: Uint8Array } };

export type Statement = {
  proof?: StatementProof;
  decryptionKey?: Uint8Array;
  expiry?: bigint;
  channel?: Uint8Array;
  topics?: Uint8Array[];
  data?: Uint8Array;
};

export type SignedStatement = Omit<Statement, 'proof'> & {
  proof: StatementProof;
};

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
