/**
 * Identity provider.
 *
 * Defines the IdentityProvider interface and ResolvedIdentity type, and provides
 * the concrete chain-based implementation that queries Resources.Consumers on
 * the People parachain via the unsafe API from a StatementStoreClient.
 */

import { hexToBytes } from '@polkadot/api-protocol';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type IdentityProvider = {
  /** Resolve a user's identity from their public key. */
  getIdentity(accountIdHex: string): Promise<ResolvedIdentity | undefined>;
};

export type ResolvedIdentity = {
  /** Short username (e.g., the lite/anonymous username). */
  liteUsername: string;
  /** Full display name if available. */
  fullUsername?: string;
  /** Chain-specific identity fields. */
  chainIdentity?: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Create an identity provider that queries the People parachain.
 *
 * @param getUnsafeApi - Function that returns the polkadot-api unsafe API.
 *   Typically `statementStoreClient.getUnsafeApi`.
 */
export function createChainIdentityProvider(getUnsafeApi: () => unknown): IdentityProvider {
  return {
    async getIdentity(accountIdHex: string): Promise<ResolvedIdentity | undefined> {
      const api = getUnsafeApi() as {
        query?: {
          Resources?: {
            Consumers?: {
              getValue?: (account: unknown) => Promise<unknown>;
            };
          };
        };
      };

      const method = api?.query?.Resources?.Consumers?.getValue;
      if (!method) {
        return undefined;
      }

      // polkadot-api's AccountId codec
      const { AccountId } = await import('polkadot-api');
      const accCodec = AccountId();

      // Decode hex to SS58 address for the query
      const bytes = hexToBytes(accountIdHex);
      const address = accCodec.dec(bytes);

      try {
        const result = (await method([address])) as
          | {
              lite_username?: { asText?: () => string };
              full_username?: { asText?: () => string } | undefined;
              credibility?: { type?: string; value?: unknown };
            }
          | undefined;

        if (!result) return undefined;

        const liteUsername = result.lite_username?.asText?.() ?? accountIdHex.slice(0, 8);
        const fullUsername = result.full_username?.asText?.();

        return {
          liteUsername,
          fullUsername,
          chainIdentity: result.credibility
            ? {
                type: result.credibility.type,
                value: result.credibility.value,
              }
            : undefined,
        };
      } catch {
        return undefined;
      }
    },
  };
}
