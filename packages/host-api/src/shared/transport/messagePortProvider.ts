/**
 * MessagePort-based provider.
 *
 * Implements the Provider interface over a `MessagePort`.  The port may
 * be available immediately or delivered as a Promise (e.g. when the
 * other side has not connected yet).  Messages sent before the port
 * resolves are queued and flushed once it is ready.
 */

import type { Provider } from './provider.js';

function isProtocolMessage(data: unknown): boolean {
  return (
    typeof data === 'object' &&
    data !== null &&
    'requestId' in (data as Record<string, unknown>) &&
    'payload' in (data as Record<string, unknown>)
  );
}

function isValidMessage(event: MessageEvent): boolean {
  return (
    event.data != null &&
    (event.data instanceof Uint8Array ||
      (typeof event.data === 'object' && event.data.constructor?.name === 'Uint8Array') ||
      isProtocolMessage(event.data))
  );
}

/**
 * Create a Provider that communicates over a MessagePort.
 *
 * @param portOrPromise - A ready MessagePort or a Promise that resolves
 *   to one.  Messages sent before the promise resolves are delivered
 *   once the port becomes available.
 */
export function createMessagePortProvider(portOrPromise: MessagePort | Promise<MessagePort>): Provider {
  let disposed = false;
  let port: MessagePort | undefined;
  const subscribers = new Set<(message: Uint8Array | unknown) => void>();

  const messageHandler = (event: MessageEvent): void => {
    if (disposed) return;
    if (!isValidMessage(event)) return;
    for (const subscriber of subscribers) {
      subscriber(event.data);
    }
  };

  // Resolve the port — sync if already available, async otherwise.
  const portReady: Promise<MessagePort> =
    portOrPromise instanceof Promise ? portOrPromise : Promise.resolve(portOrPromise);

  portReady.then(p => {
    if (disposed) return;
    port = p;
    port.onmessage = messageHandler;
    if (typeof port.start === 'function') {
      port.start();
    }
  });

  function withPort(fn: (p: MessagePort) => void): void {
    if (port) {
      fn(port);
    } else {
      portReady.then(p => {
        if (!disposed) fn(p);
      });
    }
  }

  return {
    isCorrectEnvironment() {
      return true;
    },

    postMessage(message) {
      if (disposed) return;
      withPort(p => {
        if (disposed) return;
        if (message instanceof Uint8Array) {
          p.postMessage(message, [message.buffer]);
        } else {
          p.postMessage(message);
        }
      });
    },

    subscribe(callback) {
      subscribers.add(callback);
      return () => {
        subscribers.delete(callback);
      };
    },

    dispose() {
      disposed = true;
      subscribers.clear();
      if (port) {
        port.onmessage = null;
      } else {
        portReady.then(p => {
          p.onmessage = null;
        });
      }
    },
  };
}
