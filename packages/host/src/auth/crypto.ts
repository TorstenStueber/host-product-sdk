/**
 * Product account derivation.
 *
 * Derives a product-specific public key from the user's root public key
 * using sr25519 HDKD soft derivation through the path `/product/{productId}/{derivationIndex}`.
 */

import { sr25519DerivePublicKey } from './hdkd.js';

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
  return sr25519DerivePublicKey(rootPublicKey, `/product/${productId}/${derivationIndex}`);
}
