/**
 * Symmetric bidirectional reliable encrypted session over the
 * statement store.
 *
 * Implements the same protocol as triangle-js-sdks' statement-store
 * `createSession`, so the same wire bytes flow between any two peers
 * speaking this protocol regardless of which codebase produced each
 * side. The session factory is role-agnostic — it is used identically
 * for the host side of SSO and for anything else that speaks the
 * `StatementData` envelope on top of the statement store.
 *
 * What the session provides on top of the raw store:
 *
 * - **ACK protocol.** Every `StatementData::request` is answered by a
 *   `StatementData::response { requestId, responseCode }` from the
 *   receiver. The ACK says "I got your bytes, here is whether I could
 *   decrypt and decode them" — distinct from any application-level
 *   reply, which is itself a new request going the other direction.
 * - **Batching.** With one outgoing request in flight at a time, new
 *   payloads are coalesced into the current request's `data` vector up
 *   to `maxRequestSize` bytes. Overflow is queued until the current
 *   request is acked. The wire `requestId` is regenerated every time
 *   a new payload joins, so the statement is replaced on chain rather
 *   than duplicated.
 * - **Channel-based replacement.** Outgoing requests are submitted on
 *   `requestChannel`; response ACKs on `responseChannel`. The substrate
 *   statement store replaces on `(account, channel)`, so retries and
 *   coalesced batches don't pile up.
 * - **Expiry monotonicity.** Every new submission uses `nextExpiry` =
 *   `max(previousExpiry + 1, now + 7d)` so statement replacement always
 *   moves forward even on a skewed clock.
 * - **Init-time recovery.** On construction, both topics are queried.
 *   Any un-acked outgoing request is restored into `state.outgoingRequest`
 *   so later calls coalesce into it; any un-acked incoming request is
 *   surfaced to subscribers so the app can respond.
 * - **Statement dedup.** Incoming statements are keyed by
 *   `toHex(data)`; duplicates are dropped.
 * - **Proof verification.** Incoming statements must carry an sr25519
 *   proof whose signer equals the remote peer's public key. Our own
 *   echoes on the outgoing topic therefore fail verification and are
 *   naturally skipped, independent of tag-based filters.
 * - **Late-subscriber buffering.** Statements decoded before any
 *   `subscribe()` call is registered are held and replayed when the
 *   first subscriber attaches. Without this, init-recovered statements
 *   would be silently lost to whatever subscriber the app registers
 *   after the async init settles.
 * - **Clean dispose.** Tears down both upstream subscriptions and
 *   rejects every pending delivery promise with `{ tag: 'Disposed' }`.
 */

import { ResultAsync, errAsync, okAsync } from 'neverthrow';
import type { Codec } from 'scale-ts';
import { bytesToHex } from '@polkadot/api-protocol';
import type { Statement, SignedStatement, StatementStoreAdapter } from '../types.js';
import { createRequestChannel, createResponseChannel } from './channels.js';
import { StatementDataCodec, type StatementData } from './statementData.js';
import { toMessages } from './messageMapper.js';
import type {
  Encryption,
  Filter,
  LocalSessionAccount,
  Message,
  RemoteSessionAccount,
  ResponseCode,
  ResponseMessage,
  Session,
  SessionError,
  StatementProver,
} from './types.js';

const DEFAULT_EXPIRY_DURATION_SECS = 7 * 24 * 60 * 60; // 7 days
const DEFAULT_MAX_REQUEST_SIZE = 4096;

export type SessionParams = {
  localAccount: LocalSessionAccount;
  remoteAccount: RemoteSessionAccount;
  /** Topic = our outgoing session id (= peer's incoming). */
  outgoingSessionId: Uint8Array;
  /** Topic = our incoming session id (= peer's outgoing). */
  incomingSessionId: Uint8Array;
  statementStore: StatementStoreAdapter;
  encryption: Encryption;
  prover: StatementProver;
  /** Soft limit on the serialised size of an outgoing batch. Default 4096 B. */
  maxRequestSize?: number;
  /** Seconds added to `Date.now()` when computing fresh expiries. Default 7 days. */
  expiryDurationSecs?: number;
};

type OutgoingRequest = {
  /** Wire-level request id. Regenerated on every coalesce. */
  requestId: string;
  messages: Uint8Array[];
  /** Local per-payload tokens correlating to pending delivery promises. */
  tokens: string[];
};

type PendingDelivery = {
  resolve(r: ResponseMessage): void;
  reject(e: SessionError): void;
  promise: Promise<ResponseMessage>;
};

type SessionState = {
  phase: 'initialization' | 'active' | 'disposed';
  expiry: bigint;
  outgoingRequest: OutgoingRequest | null;
  incomingRequest: { requestId: string } | null;
  respondedIncomingRequest: boolean;
  messageQueue: Array<{ encoded: Uint8Array; token: string }>;
  pendingDelivery: Map<string, PendingDelivery>;
  seenStatements: Set<string>;
};

type Subscriber = {
  codec: Codec<unknown>;
  callback: (messages: Message<unknown>[]) => void;
};

function nanoid(): string {
  // 12 random bytes → base36 — plenty of entropy for in-session ids.
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  let s = '';
  for (const b of bytes) s += b.toString(36);
  return s;
}

export function createSession(params: SessionParams): Session {
  const {
    localAccount: _localAccount,
    remoteAccount: _remoteAccount,
    outgoingSessionId,
    incomingSessionId,
    statementStore,
    encryption,
    prover,
    maxRequestSize = DEFAULT_MAX_REQUEST_SIZE,
    expiryDurationSecs = DEFAULT_EXPIRY_DURATION_SECS,
  } = params;

  const requestChannel = createRequestChannel(outgoingSessionId);
  const responseChannel = createResponseChannel(incomingSessionId);

  const state: SessionState = {
    phase: 'initialization',
    expiry: 0n,
    outgoingRequest: null,
    incomingRequest: null,
    respondedIncomingRequest: false,
    messageQueue: [],
    pendingDelivery: new Map(),
    seenStatements: new Set(),
  };

  const subscribers = new Set<Subscriber>();
  /** StatementData values decoded before any subscriber existed. */
  const bufferedMessages: StatementData[] = [];
  let incomingStoreUnsub: (() => void) | null = null;
  let outgoingStoreUnsub: (() => void) | null = null;

  // -------------------------------------------------------------------------
  // Expiry monotonicity
  // -------------------------------------------------------------------------

  function nextExpiry(): bigint {
    const fresh = BigInt(Math.floor(Date.now() / 1000) + expiryDurationSecs) << 32n;
    const candidate = fresh > state.expiry ? fresh : state.expiry + 1n;
    state.expiry = candidate;
    return candidate;
  }

  // -------------------------------------------------------------------------
  // Submitting outgoing statements
  // -------------------------------------------------------------------------

  function submitStatementData(
    channel: Uint8Array,
    topic: Uint8Array,
    data: Uint8Array,
  ): ResultAsync<void, SessionError> {
    const expiry = nextExpiry();
    return encryption.encrypt(data).asyncAndThen(encryptedData => {
      const unsigned: Statement = {
        expiry,
        channel,
        topics: [topic],
        data: encryptedData,
        decryptionKey: undefined,
        proof: undefined,
      };
      return prover.generateMessageProof(unsigned).andThen(signed =>
        statementStore.submit(signed as SignedStatement).mapErr<SessionError>(cause => ({
          tag: 'StatementStore',
          cause,
        })),
      );
    });
  }

  function encodeAndSubmitRequest(requestId: string, messages: Uint8Array[]): void {
    let encoded: Uint8Array;
    try {
      encoded = StatementDataCodec.enc({ tag: 'request', value: { requestId, data: messages } });
    } catch (e) {
      // StatementDataCodec is internal — encoding should never fail. Log
      // defensively and move on.
      console.error('[session] encoding StatementData::request failed', e);
      return;
    }
    void submitStatementData(requestChannel, outgoingSessionId, encoded).match(
      () => {},
      err => console.error('[session] submitRequest failed:', err),
    );
  }

  // -------------------------------------------------------------------------
  // Delivering to subscribers + late-subscriber buffering
  // -------------------------------------------------------------------------

  function deliverStatementData(statementData: StatementData): void {
    // Always buffer requests so a subscribe() that races with delivery
    // still receives them. For responses we only buffer during init
    // (where there are no subscribers yet).
    if (statementData.tag === 'request' || (subscribers.size === 0 && state.phase === 'initialization')) {
      bufferedMessages.push(statementData);
    }

    if (subscribers.size === 0) return;

    for (const sub of subscribers) {
      const messages = toMessages(statementData, sub.codec);
      if (messages.length > 0) sub.callback(messages);
    }
  }

  // -------------------------------------------------------------------------
  // Processing incoming statements
  // -------------------------------------------------------------------------

  function tryDecodeStatement(statement: Statement, responsesOnly: boolean): StatementData | null {
    if (!statement.data) return null;
    if (!prover.verifyMessageProof(statement)) return null;
    const decryptResult = encryption.decrypt(statement.data);
    if (decryptResult.isErr()) return null;
    try {
      const decoded = StatementDataCodec.dec(decryptResult.value);
      if (responsesOnly && decoded.tag !== 'response') return null;
      return decoded;
    } catch {
      return null;
    }
  }

  function processIncomingStatement(statement: Statement, responsesOnly: boolean): void {
    if (!statement.data) return;
    const key = bytesToHex(statement.data);
    if (state.seenStatements.has(key)) return;
    state.seenStatements.add(key);

    // Cap the dedup cache to avoid unbounded growth over a long-lived
    // session. 1024 entries is ample — statements age out of the store
    // anyway.
    if (state.seenStatements.size > 1024) {
      const first = state.seenStatements.values().next().value;
      if (first !== undefined) state.seenStatements.delete(first);
    }

    const statementData = tryDecodeStatement(statement, responsesOnly);
    if (statementData) routeStatementData(statementData);
  }

  function routeStatementData(statementData: StatementData): void {
    if (statementData.tag === 'request') {
      if (statementData.value.requestId === state.incomingRequest?.requestId) return;
      state.incomingRequest = { requestId: statementData.value.requestId };
      state.respondedIncomingRequest = false;
      deliverStatementData(statementData);
    } else {
      // response
      if (state.outgoingRequest?.requestId !== statementData.value.requestId) return;
      const responseMessage: ResponseMessage = {
        type: 'response',
        localId: statementData.value.requestId,
        requestId: statementData.value.requestId,
        responseCode: statementData.value.responseCode,
      };
      for (const token of state.outgoingRequest.tokens) {
        const pending = state.pendingDelivery.get(token);
        if (pending) {
          pending.resolve(responseMessage);
          state.pendingDelivery.delete(token);
        }
      }
      state.outgoingRequest = null;
      deliverStatementData(statementData);
      processMessageQueue();
    }
  }

  // -------------------------------------------------------------------------
  // Outgoing batching + queue
  // -------------------------------------------------------------------------

  function processNewMessage(encoded: Uint8Array, token: string): void {
    if (state.outgoingRequest === null) {
      const requestId = nanoid();
      state.outgoingRequest = { requestId, messages: [encoded], tokens: [token] };
      encodeAndSubmitRequest(requestId, state.outgoingRequest.messages);
      return;
    }
    const currentSize = state.outgoingRequest.messages.reduce((s, m) => s + m.length, 0);
    if (currentSize + encoded.length <= maxRequestSize) {
      state.outgoingRequest.messages.push(encoded);
      state.outgoingRequest.tokens.push(token);
      state.outgoingRequest.requestId = nanoid();
      encodeAndSubmitRequest(state.outgoingRequest.requestId, state.outgoingRequest.messages);
    } else {
      state.messageQueue.push({ encoded, token });
    }
  }

  function processMessageQueue(): void {
    while (state.messageQueue.length > 0) {
      const head = state.messageQueue[0]!;
      if (state.outgoingRequest !== null) {
        const currentSize = state.outgoingRequest.messages.reduce((s, m) => s + m.length, 0);
        if (currentSize + head.encoded.length > maxRequestSize) break;
      }
      state.messageQueue.shift();
      processNewMessage(head.encoded, head.token);
    }
  }

  // -------------------------------------------------------------------------
  // Upstream subscriptions
  // -------------------------------------------------------------------------

  function ensureStoreSubscriptions(): void {
    if (incomingStoreUnsub || state.phase === 'disposed') return;
    incomingStoreUnsub = statementStore.subscribe([incomingSessionId], statements => {
      for (const s of statements) processIncomingStatement(s, false);
    });
    // Our own outgoing topic carries both our request-echoes (filtered
    // by proof.signer !== peer) and the peer's response ACKs.
    outgoingStoreUnsub = statementStore.subscribe([outgoingSessionId], statements => {
      for (const s of statements) processIncomingStatement(s, true);
    });
  }

  function teardownStoreSubscriptions(): void {
    incomingStoreUnsub?.();
    outgoingStoreUnsub?.();
    incomingStoreUnsub = null;
    outgoingStoreUnsub = null;
  }

  // -------------------------------------------------------------------------
  // Init-time recovery from chain history
  // -------------------------------------------------------------------------

  function init(): void {
    void Promise.all([statementStore.query([outgoingSessionId]), statementStore.query([incomingSessionId])]).then(
      ([ownResult, peerResult]) => {
        if (state.phase === 'disposed') return;
        const ownStatements = ownResult.isOk() ? ownResult.value : [];
        const peerStatements = peerResult.isOk() ? peerResult.value : [];

        // Seed `state.expiry` from the maximum expiry we observe on our
        // outgoing topic so every subsequent submission is monotonically
        // greater and the substrate store always accepts replacements.
        let maxExpiry = 0n;
        for (const s of ownStatements) {
          if (s.expiry !== undefined && s.expiry > maxExpiry) maxExpiry = s.expiry;
        }
        state.expiry = maxExpiry;

        // Pre-populate dedup cache with every statement we've already
        // seen on chain.
        for (const s of [...ownStatements, ...peerStatements]) {
          if (s.data) state.seenStatements.add(bytesToHex(s.data));
        }

        const decodeAll = (statements: Statement[]): StatementData[] => {
          const decoded: StatementData[] = [];
          for (const s of statements) {
            const v = tryDecodeStatement(s, false);
            if (v) decoded.push(v);
          }
          return decoded;
        };

        const ownDecoded = decodeAll(ownStatements);
        const peerDecoded = decodeAll(peerStatements);

        const ownRequest = ownDecoded.find(d => d.tag === 'request');
        const ownResponse = ownDecoded.find(d => d.tag === 'response');
        const peerRequest = peerDecoded.find(d => d.tag === 'request');
        const peerResponse = peerDecoded.find(d => d.tag === 'response');

        // If we had an outgoing request that is not yet ACKed, restore
        // it so later submitRequestMessage() calls coalesce into it.
        // Tokens are lost — there is no pending delivery promise from a
        // previous process run to resolve.
        if (ownRequest && ownRequest.tag === 'request') {
          const hasAck = ownResponse?.tag === 'response' && ownResponse.value.requestId === ownRequest.value.requestId;
          if (!hasAck) {
            state.outgoingRequest = {
              requestId: ownRequest.value.requestId,
              messages: ownRequest.value.data,
              tokens: [],
            };
          }
        }

        // If the peer had an unresponded request at init time, surface
        // it via deliverStatementData so the app can ACK+reply.
        if (peerRequest && peerRequest.tag === 'request') {
          state.incomingRequest = { requestId: peerRequest.value.requestId };
          state.respondedIncomingRequest =
            peerResponse?.tag === 'response' && peerResponse.value.requestId === peerRequest.value.requestId;
          if (!state.respondedIncomingRequest) {
            // `phase` is still 'initialization' so deliverStatementData
            // buffers the message if no subscriber is registered yet.
            deliverStatementData(peerRequest);
          }
        }

        state.phase = 'active';
        processMessageQueue();
        // Activate the upstream subscriptions now that init has set up
        // seenStatements + incomingRequest state — otherwise a peer
        // statement that arrives before any session-level subscribe()
        // would be dropped.
        ensureStoreSubscriptions();
      },
    );
  }

  // -------------------------------------------------------------------------
  // Session API
  // -------------------------------------------------------------------------

  function responseCodeToResult(code: ResponseCode): ResultAsync<void, SessionError> {
    switch (code) {
      case 'success':
        return okAsync<void, SessionError>(undefined);
      case 'decodingFailed':
        return errAsync<void, SessionError>({ tag: 'DecodingFailed' });
      case 'decryptionFailed':
        return errAsync<void, SessionError>({ tag: 'DecryptionFailed' });
      case 'unknown':
        return errAsync<void, SessionError>({ tag: 'UnknownResponse' });
    }
  }

  const session: Session = {
    request<T>(codec: Codec<T>, payload: T): ResultAsync<void, SessionError> {
      return session
        .submitRequestMessage(codec, payload)
        .andThen(({ requestId }) =>
          session.waitForResponseMessage(requestId).andThen(({ responseCode }) => responseCodeToResult(responseCode)),
        );
    },

    submitRequestMessage<T>(codec: Codec<T>, payload: T) {
      if (state.phase === 'disposed') return errAsync<{ requestId: string }, SessionError>({ tag: 'Disposed' });

      let encoded: Uint8Array;
      try {
        encoded = codec.enc(payload);
      } catch (e) {
        return errAsync<{ requestId: string }, SessionError>({
          tag: 'CodecEncodeFailed',
          detail: e instanceof Error ? e.message : String(e),
        });
      }
      if (encoded.length > maxRequestSize) {
        return errAsync<{ requestId: string }, SessionError>({
          tag: 'MessageTooBig',
          size: encoded.length,
          maxSize: maxRequestSize,
        });
      }

      // A caller that only submits (no subscribe) still needs the
      // outgoing-topic subscription live to receive peer ACKs — otherwise
      // request() would never resolve.
      ensureStoreSubscriptions();

      const token = nanoid();
      let resolveFn!: (r: ResponseMessage) => void;
      let rejectFn!: (e: SessionError) => void;
      const promise = new Promise<ResponseMessage>((resolve, reject) => {
        resolveFn = resolve;
        rejectFn = (e: SessionError) => reject(e);
      });
      state.pendingDelivery.set(token, { resolve: resolveFn, reject: rejectFn, promise });

      if (state.phase === 'initialization') {
        state.messageQueue.push({ encoded, token });
      } else {
        processNewMessage(encoded, token);
      }

      return okAsync<{ requestId: string }, SessionError>({ requestId: token });
    },

    submitResponseMessage(requestId: string, responseCode: ResponseCode) {
      if (state.phase === 'disposed') return errAsync<void, SessionError>({ tag: 'Disposed' });
      if (state.respondedIncomingRequest) return okAsync<void, SessionError>(undefined);
      if (state.incomingRequest?.requestId !== requestId) {
        return errAsync<void, SessionError>({ tag: 'NoIncomingRequest', requestId });
      }
      state.respondedIncomingRequest = true;

      let encoded: Uint8Array;
      try {
        encoded = StatementDataCodec.enc({ tag: 'response', value: { requestId, responseCode } });
      } catch (e) {
        return errAsync<void, SessionError>({
          tag: 'CodecEncodeFailed',
          detail: e instanceof Error ? e.message : String(e),
        });
      }
      return submitStatementData(responseChannel, incomingSessionId, encoded);
    },

    waitForResponseMessage(token) {
      const pending = state.pendingDelivery.get(token);
      if (!pending) return errAsync<ResponseMessage, SessionError>({ tag: 'Unknown', detail: 'no pending delivery' });
      return ResultAsync.fromPromise(pending.promise, e => {
        if (e && typeof e === 'object' && 'tag' in e) return e as SessionError;
        return { tag: 'Unknown', detail: e instanceof Error ? e.message : String(e) };
      });
    },

    waitForRequestMessage<T, S>(codec: Codec<T>, filter: Filter<T, S>): ResultAsync<S, SessionError> {
      return ResultAsync.fromPromise(
        new Promise<S>(resolve => {
          const unsub = session.subscribe(codec, messages => {
            for (const message of messages) {
              if (message.type !== 'request') continue;
              if (message.payload.status !== 'parsed') continue;
              const matched = filter(message.payload.value);
              if (matched !== undefined) {
                unsub();
                resolve(matched);
                break;
              }
            }
          });
        }),
        e => ({ tag: 'Unknown' as const, detail: e instanceof Error ? e.message : String(e) }),
      );
    },

    subscribe<T>(codec: Codec<T>, callback: (messages: Message<T>[]) => void): () => void {
      const sub: Subscriber = {
        codec: codec as Codec<unknown>,
        callback: callback as (messages: Message<unknown>[]) => void,
      };
      subscribers.add(sub);
      ensureStoreSubscriptions();

      // Replay buffered messages to this new subscriber so late
      // subscribers don't miss statements discovered during init.
      if (bufferedMessages.length > 0) {
        const replay = bufferedMessages.flatMap(sd => toMessages(sd, codec));
        if (replay.length > 0) callback(replay);
      }

      return () => {
        subscribers.delete(sub);
        // Subscriptions stay live until `dispose()`. Tearing them down
        // on last-unsubscribe (like triangle does) is fragile for us —
        // if the app subscribes, unsubscribes, then later calls
        // `request()`, the ACK would be missed. Our one upstream per
        // topic is cheap; keeping it alive is simpler.
      };
    },

    dispose() {
      if (state.phase === 'disposed') return;
      state.phase = 'disposed';
      teardownStoreSubscriptions();
      subscribers.clear();
      for (const [, pending] of state.pendingDelivery) {
        pending.reject({ tag: 'Disposed' });
      }
      // Keep `state.pendingDelivery` populated with rejected promises so
      // a `waitForResponseMessage` that races the dispose still surfaces
      // `{ tag: 'Disposed' }` via the rejection rather than "no pending
      // delivery". We never hold enough data to leak anything material.
      state.messageQueue = [];
      state.outgoingRequest = null;
      state.incomingRequest = null;
      bufferedMessages.length = 0;
    },
  };

  init();

  return session;
}
