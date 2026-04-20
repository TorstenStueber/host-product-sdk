/**
 * Sign request executor.
 *
 * Defines the SignRequestExecutor interface and remote sign types, and provides
 * the concrete implementation that routes sign requests through the SSO
 * encrypted channel following triangle-js-sdks' wire format. Encodes the
 * request as a RemoteMessage wrapped in a StatementData request, encrypts with
 * AES-GCM using the session key, publishes as a statement, and waits for the
 * mobile wallet's signed response.
 *
 * Session topology matches triangle-js-sdks:
 * - outgoingSessionId = createSessionId(sessionKey, localAccountId, remoteAccountId)
 * - incomingSessionId = createSessionId(sessionKey, remoteAccountId, localAccountId)
 * - Host submits on outgoingSessionId topic, request channel
 * - Host subscribes to incomingSessionId topic for wallet responses
 *
 * All failures are returned as a flat {@link RemoteSignError} union via
 * neverthrow's `ResultAsync`.
 */

import { ResultAsync, err, ok, type Result } from 'neverthrow';
import type { StatementStoreAdapter, Statement, StatementStoreError } from '../../statementStore/types.js';
import type { SsoSigner } from './types.js';
import type { SigningPayloadRequest, SigningRawRequest, SigningPayloadResponseData } from './codecs.js';
import { RemoteMessageCodec, StatementDataCodec } from './codecs.js';
import { createEncryption, createSessionId, createRequestChannel } from './crypto.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RemoteSignPayloadRequest = SigningPayloadRequest;
export type RemoteSignRawRequest = SigningRawRequest;
export type RemoteSignResult = SigningPayloadResponseData;

/**
 * Flat discriminated union of remote-signing failure modes.
 *
 * Callers use `.match()` or a `switch` on `.tag` to branch.
 */
export type RemoteSignError =
  | { tag: 'Aborted' }
  | { tag: 'NotPaired' }
  | { tag: 'Timeout' }
  /** The mobile wallet returned an error payload in its SignResponse. */
  | { tag: 'Rejected'; reason: string }
  /** The statement-store adapter rejected the outgoing submit. */
  | { tag: 'StatementStore'; cause: StatementStoreError }
  /** Anything else (signer threw, unexpected shape, etc.). */
  | { tag: 'Unknown'; detail: string };

/**
 * Pluggable sign request executor.
 */
export type SignRequestExecutor = {
  signPayload(
    store: StatementStoreAdapter,
    request: RemoteSignPayloadRequest,
    signal: AbortSignal,
  ): ResultAsync<RemoteSignResult, RemoteSignError>;

  signRaw(
    store: StatementStoreAdapter,
    request: RemoteSignRawRequest,
    signal: AbortSignal,
  ): ResultAsync<RemoteSignResult, RemoteSignError>;
};

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export type SignRequestExecutorConfig = {
  /** AES session key / P-256 shared secret established during pairing (32 bytes). */
  sessionKey: Uint8Array;
  /** The signer for statement proofs. */
  signer: SsoSigner;
  /** Remote account ID (32 bytes). */
  remoteAccountId: Uint8Array;
  /** Local account ID (32 bytes). */
  localAccountId: Uint8Array;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateMessageId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  let id = '';
  for (const b of bytes) {
    id += b.toString(36);
  }
  return id;
}

// Monotonically increasing expiry: upper 32 bits = 7 days from now, lower 32 bits = sequence
let expirySequence = 0;
function nextExpiry(): bigint {
  const sevenDays = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;
  return (BigInt(sevenDays) << 32n) | BigInt(expirySequence++);
}

function unknownError(e: unknown): RemoteSignError {
  return { tag: 'Unknown', detail: e instanceof Error ? e.message : String(e) };
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export function createSignRequestExecutor(config: SignRequestExecutorConfig): SignRequestExecutor {
  const encryption = createEncryption(config.sessionKey);

  // Derive session IDs (matches triangle-js-sdks createSessionId)
  const outgoingSessionId = createSessionId(config.sessionKey, config.localAccountId, config.remoteAccountId);
  const incomingSessionId = createSessionId(config.sessionKey, config.remoteAccountId, config.localAccountId);

  // Derive channel for outgoing requests
  const outgoingRequestChannel = createRequestChannel(outgoingSessionId);

  function sendAndWait(
    store: StatementStoreAdapter,
    messageId: string,
    encodedRemoteMessage: Uint8Array,
    signal: AbortSignal,
  ): ResultAsync<RemoteSignResult, RemoteSignError> {
    // Wrap in StatementData request (matches triangle-js-sdks session.submitRequestMessage)
    const statementData = StatementDataCodec.enc({
      tag: 'request',
      value: { requestId: messageId, data: [encodedRemoteMessage] },
    });

    const encrypted = encryption.encrypt(statementData);

    // The orchestration below can finish in any of four ways:
    //   1. matching SignResponse decoded from an incoming statement → ok / err
    //   2. signal aborted                                            → err(Aborted)
    //   3. store.submit() rejected                                   → err(StatementStore)
    //   4. signer.sign() threw                                       → err(Unknown)
    // We fold all of them into a single Promise<Result<...>> and lift it into
    // a ResultAsync so callers can compose with `.andThen` / `.mapErr`.
    const promise = new Promise<Result<RemoteSignResult, RemoteSignError>>(resolve => {
      let settled = false;
      let unsub: () => void = () => {};
      let abortHandler: () => void = () => {};
      const settle = (r: Result<RemoteSignResult, RemoteSignError>) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', abortHandler);
        unsub();
        resolve(r);
      };

      unsub = store.subscribe([incomingSessionId], (statements: Statement[]) => {
        if (signal.aborted) {
          settle(err({ tag: 'Aborted' }));
          return;
        }

        for (const statement of statements) {
          if (!statement.data || statement.data.length === 0) continue;

          let statementData;
          try {
            const decrypted = encryption.decrypt(statement.data);
            statementData = StatementDataCodec.dec(decrypted);
          } catch {
            // Malformed / not-for-us — keep scanning.
            continue;
          }

          if (statementData.tag !== 'request') continue;

          for (const payload of statementData.value.data) {
            let decoded;
            try {
              decoded = RemoteMessageCodec.dec(payload);
            } catch {
              continue;
            }
            if (decoded.data.tag !== 'v1' || decoded.data.value.tag !== 'SignResponse') continue;

            const response = decoded.data.value.value;
            if (response.respondingTo !== messageId) continue;

            if (response.payload.success) {
              settle(
                ok({
                  signature: response.payload.value.signature,
                  signedTransaction: response.payload.value.signedTransaction,
                }),
              );
            } else {
              settle(err({ tag: 'Rejected', reason: response.payload.value }));
            }
            return;
          }
        }
      });

      abortHandler = () => settle(err({ tag: 'Aborted' }));
      if (signal.aborted) {
        settle(err({ tag: 'Aborted' }));
        return;
      }
      signal.addEventListener('abort', abortHandler);

      // Sign and submit the request on the outgoing session. Both the
      // signer and the store-submit can fail independently.
      config.signer
        .sign(encrypted)
        .then(signature =>
          store
            .submit({
              expiry: nextExpiry(),
              channel: outgoingRequestChannel,
              topics: [outgoingSessionId],
              data: encrypted,
              decryptionKey: undefined,
              proof: {
                tag: 'Sr25519',
                value: { signer: config.signer.publicKey, signature },
              },
            })
            .match(
              () => {
                // Submit OK — wait for the response to arrive through the
                // subscribe path. Nothing to do here.
              },
              storeErr => settle(err({ tag: 'StatementStore', cause: storeErr })),
            ),
        )
        .catch(e => settle(err(unknownError(e))));
    });

    return ResultAsync.fromSafePromise(promise).andThen(r => r);
  }

  return {
    signPayload(store, request, signal) {
      const messageId = generateMessageId();
      const encoded = RemoteMessageCodec.enc({
        messageId,
        data: {
          tag: 'v1',
          value: {
            tag: 'SignRequest',
            value: { tag: 'Payload', value: request as never },
          },
        },
      });
      return sendAndWait(store, messageId, encoded, signal);
    },

    signRaw(store, request, signal) {
      const messageId = generateMessageId();
      const encoded = RemoteMessageCodec.enc({
        messageId,
        data: {
          tag: 'v1',
          value: {
            tag: 'SignRequest',
            value: { tag: 'Raw', value: request },
          },
        },
      });
      return sendAndWait(store, messageId, encoded, signal);
    },
  };
}
