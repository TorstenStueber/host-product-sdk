/**
 * Core transport layer.
 *
 * Ported from triangle-js-sdks `packages/host-api/src/transport.ts`,
 * adapted for the new architecture:
 *
 * 1. Auto-detects incoming message format (Uint8Array → SCALE,
 *    plain object → structured clone) and auto-upgrades the
 *    outgoing codec when structured clone is detected.
 * 2. Exposes a `swapCodecAdapter` method so codec negotiation can
 *    explicitly upgrade the wire format.
 * 3. Keeps the full API surface: `request`, `handleRequest`,
 *    `subscribe`, `handleSubscription`, plus low-level
 *    `postMessage` / `listenMessages`.
 */

import { createNanoEvents } from 'nanoevents';

import type { CodecAdapter, ProtocolMessage } from '../codec/adapter.js';
import { structuredCloneCodecAdapter } from '../codec/structured/index.js';
import { scaleCodecAdapter } from '../codec/scale/adapter.js';
import type {
  RequestMethod,
  SubscriptionMethod,
  ActionString,
  RequestCodecType,
  ResponseCodecType,
  StartCodecType,
  ReceiveCodecType,
} from '../../api/protocol.js';
import { composeAction, delay, promiseWithResolvers } from '../util/helpers.js';
import { createIdFactory } from '../util/idFactory.js';
import type { Provider } from './provider.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Interval (ms) between handshake retries. */
export const HANDSHAKE_INTERVAL = 50;

/** Maximum time (ms) to wait for a handshake response. */
export const HANDSHAKE_TIMEOUT = 10_000;

/**
 * Marker value sent as the response when a request targets a method
 * that has no registered handler. The sender detects this and rejects
 * the promise with a `MethodNotSupported` error.
 */
const NOT_SUPPORTED_MARKER = { _notSupported: true } as const;

/** Error thrown when a request targets a method with no registered handler. */
export class MethodNotSupportedError extends Error {
  constructor(method: string) {
    super(`Method not supported: ${method}`);
    this.name = 'MethodNotSupportedError';
  }
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

export type Subscription = {
  unsubscribe: () => void;
  onInterrupt(callback: () => void): () => void;
};

export type Transport = {
  /** Resolves when the handshake completes. Rejects on timeout or disposal. */
  whenReady(): Promise<void>;
  destroy(): void;
  onConnectionStatusChange(callback: (status: ConnectionStatus) => void): () => void;
  onDestroy(callback: () => void): () => void;

  /** Swap the codec adapter (e.g. after negotiation). */
  swapCodecAdapter(adapter: CodecAdapter): void;

  request<M extends RequestMethod>(
    method: M,
    payload: RequestCodecType<M>,
    signal?: AbortSignal,
  ): Promise<ResponseCodecType<M>>;

  handleRequest<M extends RequestMethod>(
    method: M,
    handler: (message: RequestCodecType<M>) => Promise<ResponseCodecType<M>>,
  ): () => void;

  subscribe<M extends SubscriptionMethod>(
    method: M,
    payload: StartCodecType<M>,
    callback: (payload: ReceiveCodecType<M>) => void,
  ): Subscription;

  /**
   * Register a handler for a subscription method.
   *
   * Each time a `start` message arrives for `method`, `handler` is invoked
   * with:
   *
   * - `params`: the versioned start payload.
   * - `send`: pushes a value to the subscriber. Safe to call repeatedly until
   *   the subscription is terminated.
   * - `interrupt`: terminates the subscription from the producer side. Posts
   *   an `interrupt` message to the consumer and triggers the handler's
   *   cleanup (see below). Idempotent — extra calls after the first are
   *   ignored.
   *
   * `handler` must return a cleanup function. The transport guarantees the
   * cleanup runs exactly once, whichever of the three termination paths is
   * taken:
   *
   * 1. The consumer sends `stop` (e.g. the subscriber unsubscribed).
   * 2. The handler calls `interrupt()` synchronously during its own
   *    invocation.
   * 3. The handler calls `interrupt()` asynchronously after it returned.
   *
   * Handlers should put **all** teardown logic in the returned cleanup rather
   * than performing it inline before calling `interrupt()` — the transport
   * will invoke it for them.
   *
   * @returns A function that unregisters the handler and runs cleanup for
   *   every in-flight subscription created by it.
   */
  handleSubscription<M extends SubscriptionMethod>(
    method: M,
    handler: (
      params: StartCodecType<M>,
      send: (value: ReceiveCodecType<M>) => void,
      interrupt: () => void,
    ) => () => void,
  ): () => void;

  // Low-level -- use at your own risk.
  postMessage(requestId: string, payload: { tag: ActionString; value: unknown }): void;
  listenMessages(
    action: ActionString,
    callback: (requestId: string, value: unknown) => void,
    onError?: (error: unknown) => void,
  ): () => void;
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

type InternalListener = {
  unsubscribe: () => void;
  call(payload: unknown): void;
};

type InternalSubscription = {
  requestId: string;
  kill(): void;
  listeners: InternalListener[];
};

/**
 * Build a deterministic key for subscription de-duplication.
 *
 * Two `subscribe()` calls with the same method + payload share a
 * single underlying wire subscription; only their callbacks differ.
 */
function getSubscriptionKey(method: string, payload: { tag: string; value: unknown }): string {
  // Use a stable JSON representation.  For binary codecs this won't be
  // as compact as a hex hash of the encoded payload, but it is
  // codec-agnostic and still unique.
  try {
    return `${method}_${JSON.stringify(payload)}`;
  } catch {
    // Fallback for non-serialisable payloads.
    return `${method}_${String(payload)}`;
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export type CreateTransportOptions = {
  provider: Provider;

  /**
   * Handshake role:
   * - `'initiate'`: eagerly sends handshake requests until the other side responds.
   * - `'respond'`: registers a handler that responds to incoming handshake requests.
   */
  handshake: 'initiate' | 'respond';

  /**
   * Protocol version id sent during handshake.
   * Defaults to `1` (the original JAM_CODEC_PROTOCOL_ID).
   */
  protocolVersionId?: number;

  /**
   * Prefix for generated request IDs.
   *
   * Use `"h:"` on the host side and `"p:"` on the product side so that
   * IDs from independent counters never collide on the shared channel.
   */
  idPrefix?: string;
};

export function createTransport(options: CreateTransportOptions): Transport {
  const { provider, handshake, protocolVersionId = 1, idPrefix = '' } = options;

  /** Codec used for encoding outgoing messages. Starts as SCALE, upgrades to structured clone. */
  let codecAdapter = scaleCodecAdapter;

  /**
   * Decode an incoming message by inspecting its shape:
   * - Uint8Array → SCALE decode
   * - Object with `requestId` → structured clone (identity)
   *
   * When a structured clone message is detected, the outgoing codec
   * is automatically upgraded to structured clone as well (preferred).
   */
  function decodeIncoming(message: Uint8Array | unknown): ProtocolMessage {
    if (
      message instanceof Uint8Array ||
      (typeof message === 'object' &&
        message !== null &&
        (message as { constructor?: { name?: string } }).constructor?.name === 'Uint8Array')
    ) {
      return scaleCodecAdapter.decode(message as Uint8Array);
    }

    if (typeof message === 'object' && message !== null && 'requestId' in (message as Record<string, unknown>)) {
      // Upgrade outgoing codec to structured clone on first structured clone message.
      codecAdapter = structuredCloneCodecAdapter;
      return message as ProtocolMessage;
    }

    throw new Error('Unrecognized message format');
  }

  const nextId = createIdFactory(idPrefix);

  const handshakeAbortController = new AbortController();

  let handshakePromise: Promise<void>;
  let connectionStatus: ConnectionStatus = 'disconnected';
  let disposed = false;

  const events = createNanoEvents<{
    connectionStatus: (status: ConnectionStatus) => void;
    destroy: () => void;
  }>();

  events.on('connectionStatus', value => {
    connectionStatus = value;
  });

  function changeConnectionStatus(status: ConnectionStatus): void {
    events.emit('connectionStatus', status);
  }

  function throwIfDisposed(): void {
    if (disposed) {
      throw new Error('Transport is disposed');
    }
  }

  // -- Subscription multiplexing --------------------------------------------

  const activeSubscriptions: Map<string, InternalSubscription> = new Map();

  // -- Handler tracking (for not-supported detection) -----------------------

  /** Actions that have registered handlers. */
  const handledActions = new Set<string>();

  // -- Transport implementation ---------------------------------------------

  const transport: Transport = {
    swapCodecAdapter(adapter: CodecAdapter) {
      codecAdapter = adapter;
    },

    // -- Handshake ----------------------------------------------------------

    whenReady() {
      throwIfDisposed();
      return handshakePromise;
    },

    // -- Request / Response -------------------------------------------------

    async request<M extends RequestMethod>(
      method: M,
      payload: RequestCodecType<M>,
      signal?: AbortSignal,
    ): Promise<ResponseCodecType<M>> {
      throwIfDisposed();
      await transport.whenReady();

      signal?.throwIfAborted();

      const requestId = nextId();
      const requestAction = composeAction(method, 'request');
      const responseAction = composeAction(method, 'response');

      const { resolve, reject, promise } = promiseWithResolvers<ResponseCodecType<M>>();

      const cleanup = (): void => {
        unsubscribe();
        signal?.removeEventListener('abort', onAbort);
      };

      const onAbort = (): void => {
        cleanup();
        reject(signal?.reason ?? new Error('Request aborted'));
      };

      const unsubscribe = transport.listenMessages(responseAction, (receivedId, value) => {
        if (receivedId === requestId) {
          cleanup();
          const v = value as Record<string, unknown>;
          if (v && v._notSupported) {
            reject(new MethodNotSupportedError(method));
          } else {
            resolve(value as ResponseCodecType<M>);
          }
        }
      });

      signal?.addEventListener('abort', onAbort, { once: true });

      transport.postMessage(requestId, { tag: requestAction, value: payload });

      return promise;
    },

    // -- Handle incoming requests (host side) -------------------------------

    handleRequest<M extends RequestMethod>(
      method: M,
      handler: (message: RequestCodecType<M>) => Promise<ResponseCodecType<M>>,
    ): () => void {
      throwIfDisposed();

      const requestAction = composeAction(method, 'request');
      const responseAction = composeAction(method, 'response');

      return transport.listenMessages(requestAction, (requestId, value) => {
        void Promise.resolve(handler(value as RequestCodecType<M>)).then(result => {
          transport.postMessage(requestId, { tag: responseAction, value: result });
        });
      });
    },

    // -- Subscriptions (product side) ---------------------------------------

    subscribe<M extends SubscriptionMethod>(
      method: M,
      payload: StartCodecType<M>,
      callback: (payload: ReceiveCodecType<M>) => void,
    ): Subscription {
      throwIfDisposed();

      const subEvents = createNanoEvents<{ interrupt: () => void }>();

      const startAction = composeAction(method, 'start');
      const startPayload = { tag: startAction, value: payload };
      const subscriptionKey = getSubscriptionKey(method, startPayload);

      let subscription = activeSubscriptions.get(subscriptionKey);

      function unsub(): void {
        const sub = activeSubscriptions.get(subscriptionKey);
        if (sub) {
          const remaining = sub.listeners.filter(l => l.call !== callback);
          if (remaining.length === 0) {
            activeSubscriptions.delete(subscriptionKey);
            sub.kill();
          } else {
            sub.listeners = remaining;
          }
        }
      }

      const listener: InternalListener = {
        call: callback,
        unsubscribe: unsub,
      };

      const publicSubscription: Subscription = {
        unsubscribe: unsub,
        onInterrupt(cb) {
          return subEvents.on('interrupt', cb);
        },
      };

      if (!subscription) {
        const requestId = nextId();

        const stopAction = composeAction(method, 'stop');
        const interruptAction = composeAction(method, 'interrupt');
        const receiveAction = composeAction(method, 'receive');

        const unsubscribeReceive = transport.listenMessages(receiveAction, (receivedId, value) => {
          if (receivedId === requestId) {
            const sub = activeSubscriptions.get(subscriptionKey);
            if (sub) {
              for (const l of sub.listeners) {
                l.call(value);
              }
            }
          }
        });

        const unsubscribeInterrupt = transport.listenMessages(interruptAction, receivedId => {
          if (receivedId === requestId) {
            subEvents.emit('interrupt');
            stopSubscription();
          }
        });

        const stopSubscription = (): void => {
          unsubscribeReceive();
          unsubscribeInterrupt();
          subEvents.events = {};
        };

        subscription = {
          requestId,
          kill: () => {
            stopSubscription();
            transport.postMessage(requestId, { tag: stopAction, value: undefined });
          },
          listeners: [listener],
        };

        activeSubscriptions.set(subscriptionKey, subscription);
        transport.postMessage(requestId, startPayload);
      } else {
        subscription.listeners.push(listener);
      }

      return publicSubscription;
    },

    // -- Handle subscriptions (host side) -----------------------------------

    handleSubscription<M extends SubscriptionMethod>(
      method: M,
      handler: (
        params: StartCodecType<M>,
        send: (value: ReceiveCodecType<M>) => void,
        interrupt: () => void,
      ) => () => void,
    ): () => void {
      throwIfDisposed();

      const startAction = composeAction(method, 'start');
      const stopAction = composeAction(method, 'stop');
      const interruptAction = composeAction(method, 'interrupt');
      const receiveAction = composeAction(method, 'receive');

      const subscriptions: Map<string, () => void> = new Map();

      const unsubStart = transport.listenMessages(startAction, (requestId, value) => {
        if (subscriptions.has(requestId)) return;

        let interrupted = false;

        const unsubscribe = handler(
          value as StartCodecType<M>,
          // send callback
          value => {
            transport.postMessage(requestId, { tag: receiveAction, value });
          },
          // interrupt callback — idempotent. When invoked synchronously during
          // handler(), the outer `if (interrupted)` branch runs the cleanup.
          // When invoked asynchronously, the stored cleanup is pulled from the
          // map and invoked here so the handler never has to tear itself down
          // manually.
          () => {
            if (interrupted) return;
            interrupted = true;
            const storedUnsub = subscriptions.get(requestId);
            if (storedUnsub) {
              subscriptions.delete(requestId);
              storedUnsub();
            }
            transport.postMessage(requestId, { tag: interruptAction, value: undefined });
          },
        );

        if (interrupted) {
          unsubscribe();
        } else {
          subscriptions.set(requestId, unsubscribe);
        }
      });

      const unsubStop = transport.listenMessages(stopAction, requestId => {
        subscriptions.get(requestId)?.();
        subscriptions.delete(requestId);
      });

      return () => {
        subscriptions.forEach(unsub => unsub());
        subscriptions.clear();
        unsubStart();
        unsubStop();
      };
    },

    // -- Low-level message I/O ---------------------------------------------

    postMessage(requestId: string, payload: { tag: ActionString; value: unknown }): void {
      throwIfDisposed();

      const message: ProtocolMessage = { requestId, payload };
      const encoded = codecAdapter.encode(message);
      provider.postMessage(encoded);
    },

    listenMessages(
      action: ActionString,
      callback: (requestId: string, value: unknown) => void,
      onError?: (error: unknown) => void,
    ): () => void {
      // Track _request/_start actions so the not-supported catch-all
      // doesn't fire for actions that have low-level listeners.
      const isHandlerAction = action.endsWith('_request') || action.endsWith('_start');
      if (isHandlerAction) {
        handledActions.add(action);
      }

      const unsubscribe = provider.subscribe((message: Uint8Array | unknown) => {
        try {
          const result = decodeIncoming(message);

          if (result.payload.tag === action) {
            callback(result.requestId, result.payload.value);
          }
        } catch (e) {
          onError?.(e);
        }
      });

      return () => {
        unsubscribe();
        if (isHandlerAction) {
          handledActions.delete(action);
        }
      };
    },

    // -- Connection status --------------------------------------------------

    onConnectionStatusChange(callback: (status: ConnectionStatus) => void): () => void {
      callback(connectionStatus);
      return events.on('connectionStatus', callback);
    },

    onDestroy(callback: () => void): () => void {
      return events.on('destroy', callback);
    },

    // -- Lifecycle -----------------------------------------------------------

    destroy(): void {
      disposed = true;
      provider.dispose();
      changeConnectionStatus('disconnected');
      events.emit('destroy');
      events.events = {};
      handshakeAbortController.abort('Transport disposed');
    },
  };

  // -- Not-supported catch-all -----------------------------------------------
  //
  // Responds immediately to any _request or _start message that has no
  // registered handler, so the sender doesn't wait forever.

  provider.subscribe((message: Uint8Array | unknown) => {
    try {
      const result = decodeIncoming(message);
      const { tag } = result.payload;

      if (tag.endsWith('_request') && !handledActions.has(tag)) {
        const responseTag = tag.replace(/_request$/, '_response') as ActionString;
        transport.postMessage(result.requestId, { tag: responseTag, value: NOT_SUPPORTED_MARKER });
      } else if (tag.endsWith('_start') && !handledActions.has(tag)) {
        const interruptTag = tag.replace(/_start$/, '_interrupt') as ActionString;
        transport.postMessage(result.requestId, { tag: interruptTag, value: undefined });
      }
    } catch {
      // Ignore decode errors — handled by listenMessages subscribers.
    }
  });

  // -- Handshake setup -------------------------------------------------------

  if (handshake === 'respond') {
    // Host side: register handler and resolve whenReady() when the first
    // handshake request arrives and is successfully responded to.
    const { resolve: resolveHandshake, reject: rejectHandshake, promise } = promiseWithResolvers<void>();
    handshakePromise = promise;

    transport.handleRequest('host_handshake', async (version): Promise<ResponseCodecType<'host_handshake'>> => {
      if (version.tag === 'v1' && version.value === protocolVersionId) {
        changeConnectionStatus('connected');
        resolveHandshake();
        return { tag: 'v1', value: { success: true, value: undefined } };
      }
      return {
        tag: 'v1',
        value: { success: false, value: { tag: 'UnsupportedProtocolVersion', value: undefined } },
      };
    });

    // Reject on disposal so whenReady() doesn't hang forever.
    events.on('destroy', () => rejectHandshake(new Error('Transport destroyed before handshake completed')));
    // Suppress unhandled rejection — callers that care will await whenReady().
    handshakePromise.catch(() => {});
  } else {
    // Product side: eagerly start sending handshake requests.
    changeConnectionStatus('connecting');

    const performHandshake = (): Promise<void> => {
      const id = nextId();

      const cleanup = (interval: ReturnType<typeof setInterval>, unsubscribe: () => void): void => {
        clearInterval(interval);
        unsubscribe();
        handshakeAbortController.signal.removeEventListener('abort', unsubscribe);
      };

      return new Promise<void>((resolve, reject) => {
        const unsubscribe = transport.listenMessages('host_handshake_response', responseId => {
          if (responseId === id) {
            cleanup(interval, unsubscribe);
            resolve();
          }
        });

        handshakeAbortController.signal.addEventListener('abort', unsubscribe, {
          once: true,
        });

        const interval = setInterval(() => {
          if (handshakeAbortController.signal.aborted) {
            clearInterval(interval);
            reject(new Error('Handshake aborted'));
            return;
          }

          transport.postMessage(id, {
            tag: 'host_handshake_request',
            value: { tag: 'v1', value: protocolVersionId },
          });
        }, HANDSHAKE_INTERVAL);
      });
    };

    handshakePromise = Promise.race([
      performHandshake(),
      delay(HANDSHAKE_TIMEOUT).then(() => {
        handshakeAbortController.abort('Timeout');
        throw new Error('Handshake timed out');
      }),
    ]).then(
      () => {
        changeConnectionStatus('connected');
      },
      err => {
        changeConnectionStatus('disconnected');
        throw err;
      },
    );
    // Suppress unhandled rejection — callers that care will await whenReady().
    handshakePromise.catch(() => {});
  }

  return transport;
}
