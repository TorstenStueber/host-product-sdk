/**
 * Accounts provider for the product SDK.
 *
 * Wraps HostApi account methods into a convenient interface for getting
 * product accounts, non-product accounts, creating ring VRF proofs, and
 * subscribing to account connection status changes.
 *
 * Ported from product-sdk/accounts.ts, adapted to use plain TS types
 * and the HostApi facade from @polkadot/host-api.
 */

import type { HostApi } from '@polkadot/host-api';
import { hostApi as defaultHostApi } from '@polkadot/host-api';
import type {
  AccountConnectionStatus,
  HexString,
  ProductAccount,
  RingLocation,
} from './types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
 * Create an accounts provider.
 *
 * @param hostApi - The HostApi instance to use. Defaults to the singleton.
 */
export const createAccountsProvider = (hostApi: HostApi = defaultHostApi) => {
  return {
    /**
     * Get the product account for a given dotNs identifier and derivation index.
     */
    getProductAccount(dotNsIdentifier: string, derivationIndex = 0) {
      return hostApi
        .accountGet([dotNsIdentifier, derivationIndex]);
    },

    /**
     * Get the contextual alias for a product account.
     */
    getProductAccountAlias(dotNsIdentifier: string, derivationIndex = 0) {
      return hostApi
        .accountGetAlias([dotNsIdentifier, derivationIndex]);
    },

    /**
     * Get all non-product (external) accounts connected to the host.
     */
    getNonProductAccounts() {
      return hostApi
        .getNonProductAccounts(undefined);
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
          [[dotNsIdentifier, derivationIndex], location, message],
        );
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
        undefined,
        (status) => {
          callback(status);
        },
      );
    },
  };
};

// ---------------------------------------------------------------------------
// Signer helper
// ---------------------------------------------------------------------------

function createSignerForAccount(
  hostApi: HostApi,
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

      const response = await hostApi.signPayload(codecPayload);

      return response.match(
        (result) => {
          return {
            id: 0,
            signature: result.signature,
            signedTransaction: result.signedTransaction ?? null,
          };
        },
        (error) => {
          throw error;
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

      const response = await hostApi.signRaw(payload);

      return response.match(
        (result) => {
          return {
            id: 0,
            signature: result.signature,
            signedTransaction: result.signedTransaction ?? null,
          };
        },
        (error) => {
          throw error;
        },
      );
    },
  };
}
