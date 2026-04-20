/**
 * SSO cryptographic primitives.
 *
 * Provides encryption, key derivation, and the handshake topic helper
 * used by the pairing handshake. Session-topic and channel derivation
 * moved to `statementStore/session/channels.ts` because they are
 * protocol-level concerns shared with any StatementData-speaking peer.
 *
 * Follows triangle-js-sdks' wire format for mobile wallet compatibility.
 */

import { gcm } from '@noble/ciphers/aes.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { randomBytes } from '@noble/hashes/utils.js';
import { p256 } from '@noble/curves/nist.js';
import { entropyToMiniSecret, generateMnemonic, mnemonicToEntropy } from '@polkadot-labs/hdkd-helpers';
import {
  getPublicKey as sr25519GetPublicKey,
  secretFromSeed as sr25519SecretFromSeed,
  sign as sr25519Sign,
} from '@scure/sr25519';
import { Result } from 'neverthrow';
import type { Encryption, SessionError } from '../../statementStore/session/index.js';
import { khash } from '../../statementStore/session/index.js';
import { sr25519DeriveSecret } from '../hdkd.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const textEncoder = new TextEncoder();

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((sum, a) => sum + a.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    result.set(a, offset);
    offset += a.length;
  }
  return result;
}

// ---------------------------------------------------------------------------
// AES-GCM encryption (compatible with triangle-js-sdks)
// ---------------------------------------------------------------------------

/**
 * Create an AES-GCM encryption/decryption pair from a shared secret.
 *
 * Key derivation: HKDF-SHA256 with empty salt and info, 32-byte output.
 * Wire format: [nonce(12B) || ciphertext].
 *
 * Returns a {@link Encryption} whose methods return `ResultAsync` so
 * decrypt failures (auth-tag mismatch, truncated input) surface as a
 * `SessionError` rather than a throw.
 */
export function createEncryption(sharedSecret: Uint8Array): Encryption {
  const salt = new Uint8Array();
  const info = new Uint8Array();
  const aesKey = hkdf(sha256, sharedSecret, salt, info, 32);

  const encryptionFailed = (e: unknown): SessionError => ({
    tag: 'EncryptionFailed',
    detail: e instanceof Error ? e.message : String(e),
  });

  const encrypt = Result.fromThrowable((plaintext: Uint8Array) => {
    const nonce = randomBytes(12);
    const aes = gcm(aesKey, nonce);
    return concatBytes(nonce, aes.encrypt(plaintext));
  }, encryptionFailed);

  const decrypt = Result.fromThrowable((encryptedMessage: Uint8Array) => {
    const nonce = encryptedMessage.slice(0, 12);
    const ciphertext = encryptedMessage.slice(12);
    const aes = gcm(aesKey, nonce);
    return aes.decrypt(ciphertext);
  }, encryptionFailed);

  return { encrypt, decrypt };
}

// ---------------------------------------------------------------------------
// blake2b keyed hash (khash) — re-exported for the existing SSO callers.
// The single implementation lives in `statementStore/session/channels.ts`
// because the session layer needs it to derive session IDs and channels.
// ---------------------------------------------------------------------------

export { khash };

// ---------------------------------------------------------------------------
// Sr25519 key derivation
// ---------------------------------------------------------------------------

export function createSr25519Secret(entropy: Uint8Array, derivation?: string): Uint8Array {
  const miniSecret = entropyToMiniSecret(entropy);
  if (!derivation) return sr25519SecretFromSeed(miniSecret);
  return sr25519DeriveSecret(miniSecret, derivation);
}

export function deriveSr25519PublicKey(secret: Uint8Array): Uint8Array {
  return sr25519GetPublicKey(secret) as Uint8Array;
}

export function signWithSr25519(secret: Uint8Array, message: Uint8Array): Uint8Array {
  return sr25519Sign(secret, message);
}

// ---------------------------------------------------------------------------
// P-256 key operations (for pairing ECDH)
// ---------------------------------------------------------------------------

export function createP256Secret(entropy: Uint8Array): Uint8Array {
  const miniSecret = entropyToMiniSecret(entropy);
  const seed = new Uint8Array(48);
  seed.set(miniSecret);
  const { secretKey } = p256.keygen(seed);
  return secretKey;
}

export function getP256PublicKey(secret: Uint8Array): Uint8Array {
  return p256.getPublicKey(secret, false);
}

/**
 * P-256 ECDH shared secret — x-coordinate only (32 bytes).
 * Matches triangle-js-sdks: `getSharedSecret().slice(1, 33)`.
 */
export function createP256SharedSecret(secret: Uint8Array, publicKey: Uint8Array): Uint8Array {
  return p256.getSharedSecret(secret, publicKey).slice(1, 33);
}

// ---------------------------------------------------------------------------
// Account ID derivation
// ---------------------------------------------------------------------------

/**
 * Create a 32-byte account ID from a sr25519 public key.
 *
 * For sr25519 (and ed25519), the AccountId IS the raw 32-byte public key —
 * no hashing. This matches standard Substrate behavior and the
 * triangle-js-sdks implementation.
 */
export function createAccountId(publicKey: Uint8Array): Uint8Array {
  return publicKey.slice(0, 32);
}

// ---------------------------------------------------------------------------
// Handshake topic derivation
// ---------------------------------------------------------------------------

/**
 * Derive the handshake topic from the local account ID and P-256 public key.
 * topic = khash(accountId, encrPublicKey || "topic")
 */
export function deriveHandshakeTopic(accountId: Uint8Array, encrPublicKey: Uint8Array): Uint8Array {
  return khash(accountId, concatBytes(encrPublicKey, textEncoder.encode('topic')));
}

// ---------------------------------------------------------------------------
// Mnemonic generation
// ---------------------------------------------------------------------------

export { generateMnemonic, mnemonicToEntropy };

// ---------------------------------------------------------------------------
// Concat helper (re-export for other modules)
// ---------------------------------------------------------------------------

export { concatBytes };
