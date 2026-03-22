/**
 * SSO cryptographic primitives.
 *
 * Provides encryption, key derivation, and topic computation used by
 * the pairing and signing protocols. Follows triangle-js-sdks' wire
 * format exactly for mobile wallet compatibility.
 */

import { gcm } from '@noble/ciphers/aes.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { blake2b } from '@noble/hashes/blake2.js';
import { randomBytes } from '@noble/hashes/utils.js';
import { p256 } from '@noble/curves/p256.js';
// @ts-expect-error — @polkadot-labs/hdkd-helpers has no type declarations
import { entropyToMiniSecret, generateMnemonic, mnemonicToEntropy } from '@polkadot-labs/hdkd-helpers';
import {
  HDKD,
  getPublicKey as sr25519GetPublicKey,
  secretFromSeed as sr25519SecretFromSeed,
  sign as sr25519Sign,
} from '@scure/sr25519';
import { str } from 'scale-ts';

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

export type Encryption = {
  encrypt(plaintext: Uint8Array): Uint8Array;
  decrypt(encryptedMessage: Uint8Array): Uint8Array;
};

/**
 * Create an AES-GCM encryption/decryption pair from a shared secret.
 *
 * Key derivation: HKDF-SHA256 with empty salt and info, 32-byte output.
 * Wire format: [nonce(12B) || ciphertext].
 */
export function createEncryption(sharedSecret: Uint8Array): Encryption {
  const salt = new Uint8Array();
  const info = new Uint8Array();
  const aesKey = hkdf(sha256, sharedSecret, salt, info, 32);

  return {
    encrypt(plaintext: Uint8Array): Uint8Array {
      const nonce = randomBytes(12);
      const aes = gcm(aesKey, nonce);
      return concatBytes(nonce, aes.encrypt(plaintext));
    },

    decrypt(encryptedMessage: Uint8Array): Uint8Array {
      const nonce = encryptedMessage.slice(0, 12);
      const ciphertext = encryptedMessage.slice(12);
      const aes = gcm(aesKey, nonce);
      return aes.decrypt(ciphertext);
    },
  };
}

// ---------------------------------------------------------------------------
// blake2b keyed hash (khash)
// ---------------------------------------------------------------------------

/**
 * blake2b_256 with key. Used for topic and session ID derivation.
 */
export function khash(secret: Uint8Array, message: Uint8Array): Uint8Array {
  return blake2b(message, { dkLen: 32, key: secret });
}

// ---------------------------------------------------------------------------
// Sr25519 key derivation
// ---------------------------------------------------------------------------

function createChainCode(derivation: string): Uint8Array {
  const chainCode = new Uint8Array(32);
  chainCode.set(str.enc(derivation));
  return chainCode;
}

function parseDerivations(derivationsStr: string): [type: 'hard' | 'soft', code: string][] {
  const DERIVATION_RE = /(\/{1,2})([^/]+)/g;
  const derivations: [type: 'hard' | 'soft', code: string][] = [];
  for (const [, type, code] of derivationsStr.matchAll(DERIVATION_RE)) {
    if (code) {
      derivations.push([type === '//' ? 'hard' : 'soft', code]);
    }
  }
  return derivations;
}

export function createSr25519Secret(entropy: Uint8Array, derivation?: string): Uint8Array {
  const miniSecret = entropyToMiniSecret(entropy);
  const secret = sr25519SecretFromSeed(miniSecret);
  if (!derivation) return secret;

  return parseDerivations(derivation).reduce((sec, [type, code]) => {
    const chainCode = createChainCode(code);
    return type === 'hard' ? HDKD.secretHard(sec, chainCode) : HDKD.secretSoft(sec, chainCode);
  }, secret);
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
 * Derive a 32-byte account ID from a sr25519 public key.
 * This is blake2b_256(publicKey).
 */
export function createAccountId(publicKey: Uint8Array): Uint8Array {
  return blake2b(publicKey, { dkLen: 32 });
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
