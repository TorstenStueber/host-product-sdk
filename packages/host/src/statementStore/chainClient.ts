/**
 * Lazy chain client for the People/statement-store parachain.
 *
 * Creates a single WebSocket connection on first use. Provides both
 * the statement store adapter (for SSO and host API handlers) and
 * raw RPC access (for identity resolution).
 *
 * Uses the polkadot-api client's `_request` / `_subscribe` escape
 * hatches for direct RPC access to the statement-store endpoints
 * (`statement_submit`, `statement_subscribeStatement`).
 */

import { getWsProvider } from '@polkadot-api/ws-provider';
import { createClient } from 'polkadot-api';
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

  function ensureClient(): ReturnType<typeof createClient> {
    if (client) return client;
    const provider = getWsProvider(endpoints, {
      heartbeatTimeout: options?.heartbeatTimeout,
    });
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
          if (event.event === 'newStatements') {
            for (const encoded of event.data.statements) {
              try {
                callback([decodeStatement(hexToBytes(encoded))]);
              } catch {
                // Skip malformed statements
              }
            }
          }
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
