/**
 * Identity type stubs.
 *
 * These types will be fully defined when identity resolution is ported
 * from host-papp. For now they provide the interface shape.
 */

export type IdentityProvider = {
  /** Resolve a user's identity from their public key. */
  getIdentity(accountIdHex: string): Promise<ResolvedIdentity | null>;
};

export type ResolvedIdentity = {
  /** Short username (e.g., the lite/anonymous username). */
  liteUsername: string;
  /** Full display name if available. */
  fullUsername: string | null;
  /** Optional avatar URL. */
  avatarUrl?: string;
  /** Chain-specific identity fields. */
  chainIdentity?: Record<string, unknown>;
};
