/**
 * Statement store client for the People parachain.
 *
 * Wraps a polkadot-api client (provided by the caller) into a
 * StatementStoreAdapter that exposes subscribe, submit, and query
 * operations over the statement-store RPCs.
 */

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

/**
 * Minimal interface for the polkadot-api client's escape-hatch methods
 * used by the statement store. The caller creates the actual client
 * (via `createClient` from `polkadot-api`) and passes it here.
 */
export type PeopleChainClient = {
  _request: <T>(method: string, params: unknown[]) => Promise<T>;
  _subscribe: <T>(method: string, unsubMethod: string, params: unknown[]) => Observable<T>;
};

// ---------------------------------------------------------------------------
// Statement store client
// ---------------------------------------------------------------------------

export type StatementStoreClient = {
  /** Statement store adapter for SSO and host API handlers. */
  statementStore: StatementStoreAdapter;
};

/**
 * Create a statement store client from a polkadot-api client.
 *
 * @param peopleChainClient - A polkadot-api client connected to the People parachain.
 *   Must expose `_request` and `_subscribe` escape-hatch methods.
 */
export function createStatementStoreClient(peopleChainClient: PeopleChainClient): StatementStoreClient {
  function rpcRequest<T>(method: string, params: unknown[]): Promise<T> {
    return peopleChainClient._request<T>(method, params);
  }

  function rpcSubscribe<T>(method: string, unsubMethod: string, params: unknown[]): Observable<T> {
    return peopleChainClient._subscribe<T>(method, unsubMethod, params);
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

  return { statementStore };
}
