/**
 * Sign request executor.
 *
 * Thin application layer on top of the generic statement-store
 * {@link Session}. The session handles the transport protocol (ACKs,
 * batching, channel replacement, expiry monotonicity, init recovery,
 * dedup, proof verification, late-subscriber buffering, dispose); this
 * file only knows about the SSO-specific application codec:
 *
 *   RemoteMessage { messageId, data: v1 { SignRequest | SignResponse | Disconnected } }
 *
 * Flow:
 *   1. Encode the outgoing RemoteMessage with a fresh messageId.
 *   2. `session.request(RemoteMessageCodec, message)` — submits, waits
 *      for the wallet's ACK, resolves when ACKed.
 *   3. Filter the session's subscribe stream for a RequestMessage whose
 *      payload parses as `RemoteMessage` with a `SignResponse` whose
 *      `respondingTo` matches our messageId.
 *   4. ACK the wallet's response with `submitResponseMessage`.
 *   5. Return the signature.
 */

import { ResultAsync, err, ok, type Result } from 'neverthrow';
import type { RemoteSessionAccount, Message, Session, SessionError } from '../../statementStore/session/index.js';
import type { SigningPayloadRequest, SigningRawRequest, SigningPayloadResponseData, RemoteMessage } from './codecs.js';
import { RemoteMessageCodec } from './codecs.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RemoteSignPayloadRequest = SigningPayloadRequest;
export type RemoteSignRawRequest = SigningRawRequest;
export type RemoteSignResult = SigningPayloadResponseData;

/**
 * Flat discriminated union of remote-signing failure modes.
 */
export type RemoteSignError =
  | { tag: 'Aborted' }
  | { tag: 'NotPaired' }
  | { tag: 'Timeout' }
  /** The mobile wallet returned an error payload in its SignResponse. */
  | { tag: 'Rejected'; reason: string }
  /** The session layer reported a transport-level failure. */
  | { tag: 'Session'; cause: SessionError }
  /** Anything else. */
  | { tag: 'Unknown'; detail: string };

/**
 * Pluggable sign request executor. `session` is owned by the caller and
 * is assumed to be long-lived (created at pair-success, disposed at unpair).
 * `remoteAccount` is used only for the `address` pre-flight check —
 * filtering happens at the message-matching layer.
 */
export type SignRequestExecutor = {
  signPayload(
    session: Session,
    request: RemoteSignPayloadRequest,
    signal: AbortSignal,
  ): ResultAsync<RemoteSignResult, RemoteSignError>;

  signRaw(
    session: Session,
    request: RemoteSignRawRequest,
    signal: AbortSignal,
  ): ResultAsync<RemoteSignResult, RemoteSignError>;
};

export type SignRequestExecutorConfig = {
  /** Remote account descriptor (carried through for documentation; not used in the current flow). */
  remoteAccount: RemoteSessionAccount;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateMessageId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  let id = '';
  for (const b of bytes) id += b.toString(36);
  return id;
}

function sessionErr(cause: SessionError): RemoteSignError {
  return { tag: 'Session', cause };
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export function createSignRequestExecutor(_config: SignRequestExecutorConfig): SignRequestExecutor {
  function sendAndWait(
    session: Session,
    message: RemoteMessage,
    signal: AbortSignal,
  ): ResultAsync<RemoteSignResult, RemoteSignError> {
    const messageId = message.messageId;

    // Start listening for the wallet's SignResponse BEFORE submitting,
    // so we can never miss an early response. Each subscriber decodes
    // through RemoteMessageCodec and we filter for our messageId.
    const responsePromise = new Promise<Result<RemoteSignResult, RemoteSignError>>(resolve => {
      let settled = false;
      let unsub: () => void = () => {};
      const settle = (r: Result<RemoteSignResult, RemoteSignError>): void => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', onAbort);
        unsub();
        resolve(r);
      };
      const onAbort = () => settle(err({ tag: 'Aborted' }));

      unsub = session.subscribe(RemoteMessageCodec, (messages: Message<RemoteMessage>[]) => {
        for (const m of messages) {
          if (m.type !== 'request') continue;
          if (m.payload.status !== 'parsed') continue;
          const remote = m.payload.value;
          if (remote.data.tag !== 'v1' || remote.data.value.tag !== 'SignResponse') continue;
          const response = remote.data.value.value;
          if (response.respondingTo !== messageId) continue;

          // ACK the wallet's response. Best-effort: failure here doesn't
          // prevent us from returning the signature.
          void session.submitResponseMessage(m.requestId, 'success').match(
            () => {},
            e => console.warn('[sso] submitResponseMessage failed', e),
          );

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
      });

      if (signal.aborted) {
        settle(err({ tag: 'Aborted' }));
        return;
      }
      signal.addEventListener('abort', onAbort);

      // Submit the request through the session. If the session itself
      // rejects (encode / submit / peer ACK not success), surface that
      // under `Session` tag.
      void session.request(RemoteMessageCodec, message).match(
        () => {
          // ACK success — keep waiting for the wallet's application reply.
        },
        e => settle(err(sessionErr(e))),
      );
    });

    return ResultAsync.fromSafePromise(responsePromise).andThen(r => r);
  }

  return {
    signPayload(session, request, signal) {
      const messageId = generateMessageId();
      return sendAndWait(
        session,
        {
          messageId,
          data: {
            tag: 'v1',
            value: {
              tag: 'SignRequest',
              value: { tag: 'Payload', value: request as never },
            },
          },
        },
        signal,
      );
    },

    signRaw(session, request, signal) {
      const messageId = generateMessageId();
      return sendAndWait(
        session,
        {
          messageId,
          data: {
            tag: 'v1',
            value: {
              tag: 'SignRequest',
              value: { tag: 'Raw', value: request },
            },
          },
        },
        signal,
      );
    },
  };
}
