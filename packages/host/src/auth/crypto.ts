/**
 * HDKD derivation helper.
 *
 * Derives a product-specific public key from the user's root public key
 * using HDKD soft derivation through junctions ['product', productId, derivationIndex].
 *
 * Ported from dotli-clone/account.ts.
 *
 * NOTE: This module requires `@scure/sr25519` as a peer dependency.
 * The HDKD.publicSoft function must be provided via injectHDKD() or
 * passed directly.
 */

// ---------------------------------------------------------------------------
// Chain code encoding
// ---------------------------------------------------------------------------

/**
 * Create a 32-byte chain code from a string.
 *
 * If the string represents a number, it is encoded as a little-endian u32.
 * Otherwise, it is encoded as SCALE compact-length prefixed bytes.
 */
function createChainCode(code: string): Uint8Array {
  const chainCode = new Uint8Array(32);

  if (!Number.isNaN(Number(code))) {
    // Encode as u32 little-endian
    const num = Number(code);
    chainCode[0] = num & 0xff;
    chainCode[1] = (num >>> 8) & 0xff;
    chainCode[2] = (num >>> 16) & 0xff;
    chainCode[3] = (num >>> 24) & 0xff;
  } else {
    // Encode string as SCALE compact-length prefixed bytes
    const encoder = new TextEncoder();
    const bytes = encoder.encode(code);
    // Simple compact encoding: for lengths < 64 the compact prefix is (len << 2)
    const compactLen = bytes.length << 2;
    chainCode[0] = compactLen & 0xff;
    chainCode.set(bytes, 1);
  }

  return chainCode;
}

// ---------------------------------------------------------------------------
// HDKD injection
// ---------------------------------------------------------------------------

type PublicSoftFn = (publicKey: Uint8Array, chainCode: Uint8Array) => Uint8Array;

let _publicSoft: PublicSoftFn | undefined;

/**
 * Inject the HDKD.publicSoft function.
 *
 * Must be called before deriveProductPublicKey if @scure/sr25519 is available.
 * Example:
 *   import { HDKD } from '@scure/sr25519';
 *   injectHDKD(HDKD.publicSoft);
 */
export function injectHDKD(publicSoft: PublicSoftFn): void {
  _publicSoft = publicSoft;
}

// ---------------------------------------------------------------------------
// Derivation
// ---------------------------------------------------------------------------

/**
 * Derive a product-specific public key using HDKD soft derivation.
 *
 * @param rootPublicKey - The user's root sr25519 public key (32 bytes)
 * @param productId - The product/dot.ns identifier
 * @param derivationIndex - The derivation index for key rotation
 * @returns The derived public key (32 bytes)
 */
export function deriveProductPublicKey(
  rootPublicKey: Uint8Array,
  productId: string,
  derivationIndex: number,
): Uint8Array {
  if (!_publicSoft) {
    throw new Error(
      'HDKD not injected. Call injectHDKD(HDKD.publicSoft) from @scure/sr25519 before using deriveProductPublicKey.',
    );
  }

  const junctions = ['product', productId, String(derivationIndex)];

  return junctions.reduce<Uint8Array>((publicKey, junction) => {
    return _publicSoft!(publicKey, createChainCode(junction));
  }, rootPublicKey);
}
