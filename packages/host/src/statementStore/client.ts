/**
 * Statement store client for the People parachain.
 *
 * Wraps a polkadot-api client (provided by the caller) into a
 * StatementStoreAdapter that exposes subscribe, submit, and query
 * operations over the statement-store RPCs.
 *
 * Design notes:
 * - Topic filters use substrate's `matchAll` semantics so that a
 *   subscription/query narrows on the intersection of topics. `matchAny`
 *   would broaden the match to a union — almost certainly not what the
 *   caller wants for typed session channels.
 * - Subscriptions are multiplexed: two callers asking for the same
 *   (sorted) topic set share one upstream RPC subscription; the
 *   upstream is torn down only when the last listener unsubscribes.
 * - Errors from the substrate RPC are mapped into a flat
 *   {@link StatementStoreError} union so callers can branch on the tag
 *   rather than parsing status strings.
 */

import { bytesToHex, hexToBytes } from '@polkadot/api-protocol';
import { ResultAsync, errAsync, okAsync } from 'neverthrow';

import type { StatementStoreAdapter, Statement, SignedStatement, StatementStoreError } from './types.js';
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

/**
 * Substrate statement_submit response. The RPC may also return `null`
 * (interpreted as success) for older node versions.
 */
type SubmitResponse = {
  status: 'new' | 'known' | 'knownExpired' | 'rejected' | 'invalid' | 'internalError';
  reason?: string;
  error?: string;
  submitted_size?: number;
  available_size?: number;
  max_size?: number;
  submitted_expiry?: bigint;
  min_expiry?: bigint;
};

/** Topic filter for statement subscriptions. */
type TopicFilter = 'any' | { matchAll: `0x${string}`[] };

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
// Helpers
// ---------------------------------------------------------------------------

function buildFilter(topics: Uint8Array[]): TopicFilter {
  if (topics.length === 0) return 'any';
  return { matchAll: topics.map(bytesToHex) };
}

/** Stable multiplex key: topics are hex-encoded, sorted, and joined. */
function subscriptionKey(topics: Uint8Array[]): string {
  return topics.map(bytesToHex).sort().join('|');
}

function transportError(err: unknown): StatementStoreError {
  return { tag: 'Transport', message: err instanceof Error ? err.message : String(err) };
}

function decodeStatements(hexStatements: string[]): Statement[] {
  const decoded: Statement[] = [];
  for (const encoded of hexStatements) {
    try {
      decoded.push(decodeStatement(hexToBytes(encoded)));
    } catch {
      // Skip malformed statements — they are not representable in our codec
      // (unknown fields, corrupt encoding). Logging would be too noisy.
    }
  }
  return decoded;
}

function mapSubmitResponse(result: SubmitResponse | null | undefined): StatementStoreError | undefined {
  if (!result) return undefined; // null / void == success
  switch (result.status) {
    case 'new':
    case 'known':
      return undefined;
    case 'knownExpired':
      return { tag: 'KnownExpired' };
    case 'internalError':
      return { tag: 'InternalStore', detail: result.error ?? '' };
    case 'rejected':
      switch (result.reason) {
        case 'dataTooLarge':
          return { tag: 'DataTooLarge', submitted: result.submitted_size ?? 0, available: result.available_size ?? 0 };
        case 'channelPriorityTooLow':
          return { tag: 'ExpiryTooLow', submitted: result.submitted_expiry ?? 0n, min: result.min_expiry ?? 0n };
        case 'accountFull':
          return { tag: 'AccountFull', submitted: result.submitted_expiry ?? 0n, min: result.min_expiry ?? 0n };
        case 'storeFull':
          return { tag: 'StorageFull' };
        case 'noAllowance':
          return { tag: 'NoAllowance' };
        default:
          return { tag: 'Unknown', detail: `rejected:${result.reason ?? ''}` };
      }
    case 'invalid':
      switch (result.reason) {
        case 'noProof':
          return { tag: 'NoProof' };
        case 'badProof':
          return { tag: 'BadProof' };
        case 'encodingTooLarge':
          return { tag: 'EncodingTooLarge', submitted: result.submitted_size ?? 0, max: result.max_size ?? 0 };
        case 'alreadyExpired':
          return { tag: 'AlreadyExpired' };
        default:
          return { tag: 'Unknown', detail: `invalid:${result.reason ?? ''}` };
      }
    default:
      return { tag: 'Unknown', detail: `status:${String(result.status)}` };
  }
}

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
  type Listener = (statements: Statement[]) => void;
  type Multiplex = {
    listeners: Set<Listener>;
    teardown: () => void;
  };

  const multiplexes = new Map<string, Multiplex>();

  function openUpstream(topics: Uint8Array[], key: string): () => void {
    const observable = peopleChainClient._subscribe<StatementEvent>(
      'statement_subscribeStatement',
      'statement_unsubscribeStatement',
      [buildFilter(topics)],
    );

    const sub = observable.subscribe({
      next(event) {
        if (event.event !== 'newStatements') return;
        const decoded = decodeStatements(event.data.statements);
        if (decoded.length === 0) return;
        const mux = multiplexes.get(key);
        if (!mux) return;
        // Copy to array so a listener that unsubscribes itself mid-loop
        // does not perturb the iteration.
        for (const listener of [...mux.listeners]) {
          listener(decoded);
        }
      },
      error(err) {
        console.error('[statement-store] subscription error:', err);
      },
    });

    return () => sub.unsubscribe();
  }

  const statementStore: StatementStoreAdapter = {
    subscribe(topics, callback) {
      const key = subscriptionKey(topics);
      let mux = multiplexes.get(key);
      if (!mux) {
        // Defer teardown assignment — openUpstream's callback may fire
        // before we return, and it needs the mux already registered.
        mux = { listeners: new Set(), teardown: () => {} };
        multiplexes.set(key, mux);
        mux.teardown = openUpstream(topics, key);
      }
      mux.listeners.add(callback);

      return () => {
        const current = multiplexes.get(key);
        if (!current) return; // already torn down
        if (!current.listeners.delete(callback)) return;
        if (current.listeners.size === 0) {
          multiplexes.delete(key);
          current.teardown();
        }
      };
    },

    submit(statement: SignedStatement) {
      const encoded = encodeStatement(statement);
      return ResultAsync.fromPromise(
        peopleChainClient._request<SubmitResponse | null>('statement_submit', [bytesToHex(encoded)]),
        transportError,
      ).andThen(result => {
        const err = mapSubmitResponse(result);
        return err ? errAsync(err) : okAsync<void, StatementStoreError>(undefined);
      });
    },

    query(topics: Uint8Array[]) {
      return ResultAsync.fromPromise(
        new Promise<Statement[]>((resolve, reject) => {
          const statements: Statement[] = [];
          const observable = peopleChainClient._subscribe<StatementEvent>(
            'statement_subscribeStatement',
            'statement_unsubscribeStatement',
            [buildFilter(topics)],
          );
          const sub = observable.subscribe({
            next(event) {
              if (event.event !== 'newStatements') return;
              statements.push(...decodeStatements(event.data.statements));
              if (event.data.remaining === 0 || event.data.remaining === undefined) {
                sub.unsubscribe();
                resolve(statements);
              }
            },
            error(err) {
              sub.unsubscribe();
              reject(err);
            },
          });
        }),
        transportError,
      );
    },
  };

  return { statementStore };
}
