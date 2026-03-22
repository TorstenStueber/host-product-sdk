/**
 * Window-based provider.
 *
 * Implements the Provider interface targeting a Window reference,
 * using `window.postMessage` for bidirectional communication.
 *
 * Accepts either a direct Window reference or a Promise that resolves
 * to one (e.g. when the iframe hasn't loaded yet). Messages sent before
 * the promise resolves are delivered once the window becomes available.
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

function isValidMessage(event: MessageEvent, sourceWindow: Window | undefined, currentWindow: Window): boolean {
  return (
    sourceWindow !== undefined &&
    event.source !== currentWindow &&
    event.source === sourceWindow &&
    event.data != null &&
    (event.data instanceof Uint8Array ||
      (typeof event.data === 'object' && event.data.constructor?.name === 'Uint8Array') ||
      isProtocolMessage(event.data))
  );
}

export function createWindowProvider(targetOrPromise: Window | Promise<Window>): Provider {
  let disposed = false;
  let targetWindow: Window | undefined;
  const subscribers = new Set<(message: Uint8Array | unknown) => void>();

  const targetReady: Promise<Window> =
    targetOrPromise instanceof Promise ? targetOrPromise : Promise.resolve(targetOrPromise);

  targetReady.then(w => {
    if (disposed) return;
    targetWindow = w;
  });

  function withWindow(fn: (w: Window) => void): void {
    if (targetWindow) {
      fn(targetWindow);
    } else {
      targetReady.then(w => {
        if (!disposed) fn(w);
      });
    }
  }

  const messageHandler = (event: MessageEvent): void => {
    if (disposed) return;
    if (!isValidMessage(event, targetWindow, window)) return;

    for (const subscriber of subscribers) {
      subscriber(event.data);
    }
  };

  window.addEventListener('message', messageHandler);

  return {
    postMessage(message) {
      if (disposed) return;
      withWindow(w => {
        if (disposed) return;
        if (message instanceof Uint8Array) {
          w.postMessage(message, '*', [message.buffer]);
        } else {
          w.postMessage(message, '*');
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
      window.removeEventListener('message', messageHandler);
    },
  };
}
