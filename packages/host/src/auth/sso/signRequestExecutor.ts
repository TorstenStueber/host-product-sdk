/**
 * Concrete SignRequestExecutor implementation.
 *
 * Routes sign requests through the SSO encrypted channel following
 * triangle-js-sdks' wire format. Encodes the request as a RemoteMessage,
 * encrypts with AES-GCM using the session key, publishes as a statement,
 * and waits for the mobile wallet's signed response.
 */

import type { SsoTransport, SsoSigner } from './transport.js';
import type {
  SignRequestExecutor,
  RemoteSignPayloadRequest,
  RemoteSignRawRequest,
  RemoteSignResult,
} from './signing.js';
import { RemoteMessageCodec } from './codecs.js';
import { createEncryption, khash, concatBytes } from './crypto.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export type SignRequestExecutorConfig = {
  /** AES session key established during pairing (32 bytes). */
  sessionKey: Uint8Array;
  /** The signer for statement proofs. */
  signer: SsoSigner;
  /** Remote account ID (32 bytes) — used for channel derivation. */
  remoteAccountId: Uint8Array;
  /** Local account ID (32 bytes) — used for channel derivation. */
  localAccountId: Uint8Array;
  /** Session ID — used as topic for statement subscriptions. */
  sessionId: Uint8Array;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const textEncoder = new TextEncoder();

function generateMessageId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  let id = '';
  for (const b of bytes) {
    id += b.toString(36);
  }
  return id;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export function createSignRequestExecutor(config: SignRequestExecutorConfig): SignRequestExecutor {
  const encryption = createEncryption(config.sessionKey);

  // Derive session topic for subscriptions
  const sessionTopic = khash(config.localAccountId, concatBytes(config.remoteAccountId, textEncoder.encode('session')));

  async function sendAndWait(
    transport: SsoTransport,
    messageId: string,
    encodedMessage: Uint8Array,
    signal: AbortSignal,
  ): Promise<RemoteSignResult> {
    const encrypted = encryption.encrypt(encodedMessage);

    // Subscribe for response BEFORE sending the request
    return new Promise<RemoteSignResult>((resolve, reject) => {
      const sub = transport.subscribe([sessionTopic], statements => {
        if (signal.aborted) {
          sub.unsubscribe();
          reject(new Error('Sign request aborted'));
          return;
        }

        for (const statement of statements) {
          if (!statement.data || statement.data.length === 0) continue;

          try {
            const decrypted = encryption.decrypt(statement.data);
            const decoded = RemoteMessageCodec.dec(decrypted);

            if (decoded.data.tag !== 'v1' || decoded.data.value.tag !== 'SignResponse') {
              continue;
            }

            const response = decoded.data.value.value;
            if (response.respondingTo !== messageId) continue;

            sub.unsubscribe();

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
            // Ignore malformed/undecryptable statements
          }
        }
      });

      signal.addEventListener('abort', () => {
        sub.unsubscribe();
        reject(new Error('Sign request aborted'));
      });

      // Sign and submit the request
      config.signer
        .sign(encrypted)
        .then(signature =>
          transport.submit({
            channel: sessionTopic,
            topics: [sessionTopic],
            data: encrypted,
            proof: {
              publicKey: config.signer.publicKey,
              signature,
            },
          }),
        )
        .catch(reject);
    });
  }

  return {
    async signPayload(
      transport: SsoTransport,
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
              // Cast: RemoteSignPayloadRequest uses plain string, codec expects `0x${string}`
              value: request as never,
            },
          },
        },
      });
      return sendAndWait(transport, messageId, encoded, signal);
    },

    async signRaw(
      transport: SsoTransport,
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
      return sendAndWait(transport, messageId, encoded, signal);
    },
  };
}
