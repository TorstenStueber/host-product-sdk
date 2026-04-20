/**
 * Session types.
 *
 * A {@link Session} is a symmetric, bidirectional, reliable encrypted
 * request/response channel between two paired accounts, built on top of
 * the statement store as a transport.
 *
 * Both peers are structurally equivalent: `localAccount` talks to
 * `remoteAccount`, and whichever role one endpoint plays the other
 * plays the mirror image. Triangle-js-sdks' statement-store uses this
 * same abstraction on both sides of the SSO pairing.
 *
 * The wire protocol on top of the store is:
 *
 * - `StatementData::request { requestId, data: Vec<Bytes> }` — one or
 *   more application payloads submitted on the outgoing session topic.
 * - `StatementData::response { requestId, responseCode: u8 }` — a
 *   transport-layer acknowledgment submitted by the receiver on the
 *   sender's outgoing topic, noting whether the request could be
 *   decrypted and decoded. **Distinct from any application-level reply**,
 *   which would itself be a new `::request` going the other direction.
 *
 * Request statements use a dedicated `requestChannel`; response
 * statements use a `responseChannel`. Both channels support substrate's
 * per-`(account, channel)` replacement semantics, so retries and
 * coalesced batches don't pile up on chain.
 */

import type { Codec } from 'scale-ts';
import type { Result, ResultAsync } from 'neverthrow';
import type { Statement, SignedStatement, StatementStoreError } from '../types.js';

/**
 * Transport-layer response codes (StatementData::response.responseCode).
 *
 * Any value the peer returns other than the three success/*Failed
 * statuses is mapped to `'unknown'`.
 */
export type ResponseCode = 'success' | 'decryptionFailed' | 'decodingFailed' | 'unknown';

/**
 * Minimal account descriptor for the local endpoint.
 */
export type LocalSessionAccount = {
  /** 32-byte account ID (raw sr25519 public key in SSO). */
  accountId: Uint8Array;
  /** Optional pin — currently unused, reserved for future multi-slot peers. */
  pin?: string;
};

/**
 * Account descriptor for the remote endpoint.
 *
 * Includes the remote peer's sr25519 `publicKey` so the session can
 * authenticate incoming statements by their proof's `signer` field.
 * In the SSO case, `accountId === publicKey` (account ID is the raw
 * public key).
 */
export type RemoteSessionAccount = {
  accountId: Uint8Array;
  /** Remote peer's sr25519 public key for proof verification. */
  publicKey: Uint8Array;
  pin?: string;
};

/**
 * Pluggable statement prover / verifier.
 *
 * - `generateMessageProof` signs an unsigned statement with the local
 *   secret and returns a `SignedStatement`.
 * - `verifyMessageProof` checks that an incoming statement's proof is
 *   authentic for the remote peer (typically: `proof.tag === 'Sr25519'`
 *   and `proof.value.signer === remoteAccount.publicKey`). Statement
 *   integrity is assumed to have been validated by the substrate node
 *   on ingest; this method additionally ensures the statement actually
 *   came from the expected peer and isn't an echo of our own submissions.
 */
export type StatementProver = {
  generateMessageProof(statement: Statement): ResultAsync<SignedStatement, SessionError>;
  verifyMessageProof(statement: Statement): boolean;
};

/**
 * Symmetric reversible encryption used by the session for
 * StatementData payloads. Synchronous — AES-GCM does no I/O and the
 * failure cases (auth-tag mismatch, truncated input) are just validation.
 */
export type Encryption = {
  encrypt(plaintext: Uint8Array): Result<Uint8Array, SessionError>;
  decrypt(ciphertext: Uint8Array): Result<Uint8Array, SessionError>;
};

/**
 * A message delivered to a session subscriber. Requests carry their
 * payload typed through the subscriber's codec; responses carry only
 * the transport-layer `responseCode`.
 */
export type RequestMessage<T> = {
  type: 'request';
  /** `${requestId}-${index}` — stable per-payload identifier. */
  localId: string;
  /** Peer-chosen wire request id. Use this when ACKing. */
  requestId: string;
  payload: { status: 'parsed'; value: T } | { status: 'failed'; value: Uint8Array };
};

export type ResponseMessage = {
  type: 'response';
  localId: string;
  requestId: string;
  responseCode: ResponseCode;
};

export type Message<T> = RequestMessage<T> | ResponseMessage;

export type Filter<T, S> = (value: T) => S | undefined;

/**
 * Flat discriminated union of session-layer failure modes. No Error
 * classes — works with neverthrow `.match()` / `.mapErr()` and survives
 * structured clone.
 */
export type SessionError =
  /** Peer returned `decodingFailed` in response to our request. */
  | { tag: 'DecodingFailed' }
  /** Peer returned `decryptionFailed` in response to our request. */
  | { tag: 'DecryptionFailed' }
  /** Peer returned an unknown response code. */
  | { tag: 'UnknownResponse' }
  /** Payload is larger than `maxRequestSize`. */
  | { tag: 'MessageTooBig'; size: number; maxSize: number }
  /** Application codec failed to encode the outgoing payload. */
  | { tag: 'CodecEncodeFailed'; detail: string }
  /** Underlying statement store rejected the submission. */
  | { tag: 'StatementStore'; cause: StatementStoreError }
  /** `submitResponseMessage` invoked with an unknown requestId. */
  | { tag: 'NoIncomingRequest'; requestId: string }
  /** Any ResultAsync awaiting a response is rejected when `dispose()` is called. */
  | { tag: 'Disposed' }
  /** Encrypt / decrypt primitive threw. */
  | { tag: 'EncryptionFailed'; detail: string }
  /** Any unanticipated path. */
  | { tag: 'Unknown'; detail: string };

/**
 * The session API. Mirrors the triangle statement-store protocol.
 */
export type Session = {
  /**
   * Submit a request and wait for the peer's ACK. Resolves with `void`
   * on ACK `success`; rejects with the matching `SessionError` tag on
   * any other ACK code. Does **not** deliver the peer's application-level
   * reply — that arrives as a `RequestMessage` through `subscribe`.
   */
  request<T>(codec: Codec<T>, payload: T): ResultAsync<void, SessionError>;

  /**
   * Submit a request payload and return a local `requestId` token.
   * Use {@link waitForResponseMessage} with this token to observe the
   * ACK.
   */
  submitRequestMessage<T>(codec: Codec<T>, payload: T): ResultAsync<{ requestId: string }, SessionError>;

  /**
   * Await the ACK for a previously submitted request token.
   */
  waitForResponseMessage(token: string): ResultAsync<ResponseMessage, SessionError>;

  /**
   * Submit a `StatementData::response` ACKing an incoming request.
   * Idempotent: subsequent calls for the same request are no-ops.
   */
  submitResponseMessage(requestId: string, responseCode: ResponseCode): ResultAsync<void, SessionError>;

  /**
   * Subscribe to messages on the session, decoded through the given
   * codec. Multiple subscribers with different codecs are supported:
   * each incoming request payload is decoded through every subscriber's
   * codec, producing per-subscriber `Message<T>` batches.
   *
   * Messages that arrived before the first `subscribe` call (including
   * messages discovered during init recovery) are replayed to each new
   * subscriber.
   */
  subscribe<T>(codec: Codec<T>, callback: (messages: Message<T>[]) => void): () => void;

  /**
   * Shortcut: subscribe, wait for the first message matching `filter`,
   * unsubscribe, and resolve with the filter's return value.
   */
  waitForRequestMessage<T, S>(codec: Codec<T>, filter: Filter<T, S>): ResultAsync<S, SessionError>;

  /**
   * Tear down both upstream subscriptions and reject every pending
   * delivery promise with `{ tag: 'Disposed' }`. Safe to call multiple
   * times.
   */
  dispose(): void;
};
