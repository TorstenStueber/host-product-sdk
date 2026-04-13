/**
 * SSO adapter interfaces.
 *
 * Defines the signer, session store, and session metadata types used by
 * the SSO manager. The statement store transport is now in
 * `statementStore/types.ts` as a unified adapter serving both SSO and
 * the host API statement store handlers.
 */

// ---------------------------------------------------------------------------
// Signer interface
// ---------------------------------------------------------------------------

/**
 * Sr25519 signer for statement proofs.
 *
 * The SSO manager needs to sign statements before submitting them to the
 * statement store. The host app provides a signer derived at the appropriate
 * path (e.g. `//wallet//sso`).
 */
export type SsoSigner = {
  /** The sr25519 public key (32 bytes). */
  publicKey: Uint8Array;

  /**
   * Sign a message with the sr25519 private key.
   *
   * @param message - The payload to sign.
   * @returns The 64-byte sr25519 signature.
   */
  sign(message: Uint8Array): Promise<Uint8Array>;
};

// ---------------------------------------------------------------------------
// Session store interface
// ---------------------------------------------------------------------------

/**
 * Minimal session metadata that survives across page reloads.
 *
 * The AES session key is NOT stored here — it is either re-derived
 * during re-pairing or held in a platform-specific secure store.
 */
export type PersistedSessionMeta = {
  /** Opaque session identifier shared with the mobile wallet. */
  sessionId: string;
  /** SS58 address of the paired mobile account. */
  address: string;
  /** Human-readable name shown during pairing (e.g. device name). */
  displayName: string;
  /** AES session key (32 bytes) — the P-256 ECDH shared secret derived during pairing. */
  sessionKey: Uint8Array;
  /** The mobile wallet's sr25519 account ID (32 bytes). */
  remoteAccountId: Uint8Array;
};

/**
 * Persistence adapter for SSO session metadata.
 *
 * Implementations store session metadata so the user does not need to
 * re-pair on every page load. Backed by the ReactiveStorageAdapter.
 */
export type SsoSessionStore = {
  /** Save session metadata, overwriting any existing entry. */
  save(session: PersistedSessionMeta): Promise<void>;
  /** Load the previously saved session, or undefined if none. */
  load(): Promise<PersistedSessionMeta | undefined>;
  /** Remove any saved session. */
  clear(): Promise<void>;
  /** Subscribe to session changes. */
  subscribe(callback: (session: PersistedSessionMeta | undefined) => void): () => void;
};
