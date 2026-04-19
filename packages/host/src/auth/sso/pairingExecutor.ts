/**
 * Pairing executor.
 *
 * Defines the PairingExecutor interface and PairingResult type, and provides
 * the concrete QR-code-based implementation following triangle-js-sdks'
 * wire format exactly. Generates fresh entropy, derives sr25519 and P-256 keys,
 * publishes the handshake payload, and waits for the mobile wallet's response.
 */

import { randomBytes } from '@noble/hashes/utils.js';
import type { StatementStoreAdapter } from '../../statementStore/types.js';
import type { PersistedSessionMeta } from './sessionStore.js';
import type { PersistedSecrets } from './secretStore.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Result of a successful pairing handshake.
 */
export type PairingResult = {
  /** Session metadata to persist. */
  session: PersistedSessionMeta;
  /** Cryptographic secrets to persist for session reconnection. */
  secrets: PersistedSecrets;
};

/**
 * Pluggable pairing protocol.
 */
export type PairingExecutor = {
  execute(onQrPayload: (payload: string) => void, signal: AbortSignal): Promise<PairingResult | undefined>;
};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------
import { HandshakeData, HandshakeResponsePayload, HandshakeResponseSensitiveData } from './codecs.js';
import {
  createAccountId,
  createEncryption,
  createP256Secret,
  createP256SharedSecret,
  createSr25519Secret,
  deriveHandshakeTopic,
  deriveSr25519PublicKey,
  getP256PublicKey,
} from './crypto.js';
import { AccountId } from '@polkadot-api/substrate-bindings';
import { runAttestation } from './attestation.js';
import type { DerivedAccount } from './attestation.js';
import { signWithSr25519 } from './crypto.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export type PairingExecutorConfig = {
  /** Statement store adapter for the pairing handshake. */
  statementStore: StatementStoreAdapter;
  /** URL to the host metadata JSON (shown to the mobile wallet). */
  metadata: string;
  /** Optional host version string. */
  hostVersion?: string;
  /** Optional OS type string. */
  osType?: string;
  /** Optional OS version string. */
  osVersion?: string;
  /**
   * Function returning the polkadot-api unsafe API for the People parachain.
   * Required for attestation. If not provided, attestation is skipped.
   */
  getUnsafeApi?: () => unknown;
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
  const { statementStore } = config;
  const accountIdCodec = AccountId();

  return {
    async execute(onQrPayload: (payload: string) => void, signal: AbortSignal): Promise<PairingResult | undefined> {
      // 1. Generate fresh 16 bytes of entropy and derive keys
      //    (equivalent to mnemonicToEntropy(generateMnemonic()) — the mnemonic
      //    is never displayed or stored, so the BIP-39 round-trip is redundant)
      const entropy = randomBytes(16);
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

      // 6. Start attestation in parallel with the handshake (if API provided)
      let attestationPromise: Promise<void> | undefined;
      if (config.getUnsafeApi) {
        const candidate: DerivedAccount = {
          secret: ssSecret,
          publicKey: ssPublicKey,
          entropy,
          sign: (message: Uint8Array) => signWithSr25519(ssSecret, message),
        };
        attestationPromise = runAttestation(candidate, config.getUnsafeApi, signal).catch(e => {
          console.warn('[sso] Attestation failed (non-fatal):', e instanceof Error ? e.message : e);
        });
      }

      // 7. Subscribe to handshake topic and wait for mobile response
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
              const [walletEncrPublicKey, walletAccountId] = HandshakeResponseSensitiveData.dec(decrypted);

              // 11. Derive the shared secret for the session
              const sharedSecret = createP256SharedSecret(encrSecret, walletEncrPublicKey);

              // 12. Build session metadata
              const address = accountIdCodec.dec(walletAccountId);

              const session: PersistedSessionMeta = {
                sessionId: `${toHex(accountId)}_${toHex(walletAccountId)}`,
                address,
                displayName: address.slice(0, 8) + '...' + address.slice(-6),
                sessionKey: sharedSecret,
                remoteAccountId: walletAccountId,
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

      if (!result) return undefined;

      // Wait for attestation to complete before returning
      // (session is only usable after both handshake AND attestation succeed)
      if (attestationPromise) {
        await attestationPromise;
      }

      if (signal.aborted) return undefined;

      return result;
    },
  };
}
