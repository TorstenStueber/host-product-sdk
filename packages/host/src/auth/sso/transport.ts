/**
 * SSO transport interface.
 *
 * Abstracts the topic-keyed publish/subscribe channel used by the SSO
 * manager to communicate with the mobile wallet. The canonical implementation
 * wraps the statement-store parachain, but any message bus works (WebSocket
 * relay, in-memory for tests, etc.).
 *
 * Modelled after the Rust host-sdk's SsoTransport trait.
 */

// ---------------------------------------------------------------------------
// Statement
// ---------------------------------------------------------------------------

/**
 * A statement received from the transport.
 *
 * Mirrors the statement-store parachain's statement format. Only the fields
 * the SSO manager needs are included; the transport implementation handles
 * proof verification and decryption key extraction internally.
 */
export type Statement = {
  /** Opaque proof public key (sr25519, 32 bytes). */
  proofPublicKey?: Uint8Array;
  /** Statement topics (each 32 bytes). */
  topics: Uint8Array[];
  /** Encrypted or plaintext payload. */
  data: Uint8Array;
};

/**
 * A statement to be submitted to the transport.
 */
export type SignedStatement = {
  /** Decryption key hint (32 bytes, optional). */
  decryptionKey?: Uint8Array;
  /** Logical channel (32 bytes). */
  channel: Uint8Array;
  /** Topics to publish under (each 32 bytes, max 4). */
  topics: Uint8Array[];
  /** Payload (encrypted). */
  data: Uint8Array;
  /** Sr25519 proof — signature over the statement. */
  proof: {
    publicKey: Uint8Array;
    signature: Uint8Array;
  };
};

// ---------------------------------------------------------------------------
// Transport interface
// ---------------------------------------------------------------------------

/**
 * Subscription handle returned by `subscribe()`.
 */
export type SsoSubscription = {
  /** Stop receiving statements for this subscription. */
  unsubscribe(): void;
};

/**
 * Topic-keyed publish/subscribe transport for SSO communication.
 *
 * Implementations connect to the statement-store parachain (or a test stub).
 * The SSO manager uses this to exchange encrypted messages with the mobile
 * wallet during pairing and signing.
 */
export type SsoTransport = {
  /**
   * Subscribe to statements matching the given topics.
   *
   * @param topics - Array of 32-byte topic filters. Statements matching
   *   any of these topics are delivered to the callback.
   * @param callback - Invoked with each batch of matching statements.
   * @returns A subscription handle with an `unsubscribe()` method.
   */
  subscribe(topics: Uint8Array[], callback: (statements: Statement[]) => void): SsoSubscription;

  /**
   * Submit a signed statement to the transport.
   *
   * @returns Resolves when the statement has been accepted, or rejects
   *   with an error describing the failure (e.g. data too large, bad proof).
   */
  submit(statement: SignedStatement): Promise<void>;
};

// ---------------------------------------------------------------------------
// Signer interface
// ---------------------------------------------------------------------------

/**
 * Sr25519 signer for statement proofs.
 *
 * The SSO manager needs to sign statements before submitting them to the
 * transport. The host app provides a signer derived at the appropriate path
 * (e.g. `//wallet//sso`).
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
  /** The mobile wallet's sr25519 public key (32 bytes). */
  remotePublicKey: Uint8Array;
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
