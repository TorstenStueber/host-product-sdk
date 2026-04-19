/**
 * Concrete SignRequestExecutor implementation.
 *
 * Routes sign requests through the SSO encrypted channel following
 * triangle-js-sdks' wire format. Encodes the request as a RemoteMessage
 * wrapped in a StatementData request, encrypts with AES-GCM using the
 * session key, publishes as a statement, and waits for the mobile wallet's
 * signed response.
 *
 * Session topology matches triangle-js-sdks:
 * - outgoingSessionId = createSessionId(sessionKey, localAccountId, remoteAccountId)
 * - incomingSessionId = createSessionId(sessionKey, remoteAccountId, localAccountId)
 * - Host submits on outgoingSessionId topic, request channel
 * - Host subscribes to incomingSessionId topic for wallet responses
 */

import type { StatementStoreAdapter, Statement } from '../../statementStore/types.js';
import type { SsoSigner } from './types.js';
import type {
  SignRequestExecutor,
  RemoteSignPayloadRequest,
  RemoteSignRawRequest,
  RemoteSignResult,
} from './signing.js';
import { RemoteMessageCodec, StatementDataCodec } from './codecs.js';
import { createEncryption, createSessionId, createRequestChannel } from './crypto.js';

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

  async function sendAndWait(
    store: StatementStoreAdapter,
    messageId: string,
    encodedRemoteMessage: Uint8Array,
    signal: AbortSignal,
  ): Promise<RemoteSignResult> {
    // Wrap in StatementData request (matches triangle-js-sdks session.submitRequestMessage)
    const statementData = StatementDataCodec.enc({
      tag: 'request',
      value: { requestId: messageId, data: [encodedRemoteMessage] },
    });

    const encrypted = encryption.encrypt(statementData);

    // Subscribe for response BEFORE sending the request.
    // The wallet responds on the incomingSessionId topic with a StatementData::request
    // containing a RemoteMessage with SignResponse.
    return new Promise<RemoteSignResult>((resolve, reject) => {
      const unsub = store.subscribe([incomingSessionId], (statements: Statement[]) => {
        if (signal.aborted) {
          unsub();
          reject(new Error('Sign request aborted'));
          return;
        }

        for (const statement of statements) {
          if (!statement.data || statement.data.length === 0) continue;

          try {
            const decrypted = encryption.decrypt(statement.data);
            const statementData = StatementDataCodec.dec(decrypted);

            // The wallet sends the SignResponse as a StatementData::request
            if (statementData.tag !== 'request') continue;

            for (const payload of statementData.value.data) {
              try {
                const decoded = RemoteMessageCodec.dec(payload);

                if (decoded.data.tag !== 'v1' || decoded.data.value.tag !== 'SignResponse') {
                  continue;
                }

                const response = decoded.data.value.value;
                if (response.respondingTo !== messageId) continue;

                unsub();

                if (response.payload.success) {
                  resolve({
                    signature: response.payload.value.signature,
                    signedTransaction: response.payload.value.signedTransaction,
                  });
                } else {
                  reject(new Error(response.payload.value));
                }
                return;
              } catch {
                // Ignore unparseable payloads within the StatementData
              }
            }
          } catch {
            // Ignore malformed/undecryptable statements
          }
        }
      });

      signal.addEventListener('abort', () => {
        unsub();
        reject(new Error('Sign request aborted'));
      });

      // Sign and submit the request on the outgoing session
      config.signer
        .sign(encrypted)
        .then(signature =>
          store.submit({
            expiry: nextExpiry(),
            channel: outgoingRequestChannel,
            topics: [outgoingSessionId],
            data: encrypted,
            decryptionKey: undefined,
            proof: {
              tag: 'Sr25519',
              value: {
                signer: config.signer.publicKey,
                signature,
              },
            },
          }),
        )
        .catch(reject);
    });
  }

  return {
    async signPayload(
      store: StatementStoreAdapter,
      request: RemoteSignPayloadRequest,
      signal: AbortSignal,
    ): Promise<RemoteSignResult> {
      const messageId = generateMessageId();
      const encoded = RemoteMessageCodec.enc({
        messageId,
        data: {
          tag: 'v1',
          value: {
            tag: 'SignRequest',
            value: {
              tag: 'Payload',
              value: request as never,
            },
          },
        },
      });
      return sendAndWait(store, messageId, encoded, signal);
    },

    async signRaw(
      store: StatementStoreAdapter,
      request: RemoteSignRawRequest,
      signal: AbortSignal,
    ): Promise<RemoteSignResult> {
      const messageId = generateMessageId();
      const encoded = RemoteMessageCodec.enc({
        messageId,
        data: {
          tag: 'v1',
          value: {
            tag: 'SignRequest',
            value: {
              tag: 'Raw',
              value: request,
            },
          },
        },
      });
      return sendAndWait(store, messageId, encoded, signal);
    },
  };
}
