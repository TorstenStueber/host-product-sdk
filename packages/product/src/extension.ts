/**
 * Spektr extension injection for legacy polkadot-js compatibility.
 *
 * Injects a polkadot-js compatible extension that delegates account
 * lookup and signing to the host through the transport layer. This
 * allows legacy dApps that use the `@polkadot/extension-dapp` pattern
 * to work inside the host sandbox.
 *
 * Ported from product-sdk/injectWeb3.ts, adapted to use the Transport
 * abstraction from @polkadot/host-api.
 */

import { injectExtension } from '@polkadot/extension-inject/bundle';
import type { InjectedAccount } from '@polkadot/extension-inject/types';
import { AccountId } from '@polkadot-api/substrate-bindings';

// ---------------------------------------------------------------------------
// Polkadot-js signer types (inlined to avoid @polkadot/types dependency)
// ---------------------------------------------------------------------------

interface SignerPayloadJSON {
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
  assetId?: string;
  metadataHash?: string;
  mode?: number;
  withSignedTransaction?: boolean;
}

interface SignerPayloadRaw {
  address: string;
  data: string;
  type: 'bytes' | 'payload';
}

interface SignerResult {
  id: number;
  signature: string;
  signedTransaction?: string;
}

import { SpektrExtensionName } from './constants.js';
import type { HostApi } from '@polkadot/host-api';
import { hostApi as defaultHostApi } from '@polkadot/host-api';
import type { HexString, VersionedTxPayload } from './types.js';

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
// Signer / Injected types (subset for our use)
// ---------------------------------------------------------------------------

interface Signer {
  signPayload?: (payload: SignerPayloadJSON) => Promise<SignerResult>;
  signRaw?: (raw: SignerPayloadRaw) => Promise<SignerResult>;
  createTransaction?: (payload: VersionedTxPayload) => Promise<HexString>;
}

interface Injected {
  accounts: {
    get: (anyType?: boolean) => Promise<InjectedAccount[]>;
    subscribe: (cb: (accounts: InjectedAccount[]) => void) => () => void;
  };
  signer: Signer;
}

// ---------------------------------------------------------------------------
// Non-product extension enable factory
// ---------------------------------------------------------------------------

/**
 * Create an `enable` function that returns an `Injected` object for
 * non-product accounts.
 *
 * Returns `undefined` if the transport is not ready (e.g. handshake failed).
 */
export async function createNonProductExtensionEnableFactory(
  hostApi: HostApi = defaultHostApi,
): Promise<((_origin: string) => Promise<Injected>) | undefined> {
  const ready = await hostApi.isReady();
  if (!ready) return undefined;

  const accountId = AccountId();

  async function enable(_origin?: string): Promise<Injected> {
    async function getAccounts(): Promise<InjectedAccount[]> {
      const response = await hostApi.getNonProductAccounts(undefined);

      return response.match(
        response => {
          return response.map<InjectedAccount>(account => ({
            name: account.name,
            address: accountId.dec(account.publicKey),
            type: 'sr25519',
          }));
        },
        err => {
          throw err;
        },
      );
    }

    return {
      accounts: {
        async get(): Promise<InjectedAccount[]> {
          return getAccounts();
        },
        subscribe(callback: (accounts: InjectedAccount[]) => void) {
          getAccounts().then(callback);
          return () => {
            // empty
          };
        },
      },

      signer: {
        async signRaw(raw: SignerPayloadRaw): Promise<SignerResult> {
          const payload = {
            address: raw.address,
            data:
              raw.type === 'bytes'
                ? { tag: 'Bytes' as const, value: fromHex(raw.data) }
                : { tag: 'Payload' as const, value: raw.data },
          };

          const response = await hostApi.signRaw(payload);

          return response.match(
            response => {
              return {
                id: 0,
                signature: response.signature,
                signedTransaction: response.signedTransaction,
              };
            },
            err => {
              throw err;
            },
          );
        },

        async signPayload(payload: SignerPayloadJSON): Promise<SignerResult> {
          const codecPayload = {
            address: payload.address,
            blockHash: payload.blockHash as HexString,
            blockNumber: payload.blockNumber as HexString,
            era: payload.era as HexString,
            genesisHash: payload.genesisHash as HexString,
            method: payload.method as HexString,
            nonce: payload.nonce as HexString,
            specVersion: payload.specVersion as HexString,
            tip: payload.tip as HexString,
            transactionVersion: payload.transactionVersion as HexString,
            signedExtensions: payload.signedExtensions,
            version: payload.version,
            assetId: payload.assetId as HexString | undefined,
            metadataHash: payload.metadataHash as HexString | undefined,
            mode: payload.mode,
            withSignedTransaction: payload.withSignedTransaction,
          };

          const response = await hostApi.signPayload(codecPayload);

          return response.match(
            response => {
              return {
                id: 0,
                signature: response.signature,
                signedTransaction: response.signedTransaction,
              };
            },
            err => {
              throw err;
            },
          );
        },

        async createTransaction(payload: VersionedTxPayload): Promise<HexString> {
          const response = await hostApi.createTransactionWithNonProductAccount(payload);

          return response.match(
            response => {
              return response;
            },
            err => {
              throw err;
            },
          );
        },
      },
    };
  }

  return enable;
}

// ---------------------------------------------------------------------------
// Inject extension
// ---------------------------------------------------------------------------

/**
 * Inject the Spektr extension into the global polkadot-js extension
 * registry.
 *
 * This makes the non-product accounts available to any dApp that uses
 * `@polkadot/extension-dapp`'s `web3Enable()` / `web3Accounts()`.
 *
 * @param transport - The transport to use. Pass `undefined` to skip injection.
 * @returns `true` if injection succeeded, `false` otherwise.
 */
export async function injectSpektrExtension(hostApi: HostApi = defaultHostApi): Promise<boolean> {
  try {
    const enable = await createNonProductExtensionEnableFactory(hostApi);

    if (enable) {
      // Cast needed because our Signer/Injected are structurally compatible
      // but not nominally identical to @polkadot/api's InjectedSigner.
      injectExtension(enable as Parameters<typeof injectExtension>[0], {
        name: SpektrExtensionName,
        version: '0.1.0',
      });
      return true;
    } else {
      return false;
    }
  } catch (e) {
    hostApi.logger.error('Error injecting extension', e);
    return false;
  }
}
