/**
 * Remote signing via SSO manager.
 *
 * Creates signing callbacks that route sign requests through the SSO
 * transport to the paired mobile wallet, and return the wallet's signature.
 *
 * The actual encryption/framing is delegated to an injected SignRequestExecutor,
 * since it depends on the session key established during pairing.
 */

import type { StatementStoreAdapter } from '../../statementStore/types.js';
import type { SsoManager } from './manager.js';

// ---------------------------------------------------------------------------
// Sign request types (protocol-level, before SCALE encoding)
// ---------------------------------------------------------------------------

export type RemoteSignPayloadRequest = {
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
};

export type RemoteSignRawRequest = {
  address: string;
  data: { tag: 'Bytes'; value: Uint8Array } | { tag: 'Payload'; value: string };
};

export type RemoteSignResult = {
  signature: Uint8Array;
  signedTransaction?: Uint8Array | string;
};

// ---------------------------------------------------------------------------
// Sign request executor (injected crypto/framing)
// ---------------------------------------------------------------------------

/**
 * Pluggable sign request executor.
 *
 * Implementations handle encrypting the sign request with the AES session
 * key, publishing it to the statement-store topic, waiting for the wallet's
 * response, and decrypting the signature.
 */
export type SignRequestExecutor = {
  signPayload(
    store: StatementStoreAdapter,
    request: RemoteSignPayloadRequest,
    signal: AbortSignal,
  ): Promise<RemoteSignResult>;

  signRaw(store: StatementStoreAdapter, request: RemoteSignRawRequest, signal: AbortSignal): Promise<RemoteSignResult>;
};

// ---------------------------------------------------------------------------
// Remote signing bridge
// ---------------------------------------------------------------------------

export type RemoteSigningConfig = {
  manager: SsoManager;
  statementStore: StatementStoreAdapter;
  executor: SignRequestExecutor;
  /** Timeout in ms for the wallet to respond. Default: 90_000 (90 seconds). */
  timeoutMs?: number;
};

export type RemoteSigner = {
  signPayload(request: RemoteSignPayloadRequest): Promise<RemoteSignResult>;
  signRaw(request: RemoteSignRawRequest): Promise<RemoteSignResult>;
};

const DEFAULT_TIMEOUT_MS = 90_000;

export function createRemoteSigner(config: RemoteSigningConfig): RemoteSigner {
  const { manager, statementStore, executor, timeoutMs = DEFAULT_TIMEOUT_MS } = config;

  function ensurePaired(): void {
    const state = manager.getState();
    if (state.status !== 'paired') {
      throw new Error(`Cannot sign: SSO manager is in "${state.status}" state, expected "paired"`);
    }
  }

  function withTimeout<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Sign request timed out — the wallet did not respond'));
      }, timeoutMs);

      const cleanup = () => clearTimeout(timer);

      signal.addEventListener('abort', () => {
        cleanup();
        reject(new Error('Sign request aborted'));
      });

      promise.then(
        v => {
          cleanup();
          resolve(v);
        },
        e => {
          cleanup();
          reject(e);
        },
      );
    });
  }

  return {
    async signPayload(request: RemoteSignPayloadRequest): Promise<RemoteSignResult> {
      ensurePaired();
      const controller = new AbortController();
      return withTimeout(executor.signPayload(statementStore, request, controller.signal), controller.signal);
    },

    async signRaw(request: RemoteSignRawRequest): Promise<RemoteSignResult> {
      ensurePaired();
      const controller = new AbortController();
      return withTimeout(executor.signRaw(statementStore, request, controller.signal), controller.signal);
    },
  };
}
