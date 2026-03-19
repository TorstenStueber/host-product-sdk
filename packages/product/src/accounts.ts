/**
 * Accounts provider for the product SDK.
 *
 * Wraps HostApi account methods into a convenient interface for getting
 * product accounts, non-product accounts, creating ring VRF proofs, and
 * subscribing to account connection status changes.
 *
 * Ported from product-sdk/accounts.ts, adapted to use plain TS types
 * and the Transport abstraction from @polkadot/shared.
 */

import type { Transport } from '@polkadot/shared';
import { ok, err } from '@polkadot/shared';

import { createHostApi } from './hostApi.js';
import { sandboxTransport } from './transport/sandboxTransport.js';
import type {
  AccountConnectionStatus,
  HexString,
  ProductAccount,
  RingLocation,
  SigningResult,
} from './types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const UNSUPPORTED_VERSION_ERROR = 'Unsupported message version';

function enumValue<V extends string, T>(tag: V, value: T): { tag: V; value: T } {
  return { tag, value };
}

function isEnumVariant<V extends string>(
  value: { tag: string; value: unknown },
  variant: V,
): value is { tag: V; value: unknown } {
  return value.tag === variant;
}

function assertEnumVariant<V extends string>(
  value: { tag: string; value: unknown },
  variant: V,
  errorMessage: string,
): asserts value is { tag: V; value: unknown } {
  if (value.tag !== variant) {
    throw new Error(errorMessage);
  }
}

function fromHex(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create an accounts provider bound to a transport.
 *
 * @param transport - The transport to use. Defaults to the sandbox transport.
 */
export const createAccountsProvider = (transport: Transport = sandboxTransport) => {
  const hostApi = createHostApi(transport);

  return {
    /**
     * Get the product account for a given dotNs identifier and derivation index.
     */
    getProductAccount(dotNsIdentifier: string, derivationIndex = 0) {
      return hostApi
        .accountGet(enumValue('v1', [dotNsIdentifier, derivationIndex]))
        .mapErr((e: { tag: string; value: unknown }) => e.value)
        .andThen((response: { tag: string; value: unknown }) => {
          if (isEnumVariant(response, 'v1')) {
            return ok(response.value as ProductAccount);
          }
          return err({ tag: 'Unknown' as const, value: { reason: `Unsupported response version ${response.tag}` } });
        });
    },

    /**
     * Get the contextual alias for a product account.
     */
    getProductAccountAlias(dotNsIdentifier: string, derivationIndex = 0) {
      return hostApi
        .accountGetAlias(enumValue('v1', [dotNsIdentifier, derivationIndex]))
        .mapErr((e: { tag: string; value: unknown }) => e.value)
        .andThen((response: { tag: string; value: unknown }) => {
          if (isEnumVariant(response, 'v1')) {
            return ok(response.value);
          }
          return err({ tag: 'Unknown' as const, value: { reason: `Unsupported response version ${response.tag}` } });
        });
    },

    /**
     * Get all non-product (external) accounts connected to the host.
     */
    getNonProductAccounts() {
      return hostApi
        .getNonProductAccounts(enumValue('v1', undefined))
        .mapErr((e: { tag: string; value: unknown }) => e.value)
        .andThen((response: { tag: string; value: unknown }) => {
          if (isEnumVariant(response, 'v1')) {
            return ok(response.value as Array<{ publicKey: Uint8Array; name: string | null }>);
          }
          return err({ tag: 'Unknown' as const, value: { reason: `Unsupported response version ${response.tag}` } });
        });
    },

    /**
     * Create a ring VRF proof for a product account.
     */
    createRingVRFProof(
      dotNsIdentifier: string,
      derivationIndex = 0,
      location: RingLocation,
      message: Uint8Array,
    ) {
      return hostApi
        .accountCreateProof(
          enumValue('v1', [[dotNsIdentifier, derivationIndex], location, message]),
        )
        .mapErr((e: { tag: string; value: unknown }) => e.value)
        .andThen((response: { tag: string; value: unknown }) => {
          if (isEnumVariant(response, 'v1')) {
            return ok(response.value as Uint8Array);
          }
          return err({ tag: 'Unknown' as const, value: { reason: `Unsupported response version ${response.tag}` } });
        });
    },

    /**
     * Get a PolkadotSigner-compatible object for a product account.
     *
     * This returns an object compatible with `@polkadot-api/pjs-signer`'s
     * signing interface. It delegates signing to the host through the
     * transport layer.
     */
    getProductAccountSigner(account: ProductAccount) {
      return createSignerForAccount(hostApi, account);
    },

    /**
     * Get a PolkadotSigner-compatible object for a non-product account.
     *
     * Same signing interface as `getProductAccountSigner`, but routes
     * through the non-product account signing flow.
     */
    getNonProductAccountSigner(account: ProductAccount) {
      return createSignerForAccount(hostApi, account);
    },

    /**
     * Subscribe to account connection status changes.
     */
    subscribeAccountConnectionStatus(callback: (status: AccountConnectionStatus) => void) {
      return hostApi.accountConnectionStatusSubscribe(
        enumValue('v1', undefined),
        (status: { tag: string; value: unknown }) => {
          if (status.tag === 'v1') {
            callback(status.value as AccountConnectionStatus);
          }
        },
      );
    },
  };
};

// ---------------------------------------------------------------------------
// Signer helper
// ---------------------------------------------------------------------------

function createSignerForAccount(
  hostApi: ReturnType<typeof createHostApi>,
  account: ProductAccount,
) {
  return {
    publicKey: account.publicKey,

    async signPayload(payload: {
      address: string;
      blockHash: string;
      blockNumber: string;
      era: string;
      genesisHash: string;
      method: string;
      nonce: string;
      specVersion: string;
      tip: string;
      transactionVersion: string;
      signedExtensions: string[];
      version: number;
      assetId?: string | undefined;
      metadataHash?: string | undefined;
      mode?: number;
      withSignedTransaction?: boolean;
    }): Promise<{ id: number; signature: HexString; signedTransaction: HexString | null }> {
      const codecPayload = {
        ...payload,
        blockHash: payload.blockHash as HexString,
        blockNumber: payload.blockNumber as HexString,
        era: payload.era as HexString,
        genesisHash: payload.genesisHash as HexString,
        nonce: payload.nonce as HexString,
        method: payload.method as HexString,
        specVersion: payload.specVersion as HexString,
        transactionVersion: payload.transactionVersion as HexString,
        metadataHash: (payload.metadataHash as HexString | undefined) ?? undefined,
        tip: payload.tip as HexString,
        assetId: (payload.assetId as HexString | undefined) ?? undefined,
        mode: payload.mode ?? undefined,
        withSignedTransaction: payload.withSignedTransaction ?? undefined,
      };

      const response = await hostApi.signPayload(enumValue('v1', codecPayload));

      return response.match(
        (response: { tag: string; value: unknown }) => {
          assertEnumVariant(response, 'v1', UNSUPPORTED_VERSION_ERROR);
          const result = response.value as SigningResult;
          return {
            id: 0,
            signature: result.signature,
            signedTransaction: result.signedTransaction ?? null,
          };
        },
        (error: { tag: string; value: unknown }) => {
          assertEnumVariant(error, 'v1', UNSUPPORTED_VERSION_ERROR);
          throw error.value;
        },
      );
    },

    async signRaw(raw: {
      address: string;
      data: string;
      type: 'bytes' | 'payload';
    }): Promise<{ id: number; signature: HexString; signedTransaction: HexString | null }> {
      const payload = {
        address: raw.address,
        data:
          raw.type === 'bytes'
            ? { tag: 'Bytes' as const, value: fromHex(raw.data) }
            : { tag: 'Payload' as const, value: raw.data },
      };

      const response = await hostApi.signRaw(enumValue('v1', payload));

      return response.match(
        (response: { tag: string; value: unknown }) => {
          assertEnumVariant(response, 'v1', UNSUPPORTED_VERSION_ERROR);
          const result = response.value as SigningResult;
          return {
            id: 0,
            signature: result.signature,
            signedTransaction: result.signedTransaction ?? null,
          };
        },
        (error: { tag: string; value: unknown }) => {
          assertEnumVariant(error, 'v1', UNSUPPORTED_VERSION_ERROR);
          throw error.value;
        },
      );
    },
  };
}
