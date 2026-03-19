/**
 * Core transport layer.
 *
 * Ported from triangle-js-sdks `packages/host-api/src/transport.ts`,
 * adapted for the new architecture:
 *
 * 1. Uses a pluggable {@link CodecAdapter} instead of the hard-coded
 *    `Message.enc`/`Message.dec` calls.
 * 2. Exposes a `swapCodecAdapter` method so codec negotiation can
 *    upgrade the wire format at runtime.
 * 3. Keeps the full API surface: `request`, `handleRequest`,
 *    `subscribe`, `handleSubscription`, plus low-level
 *    `postMessage` / `listenMessages`.
 */

import { createNanoEvents } from 'nanoevents';

import type { CodecAdapter, PostMessageData, ProtocolMessage } from '../codec/adapter.js';
import type { RequestMethod, SubscriptionMethod, ActionString } from '../codec/scale/protocol.js';
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

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

export type Subscription = {
  unsubscribe: VoidFunction;
  onInterrupt(callback: VoidFunction): VoidFunction;
};

export type RequestHandler = (
  message: unknown,
) => PromiseLike<unknown>;

export type SubscriptionHandler = (
  params: unknown,
  send: (value: unknown) => void,
  interrupt: () => void,
) => VoidFunction;

export type Transport = {
  readonly provider: Provider;

  isCorrectEnvironment(): boolean;
  isReady(): Promise<boolean>;
  destroy(): void;
  onConnectionStatusChange(callback: (status: ConnectionStatus) => void): VoidFunction;
  onDestroy(callback: VoidFunction): VoidFunction;

  /** Swap the codec adapter (e.g. after negotiation). */
  swapCodecAdapter(adapter: CodecAdapter): void;

  request(
    method: RequestMethod,
    payload: unknown,
    signal?: AbortSignal,
  ): Promise<unknown>;

  handleRequest(method: RequestMethod, handler: RequestHandler): VoidFunction;

  subscribe(
    method: SubscriptionMethod,
    payload: unknown,
    callback: (payload: unknown) => void,
  ): Subscription;

  handleSubscription(method: SubscriptionMethod, handler: SubscriptionHandler): VoidFunction;

  // Low-level -- use at your own risk.
  postMessage(requestId: string, payload: { tag: ActionString; value: unknown }): void;
  listenMessages(
    action: ActionString,
    callback: (requestId: string, data: { tag: string; value: unknown }) => void,
    onError?: (error: unknown) => void,
  ): VoidFunction;
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

type InternalListener = {
  unsubscribe: VoidFunction;
  call(payload: unknown): void;
};

type InternalSubscription = {
  requestId: string;
  kill(): void;
  listeners: InternalListener[];
};

function isConnected(status: ConnectionStatus): boolean {
  return status === 'connected';
}

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
  codecAdapter: CodecAdapter;

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
  const { provider, protocolVersionId = 1, idPrefix = '' } = options;
  let codecAdapter = options.codecAdapter;

  const nextId = createIdFactory(idPrefix);

  const handshakeAbortController = new AbortController();

  let handshakePromise: Promise<boolean> | null = null;
  let connectionStatusResolved = false;
  let connectionStatus: ConnectionStatus = 'disconnected';
  let disposed = false;

  const events = createNanoEvents<{
    connectionStatus: (status: ConnectionStatus) => void;
    destroy: VoidFunction;
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

  function throwIfIncorrectEnvironment(): void {
    if (!provider.isCorrectEnvironment()) {
      throw new Error('Environment is not correct');
    }
  }

  function checks(): void {
    throwIfDisposed();
    throwIfIncorrectEnvironment();
  }

  // -- Subscription multiplexing --------------------------------------------

  const activeSubscriptions: Map<string, InternalSubscription> = new Map();

  // -- Transport implementation ---------------------------------------------

  const transport: Transport = {
    provider,

    isCorrectEnvironment() {
      return provider.isCorrectEnvironment();
    },

    swapCodecAdapter(adapter: CodecAdapter) {
      codecAdapter = adapter;
    },

    // -- Handshake ----------------------------------------------------------

    isReady() {
      checks();

      if (connectionStatusResolved) {
        return Promise.resolve(isConnected(connectionStatus));
      }

      if (handshakePromise) {
        return handshakePromise;
      }

      changeConnectionStatus('connecting');

      const performHandshake = (): Promise<boolean> => {
        const id = nextId();
        let resolved = false;

        const cleanup = (interval: ReturnType<typeof setInterval>, unsubscribe: VoidFunction): void => {
          clearInterval(interval);
          unsubscribe();
          handshakeAbortController.signal.removeEventListener('abort', unsubscribe);
        };

        return new Promise<boolean>(resolve => {
          const unsubscribe = transport.listenMessages(
            'host_handshake_response',
            (responseId) => {
              if (responseId === id) {
                cleanup(interval, unsubscribe);
                resolved = true;
                resolve(true);
              }
            },
          );

          handshakeAbortController.signal.addEventListener('abort', unsubscribe, {
            once: true,
          });

          const interval = setInterval(() => {
            if (handshakeAbortController.signal.aborted) {
              clearInterval(interval);
              resolve(false);
              return;
            }

            transport.postMessage(id, {
              tag: 'host_handshake_request',
              value: { tag: 'v1', value: protocolVersionId },
            });
          }, HANDSHAKE_INTERVAL);
        }).then(success => {
          if (!success && !resolved) {
            handshakeAbortController.abort('Timeout');
          }
          return success;
        });
      };

      const timedOutRequest = Promise.race([
        performHandshake(),
        delay(HANDSHAKE_TIMEOUT).then(() => false),
      ]);

      handshakePromise = timedOutRequest.then(result => {
        handshakePromise = null;
        connectionStatusResolved = true;
        changeConnectionStatus(result ? 'connected' : 'disconnected');
        return result;
      });

      return handshakePromise;
    },

    // -- Request / Response -------------------------------------------------

    async request(
      method: RequestMethod,
      payload: unknown,
      signal?: AbortSignal,
    ): Promise<unknown> {
      checks();

      if (!(await transport.isReady())) {
        throw new Error('Polkadot host is not ready');
      }

      signal?.throwIfAborted();

      const requestId = nextId();
      const requestAction = composeAction(method, 'request');
      const responseAction = composeAction(method, 'response');

      const { resolve, reject, promise } = promiseWithResolvers<unknown>();

      const cleanup = (): void => {
        unsubscribe();
        signal?.removeEventListener('abort', onAbort);
      };

      const onAbort = (): void => {
        cleanup();
        reject(signal?.reason ?? new Error('Request aborted'));
      };

      const unsubscribe = transport.listenMessages(
        responseAction,
        (receivedId, responsePayload) => {
          if (receivedId === requestId) {
            cleanup();
            resolve(responsePayload.value);
          }
        },
      );

      signal?.addEventListener('abort', onAbort, { once: true });

      transport.postMessage(requestId, { tag: requestAction, value: payload });

      return promise;
    },

    // -- Handle incoming requests (host side) -------------------------------

    handleRequest(method: RequestMethod, handler: RequestHandler): VoidFunction {
      checks();

      const requestAction = composeAction(method, 'request');
      const responseAction = composeAction(method, 'response');

      return transport.listenMessages(requestAction, (requestId, requestPayload) => {
        void Promise.resolve(handler(requestPayload.value)).then(result => {
          transport.postMessage(requestId, { tag: responseAction, value: result });
        });
      });
    },

    // -- Subscriptions (product side) ---------------------------------------

    subscribe(
      method: SubscriptionMethod,
      payload: unknown,
      callback: (payload: unknown) => void,
    ): Subscription {
      checks();

      const subEvents = createNanoEvents<{ interrupt: VoidFunction }>();

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

        const unsubscribeReceive = transport.listenMessages(
          receiveAction,
          (receivedId, data) => {
            if (receivedId === requestId) {
              const sub = activeSubscriptions.get(subscriptionKey);
              if (sub) {
                for (const l of sub.listeners) {
                  l.call(data.value);
                }
              }
            }
          },
        );

        const unsubscribeInterrupt = transport.listenMessages(
          interruptAction,
          (receivedId) => {
            if (receivedId === requestId) {
              subEvents.emit('interrupt');
              stopSubscription();
            }
          },
        );

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

    handleSubscription(method: SubscriptionMethod, handler: SubscriptionHandler): VoidFunction {
      checks();

      const startAction = composeAction(method, 'start');
      const stopAction = composeAction(method, 'stop');
      const interruptAction = composeAction(method, 'interrupt');
      const receiveAction = composeAction(method, 'receive');

      const subscriptions: Map<string, VoidFunction> = new Map();

      const unsubStart = transport.listenMessages(
        startAction,
        (requestId, startPayload) => {
          if (subscriptions.has(requestId)) return;

          let interrupted = false;

          const unsubscribe = handler(
            startPayload.value,
            // send callback
            (value: unknown) => {
              transport.postMessage(requestId, { tag: receiveAction, value });
            },
            // interrupt callback
            () => {
              interrupted = true;
              subscriptions.delete(requestId);
              transport.postMessage(requestId, { tag: interruptAction, value: undefined });
            },
          );

          if (interrupted) {
            unsubscribe();
          } else {
            subscriptions.set(requestId, unsubscribe);
          }
        },
      );

      const unsubStop = transport.listenMessages(stopAction, (requestId) => {
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
      checks();

      const message: ProtocolMessage = { requestId, payload };
      const encoded = codecAdapter.encode(message);
      provider.postMessage(encoded);
    },

    listenMessages(
      action: ActionString,
      callback: (requestId: string, data: { tag: string; value: unknown }) => void,
      onError?: (error: unknown) => void,
    ): VoidFunction {
      return provider.subscribe((message: Uint8Array | unknown) => {
        try {
          const result = codecAdapter.decode(message as PostMessageData);

          if (result.payload.tag === action) {
            callback(result.requestId, result.payload);
          }
        } catch (e) {
          onError?.(e);
        }
      });
    },

    // -- Connection status --------------------------------------------------

    onConnectionStatusChange(callback: (status: ConnectionStatus) => void): VoidFunction {
      callback(connectionStatus);
      return events.on('connectionStatus', callback);
    },

    onDestroy(callback: VoidFunction): VoidFunction {
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

  // -- Auto-wire handshake handler on the host side -------------------------
  //
  // When the provider detects that it is in the correct environment (i.e.
  // it is the host, not the product) it automatically responds to
  // handshake requests.

  if (provider.isCorrectEnvironment()) {
    transport.handleRequest('host_handshake', async (version: unknown) => {
      const v = version as { tag: string; value: number };

      switch (v.tag) {
        case 'v1': {
          if (v.value === protocolVersionId) {
            return { tag: 'v1', value: { success: true, value: undefined } };
          }
          return {
            tag: 'v1',
            value: { success: false, value: { tag: 'UnsupportedProtocolVersion', value: undefined } },
          };
        }
        default:
          return {
            tag: v.tag,
            value: { success: false, value: { tag: 'UnsupportedProtocolVersion', value: undefined } },
          };
      }
    });
  }

  return transport;
}
