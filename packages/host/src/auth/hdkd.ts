/**
 * Sr25519 hierarchical deterministic key derivation.
 *
 * Wraps `@polkadot-labs/hdkd-helpers`' `createDerive` for path parsing
 * and chain code encoding (correctly handles numeric segments as u32,
 * string segments as SCALE str).
 *
 * Two derivation modes:
 * - **Secret**: from a 32-byte mini-secret + derivation path → 64-byte sr25519 secret key.
 *   Supports both hard (`//`) and soft (`/`) junctions.
 * - **Public**: from a 32-byte public key + derivation path → 32-byte derived public key.
 *   Supports soft (`/`) junctions only — hard junctions throw.
 */

import { createDerive, sr25519 } from '@polkadot-labs/hdkd-helpers';
import { HDKD, secretFromSeed as sr25519SecretFromSeed } from '@scure/sr25519';

import type { Curve, KeyPair } from '@polkadot-labs/hdkd-helpers';

// ---------------------------------------------------------------------------
// Secret key derivation
// ---------------------------------------------------------------------------

/** Like hdkd's sr25519Derive, but returns the raw 64-byte secret key. */
function sr25519DeriveWithSecret(
  seed: Uint8Array,
  curve: Curve,
  derivations: [type: 'hard' | 'soft', chainCode: Uint8Array][],
): KeyPair & { secret: Uint8Array } {
  const secret = derivations.reduce(
    (key, [type, chainCode]) => (type === 'hard' ? HDKD.secretHard : HDKD.secretSoft)(key, chainCode),
    sr25519SecretFromSeed(seed),
  );
  return {
    secret,
    publicKey: curve.getPublicKey(secret) as Uint8Array,
    sign: msg => curve.sign(msg, secret),
  };
}

/**
 * Derive an sr25519 secret key from a mini-secret and a derivation path.
 *
 * @param miniSecret - 32-byte mini-secret (from `entropyToMiniSecret`).
 * @param path - Derivation path, e.g. `"//wallet//sso"` or `"//Alice"`.
 * @returns 64-byte sr25519 secret key.
 */
export function sr25519DeriveSecret(miniSecret: Uint8Array, path: string): Uint8Array {
  const derive = createDerive({
    seed: miniSecret,
    curve: sr25519,
    derive: sr25519DeriveWithSecret as (...args: Parameters<typeof sr25519DeriveWithSecret>) => KeyPair,
  });
  return (derive(path) as unknown as { secret: Uint8Array }).secret;
}

// ---------------------------------------------------------------------------
// Public key derivation (soft junctions only)
// ---------------------------------------------------------------------------

/** Derives child public keys using HDKD.publicSoft. Rejects hard junctions. */
function sr25519DerivePublic(
  publicKey: Uint8Array,
  _curve: Curve,
  derivations: [type: 'hard' | 'soft', chainCode: Uint8Array][],
): KeyPair {
  const derived = derivations.reduce((pk, [type, chainCode]) => {
    if (type === 'hard') throw new Error('Hard derivation is not supported for public key derivation');
    return HDKD.publicSoft(pk, chainCode) as Uint8Array;
  }, publicKey);
  return {
    publicKey: derived,
    sign() {
      throw new Error('Cannot sign with a derived public key');
    },
  };
}

/**
 * Derive an sr25519 public key from a parent public key and a soft derivation path.
 *
 * Only soft (`/`) junctions are allowed — hard (`//`) junctions throw.
 *
 * @param publicKey - 32-byte sr25519 public key.
 * @param path - Soft derivation path, e.g. `"/product/myapp/0"`.
 * @returns 32-byte derived public key.
 */
export function sr25519DerivePublicKey(publicKey: Uint8Array, path: string): Uint8Array {
  const derive = createDerive({
    seed: publicKey,
    curve: sr25519,
    derive: sr25519DerivePublic,
  });
  return derive(path).publicKey as Uint8Array;
}
