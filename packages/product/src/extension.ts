/**
 * Spektr extension injection for legacy polkadot-js compatibility.
 *
 * Injects a polkadot-js compatible extension that delegates account
 * lookup and signing to the host through the transport layer. This
 * allows legacy dApps that use the `@polkadot/extension-dapp` pattern
 * to work inside the host sandbox.
 *
 * Ported from product-sdk/injectWeb3.ts, adapted to use the Transport
 * abstraction from @polkadot/shared.
 */

import type { Transport } from '@polkadot/shared';
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
  signedTransaction?: string | null;
}

import { SpektrExtensionName } from './constants.js';
import { createHostApi } from './hostApi.js';
import { sandboxTransport } from './transport/sandboxTransport.js';
import type { HexString, VersionedTxPayload } from './types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const UNSUPPORTED_VERSION_ERROR = 'Unsupported message version';

function enumValue<V extends string, T>(tag: V, value: T): { tag: V; value: T } {
  return { tag, value };
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

function toHex(bytes: Uint8Array): HexString {
  const hex = Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  return `0x${hex}` as HexString;
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
 * Returns `null` if the transport is not ready (e.g. handshake failed).
 */
export async function createNonProductExtensionEnableFactory(
  transport: Transport,
): Promise<((_origin: string) => Promise<Injected>) | null> {
  const ready = await transport.isReady();
  if (!ready) return null;

  const hostApi = createHostApi(transport);
  const accountId = AccountId();

  async function enable(_origin?: string): Promise<Injected> {
    async function getAccounts(): Promise<InjectedAccount[]> {
      const response = await hostApi.getNonProductAccounts(
        enumValue('v1', undefined),
      );

      return response.match(
        (response: { tag: string; value: unknown }) => {
          assertEnumVariant(response, 'v1', UNSUPPORTED_VERSION_ERROR);

          const accounts = response.value as Array<{
            publicKey: Uint8Array;
            name: string | null;
          }>;

          return accounts.map<InjectedAccount>(account => ({
            name: account.name ?? undefined,
            address: accountId.dec(account.publicKey),
            type: 'sr25519',
          }));
        },
        (err: { tag: string; value: unknown }) => {
          assertEnumVariant(err, 'v1', UNSUPPORTED_VERSION_ERROR);
          throw err.value;
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

          const response = await hostApi.signRaw(enumValue('v1', payload));

          return response.match(
            (response: { tag: string; value: unknown }) => {
              assertEnumVariant(response, 'v1', UNSUPPORTED_VERSION_ERROR);
              const result = response.value as {
                signature: HexString;
                signedTransaction: HexString | null;
              };
              return {
                id: 0,
                signature: result.signature,
                signedTransaction: result.signedTransaction,
              };
            },
            (err: { tag: string; value: unknown }) => {
              assertEnumVariant(err, 'v1', UNSUPPORTED_VERSION_ERROR);
              throw err.value;
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

          const response = await hostApi.signPayload(
            enumValue('v1', codecPayload),
          );

          return response.match(
            (response: { tag: string; value: unknown }) => {
              assertEnumVariant(response, 'v1', UNSUPPORTED_VERSION_ERROR);
              const result = response.value as {
                signature: HexString;
                signedTransaction: HexString | null;
              };
              return {
                id: 0,
                signature: result.signature,
                signedTransaction: result.signedTransaction,
              };
            },
            (err: { tag: string; value: unknown }) => {
              assertEnumVariant(err, 'v1', UNSUPPORTED_VERSION_ERROR);
              throw err.value;
            },
          );
        },

        async createTransaction(
          payload: VersionedTxPayload,
        ): Promise<HexString> {
          const response =
            await hostApi.createTransactionWithNonProductAccount(
              enumValue('v1', payload),
            );

          return response.match(
            (response: { tag: string; value: unknown }) => {
              assertEnumVariant(response, 'v1', UNSUPPORTED_VERSION_ERROR);
              return toHex(response.value as Uint8Array);
            },
            (err: { tag: string; value: unknown }) => {
              assertEnumVariant(err, 'v1', UNSUPPORTED_VERSION_ERROR);
              throw err.value;
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
 * @param transport - The transport to use. Pass `null` to skip injection.
 * @returns `true` if injection succeeded, `false` otherwise.
 */
export async function injectSpektrExtension(
  transport: Transport | null = sandboxTransport,
): Promise<boolean> {
  if (!transport) return false;

  try {
    const enable = await createNonProductExtensionEnableFactory(transport);

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
    transport.provider.logger.error('Error injecting extension', e);
    return false;
  }
}
