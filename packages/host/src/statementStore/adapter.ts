/**
 * Statement store adapter backed by @novasamatech/sdk-statement.
 *
 * Wraps the SDK's RPC-level API into our StatementStoreAdapter interface.
 * Accepts request/subscribe functions from a polkadot-api substrate client.
 */

import { createStatementSdk } from '@novasamatech/sdk-statement';
import type { StatementStoreAdapter, Statement, SignedStatement } from './types.js';

// ---------------------------------------------------------------------------
// Hex helpers
// ---------------------------------------------------------------------------

function bytesToHex(bytes: Uint8Array): `0x${string}` {
  let hex = '0x';
  for (const b of bytes) {
    hex += b.toString(16).padStart(2, '0');
  }
  return hex as `0x${string}`;
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

// ---------------------------------------------------------------------------
// SDK statement conversion
// ---------------------------------------------------------------------------

function fromSdkStatement(sdkStmt: Record<string, unknown>): Statement {
  const stmt: Statement = {};
  if (sdkStmt.data !== undefined) {
    stmt.data = sdkStmt.data instanceof Uint8Array ? sdkStmt.data : hexToBytes(sdkStmt.data as string);
  }
  if (sdkStmt.topics !== undefined) {
    stmt.topics = (sdkStmt.topics as string[]).map(hexToBytes);
  }
  if (sdkStmt.channel !== undefined) {
    stmt.channel = hexToBytes(sdkStmt.channel as string);
  }
  if (sdkStmt.expiry !== undefined) {
    stmt.expiry = sdkStmt.expiry as bigint;
  }
  if (sdkStmt.proof !== undefined) {
    const proof = sdkStmt.proof as { type: string; value: Record<string, string | undefined> };
    const tag = proof.type as 'sr25519' | 'ed25519' | 'ecdsa';
    const sig = proof.value.signature;
    const signer = proof.value.signer;
    if (sig && signer) {
      stmt.proof = {
        tag,
        value: {
          signature: hexToBytes(sig),
          signer: hexToBytes(signer),
        },
      };
    }
  }
  return stmt;
}

function toSdkStatement(statement: SignedStatement): Record<string, unknown> {
  const sdk: Record<string, unknown> = {};
  if (statement.data) sdk.data = statement.data;
  if (statement.topics) sdk.topics = statement.topics.map(bytesToHex);
  if (statement.channel) sdk.channel = bytesToHex(statement.channel);
  if (statement.expiry !== undefined) sdk.expiry = statement.expiry;
  if (statement.decryptionKey) sdk.decryptionKey = bytesToHex(statement.decryptionKey);
  if (statement.proof) {
    sdk.proof = {
      type: statement.proof.tag,
      value: {
        signature: bytesToHex(statement.proof.value.signature),
        signer: bytesToHex(statement.proof.value.signer),
      },
    };
  }
  return sdk;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * RPC functions needed from a polkadot-api substrate client.
 *
 * These are the `client._request` and subscription functions from
 * `createClient(provider)`. The host app obtains these from their
 * polkadot-api client connected to the statement-store parachain.
 */
export type StatementStoreRpcFunctions = {
  request: (method: string, params: unknown[]) => Promise<unknown>;
  subscribe: (
    method: string,
    params: unknown[],
    onMessage: (message: unknown) => void,
    onError: (error: Error) => void,
  ) => () => void;
};

/**
 * Create a StatementStoreAdapter from RPC functions.
 *
 * @param rpc - Request and subscribe functions from a polkadot-api client
 *   connected to the statement-store parachain.
 */
export function createStatementStoreAdapter(rpc: StatementStoreRpcFunctions): StatementStoreAdapter {
  const sdk = createStatementSdk(rpc.request as never, rpc.subscribe as never);

  return {
    subscribe(topics: Uint8Array[], callback: (statements: Statement[]) => void): () => void {
      const topicHexes = topics.map(bytesToHex);
      const filter = topicHexes.length > 0 ? { matchAny: topicHexes } : ('any' as const);

      return sdk.subscribeStatements(
        filter as never,
        (sdkStmt: unknown) => {
          callback([fromSdkStatement(sdkStmt as Record<string, unknown>)]);
        },
        error => {
          console.error('[statement-store] subscription error:', error);
        },
      );
    },

    async submit(statement: SignedStatement): Promise<void> {
      const result = await sdk.submit(toSdkStatement(statement) as never);
      if (result.status === 'new' || result.status === 'known' || result.status === 'knownExpired') {
        return;
      }
      const reason = 'reason' in result ? (result as { reason: string }).reason : '';
      const error = 'error' in result ? (result as { error: string }).error : '';
      throw new Error(`Statement ${result.status}: ${reason || error}`);
    },

    async query(topics: Uint8Array[]): Promise<Statement[]> {
      const topicHexes = topics.map(bytesToHex);
      const filter = topicHexes.length > 0 ? { matchAny: topicHexes } : ('any' as const);
      const results = await sdk.getStatements(filter as never);
      return results.map(r => fromSdkStatement(r as unknown as Record<string, unknown>));
    },
  };
}
