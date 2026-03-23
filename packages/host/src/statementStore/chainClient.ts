/**
 * Lazy chain client for the People/statement-store parachain.
 *
 * Creates a single WebSocket connection on first use. Provides both
 * the statement store adapter (for SSO and host API handlers) and
 * raw RPC access (for identity resolution).
 */

import { getWsProvider } from '@polkadot-api/ws-provider';
import { createClient } from 'polkadot-api';
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
      stmt.proof = { tag, value: { signature: hexToBytes(sig), signer: hexToBytes(signer) } };
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
// Chain client
// ---------------------------------------------------------------------------

export type ChainClient = {
  /** Statement store adapter for SSO and host API handlers. */
  statementStore: StatementStoreAdapter;

  /**
   * Get the polkadot-api unsafe API for direct storage queries.
   * Used by the identity resolver to query Resources.Consumers.
   */
  getUnsafeApi(): unknown;

  /** Dispose the WebSocket connection and all resources. */
  dispose(): void;
};

/**
 * Create a lazy chain client from WebSocket endpoints.
 *
 * The connection is established on first use (first subscribe, submit,
 * query, or getUnsafeApi call). Both the statement store and identity
 * resolution share this single connection.
 *
 * @param endpoints - WebSocket URLs for the People/statement-store parachain.
 * @param options - Optional configuration.
 */
export function createChainClient(endpoints: string[], options?: { heartbeatTimeout?: number }): ChainClient {
  let client: ReturnType<typeof createClient> | undefined;
  let sdk: ReturnType<typeof createStatementSdk> | undefined;

  function ensureClient(): ReturnType<typeof createClient> {
    if (client) return client;
    const provider = getWsProvider(endpoints, {
      heartbeatTimeout: options?.heartbeatTimeout,
    });
    client = createClient(provider);
    return client;
  }

  function ensureSdk(): ReturnType<typeof createStatementSdk> {
    if (sdk) return sdk;
    const c = ensureClient();
    // polkadot-api's createClient exposes _request for raw RPC
    const raw = c as unknown as {
      _request: (...args: never[]) => Promise<never>;
    };
    sdk = createStatementSdk(raw._request.bind(raw) as never, raw._request.bind(raw) as never);
    return sdk;
  }

  const statementStore: StatementStoreAdapter = {
    subscribe(topics: Uint8Array[], callback: (statements: Statement[]) => void): () => void {
      const s = ensureSdk();
      const topicHexes = topics.map(bytesToHex);
      const filter = topicHexes.length > 0 ? { matchAny: topicHexes } : ('any' as const);

      return s.subscribeStatements(
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
      const s = ensureSdk();
      const result = await s.submit(toSdkStatement(statement) as never);
      if (result.status === 'new' || result.status === 'known' || result.status === 'knownExpired') {
        return;
      }
      const reason = 'reason' in result ? (result as { reason: string }).reason : '';
      const error = 'error' in result ? (result as { error: string }).error : '';
      throw new Error(`Statement ${result.status}: ${reason || error}`);
    },

    async query(topics: Uint8Array[]): Promise<Statement[]> {
      const s = ensureSdk();
      const topicHexes = topics.map(bytesToHex);
      const filter = topicHexes.length > 0 ? { matchAny: topicHexes } : ('any' as const);
      const results = await s.getStatements(filter as never);
      return results.map(r => fromSdkStatement(r as unknown as Record<string, unknown>));
    },
  };

  return {
    statementStore,

    getUnsafeApi(): unknown {
      return ensureClient().getUnsafeApi();
    },

    dispose() {
      client?.destroy();
      client = undefined;
      sdk = undefined;
    },
  };
}
