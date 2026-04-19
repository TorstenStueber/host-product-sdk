/**
 * Lazy statement store client for the People parachain.
 *
 * Creates a polkadot-api client from the caller-provided JsonRpcProvider
 * on first use. Provides both the statement store adapter (for SSO and
 * host API handlers) and raw RPC access (for identity resolution).
 *
 * The provider is transport-agnostic: it can be backed by a WebSocket
 * connection (via `getWsProvider`) or an in-process Smoldot light client
 * (via `getSmProvider`). Both support the `statement_submit` and
 * `statement_subscribeStatement` RPCs.
 */

import { createClient } from 'polkadot-api';
import type { JsonRpcProvider } from 'polkadot-api';
import { bytesToHex, hexToBytes } from '@polkadot/api-protocol';

import type { StatementStoreAdapter, Statement, SignedStatement } from './types.js';
import { encodeStatement, decodeStatement } from './codec.js';

// ---------------------------------------------------------------------------
// RPC types
// ---------------------------------------------------------------------------

/** Subscription event from `statement_subscribeStatement`. */
type StatementEvent = {
  event: string;
  data: {
    statements: string[]; // hex-encoded SCALE statements
    remaining?: number;
  };
};

/** Topic filter for statement subscriptions. */
type TopicFilter = 'any' | { matchAny: `0x${string}`[] } | { matchAll: `0x${string}`[] };

/** Minimal Observable protocol (avoids importing rxjs directly). */
type Subscription = { unsubscribe(): void };
type Observable<T> = {
  subscribe(observer: { next(value: T): void; error(err: unknown): void }): Subscription;
};

// ---------------------------------------------------------------------------
// Chain client
// ---------------------------------------------------------------------------

export type StatementStoreClient = {
  /** Statement store adapter for SSO and host API handlers. */
  statementStore: StatementStoreAdapter;

  /**
   * Get the polkadot-api unsafe API for direct storage queries.
   * Used by the identity resolver to query Resources.Consumers.
   */
  getUnsafeApi(): unknown;

  /** Dispose the connection and all resources. */
  dispose(): void;
};

/**
 * Create a lazy statement store client from a JSON-RPC provider.
 *
 * The provider can be any `JsonRpcProvider` — a WebSocket connection
 * (via `getWsProvider`) or a Smoldot light client (via `getSmProvider`).
 * The polkadot-api client is created on first use. Both the statement
 * store and identity resolution share this single connection.
 *
 * @param provider - A `JsonRpcProvider` connected to the People parachain.
 */
export function createStatementStoreClient(provider: JsonRpcProvider): StatementStoreClient {
  let client: ReturnType<typeof createClient> | undefined;

  function ensureClient(): ReturnType<typeof createClient> {
    if (client) return client;
    client = createClient(provider);
    return client;
  }

  /** Access the polkadot-api client's internal `_request` for one-shot RPCs. */
  function rpcRequest<T>(method: string, params: unknown[]): Promise<T> {
    const c = ensureClient() as unknown as {
      _request: <R>(method: string, params: unknown[]) => Promise<R>;
    };
    return c._request<T>(method, params);
  }

  /** Access the polkadot-api client's internal `_subscribe` for subscription RPCs. */
  function rpcSubscribe<T>(method: string, unsubMethod: string, params: unknown[]): Observable<T> {
    const c = ensureClient() as unknown as {
      _subscribe: <R>(method: string, unsubMethod: string, params: unknown[]) => Observable<R>;
    };
    return c._subscribe<T>(method, unsubMethod, params);
  }

  function buildFilter(topics: Uint8Array[]): TopicFilter {
    return topics.length > 0 ? { matchAny: topics.map(bytesToHex) } : 'any';
  }

  const statementStore: StatementStoreAdapter = {
    subscribe(topics: Uint8Array[], callback: (statements: Statement[]) => void): () => void {
      const observable = rpcSubscribe<StatementEvent>(
        'statement_subscribeStatement',
        'statement_unsubscribeStatement',
        [buildFilter(topics)],
      );

      const sub = observable.subscribe({
        next(event) {
          if (event.event !== 'newStatements') return;
          const decoded: Statement[] = [];
          for (const encoded of event.data.statements) {
            try {
              decoded.push(decodeStatement(hexToBytes(encoded)));
            } catch {
              // Skip malformed statements
            }
          }
          if (decoded.length > 0) callback(decoded);
        },
        error(err) {
          console.error('[statement-store] subscription error:', err);
        },
      });

      return () => sub.unsubscribe();
    },

    async submit(statement: SignedStatement): Promise<void> {
      const encoded = encodeStatement(statement);
      const result = await rpcRequest<{ status: string; reason?: string; error?: string }>('statement_submit', [
        bytesToHex(encoded),
      ]);
      if (!result) return; // null/void response means success
      const status = result.status;
      if (status === 'new' || status === 'known' || status === 'knownExpired') return;
      const detail = result.reason ?? result.error ?? '';
      throw new Error(`Statement ${status}: ${detail}`);
    },

    async query(topics: Uint8Array[]): Promise<Statement[]> {
      return new Promise<Statement[]>((resolve, reject) => {
        const statements: Statement[] = [];

        const observable = rpcSubscribe<StatementEvent>(
          'statement_subscribeStatement',
          'statement_unsubscribeStatement',
          [buildFilter(topics)],
        );

        const sub = observable.subscribe({
          next(event) {
            if (event.event === 'newStatements') {
              for (const encoded of event.data.statements) {
                try {
                  statements.push(decodeStatement(hexToBytes(encoded)));
                } catch {
                  // Skip malformed statements
                }
              }
              if (event.data.remaining === 0 || event.data.remaining === undefined) {
                sub.unsubscribe();
                resolve(statements);
              }
            }
          },
          error(err) {
            sub.unsubscribe();
            reject(err);
          },
        });
      });
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
    },
  };
}
