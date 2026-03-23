/**
 * Concrete PairingExecutor implementation.
 *
 * Implements the QR-code-based pairing handshake following triangle-js-sdks'
 * wire format exactly. Generates a mnemonic, derives sr25519 and P-256 keys,
 * publishes the handshake payload, and waits for the mobile wallet's response.
 */

import type { StatementStoreAdapter } from '../../statementStore/types.js';
import type { PairingExecutor, PairingResult } from './manager.js';
import type { PersistedSessionMeta } from './transport.js';
import { HandshakeData, HandshakeResponsePayload, HandshakeResponseSensitiveData } from './codecs.js';
import {
  createAccountId,
  createEncryption,
  createP256Secret,
  createP256SharedSecret,
  createSr25519Secret,
  deriveHandshakeTopic,
  deriveSr25519PublicKey,
  generateMnemonic,
  getP256PublicKey,
  mnemonicToEntropy,
} from './crypto.js';
import { AccountId } from '@polkadot-api/substrate-bindings';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export type PairingExecutorConfig = {
  /** URL to the host metadata JSON (shown to the mobile wallet). */
  metadata: string;
  /** Optional host version string. */
  hostVersion?: string;
  /** Optional OS type string. */
  osType?: string;
  /** Optional OS version string. */
  osVersion?: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toHex(bytes: Uint8Array): string {
  let hex = '';
  for (const b of bytes) {
    hex += b.toString(16).padStart(2, '0');
  }
  return hex;
}

function createDeeplink(payload: Uint8Array): string {
  return `polkadotapp://pair?handshake=${toHex(payload)}`;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export function createPairingExecutor(config: PairingExecutorConfig): PairingExecutor {
  const accountIdCodec = AccountId();

  return {
    async execute(
      statementStore: StatementStoreAdapter,
      onQrPayload: (payload: string) => void,
      signal: AbortSignal,
    ): Promise<PairingResult | undefined> {
      // 1. Generate fresh mnemonic and derive keys
      const mnemonic = generateMnemonic();
      const entropy = mnemonicToEntropy(mnemonic);
      const ssSecret = createSr25519Secret(entropy, '//wallet//sso');
      const ssPublicKey = deriveSr25519PublicKey(ssSecret);
      const accountId = createAccountId(ssPublicKey);

      // 2. Generate P-256 encryption keypair
      const encrSecret = createP256Secret(entropy);
      const encrPublicKey = getP256PublicKey(encrSecret);

      // 3. Build handshake payload (SCALE-encoded)
      const handshakePayload = HandshakeData.enc({
        tag: 'v1',
        value: {
          ssPublicKey,
          encrPublicKey,
          metadata: config.metadata,
          hostVersion: config.hostVersion,
          osType: config.osType,
          osVersion: config.osVersion,
        },
      });

      // 4. Derive handshake topic
      const topic = deriveHandshakeTopic(accountId, encrPublicKey);

      // 5. Show QR code
      const deeplink = createDeeplink(handshakePayload);
      onQrPayload(deeplink);

      if (signal.aborted) return undefined;

      // 6. Subscribe to handshake topic and wait for mobile response
      const result = await new Promise<PairingResult | undefined>(resolve => {
        const unsub = statementStore.subscribe([topic], statements => {
          if (signal.aborted) {
            unsub();
            resolve(undefined);
            return;
          }

          for (const statement of statements) {
            if (!statement.data || statement.data.length === 0) continue;

            try {
              // 7. Parse mobile's handshake response
              const decoded = HandshakeResponsePayload.dec(statement.data);
              if (decoded.tag !== 'v1') continue;
              const { encrypted, tmpKey } = decoded.value;

              // 8. P-256 ECDH to derive symmetric key
              const symmetricKey = createP256SharedSecret(encrSecret, tmpKey);

              // 9. Decrypt the sensitive data
              const encryption = createEncryption(symmetricKey);
              const decrypted = encryption.decrypt(encrypted);

              // 10. Extract remote P-256 public key and account ID
              const [pappEncrPublicKey, pappAccountId] = HandshakeResponseSensitiveData.dec(decrypted);

              // 11. Derive the shared secret for the session
              const sharedSecret = createP256SharedSecret(encrSecret, pappEncrPublicKey);

              // 12. Build session metadata
              const address = accountIdCodec.dec(pappAccountId);

              const session: PersistedSessionMeta = {
                sessionId: `${toHex(accountId)}_${toHex(pappAccountId)}`,
                address,
                displayName: address.slice(0, 8) + '...' + address.slice(-6),
                remotePublicKey: sharedSecret,
                remoteAccountId: pappAccountId,
              };

              unsub();
              resolve({
                session,
                secrets: {
                  ssSecret,
                  encrSecret,
                  entropy,
                },
              });
              return;
            } catch {
              // Ignore malformed statements, keep waiting
            }
          }
        });

        signal.addEventListener('abort', () => {
          unsub();
          resolve(undefined);
        });
      });

      return result;
    },
  };
}
