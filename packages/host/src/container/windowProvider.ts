/**
 * Window-based provider.
 *
 * Implements the Provider interface targeting a Window reference,
 * using `window.postMessage` for bidirectional communication.
 *
 * Accepts either a direct Window reference or a getter that resolves
 * lazily (e.g. `() => iframe.contentWindow`). When the getter returns
 * null, outgoing messages are silently dropped and incoming messages
 * that can't be validated are ignored — the transport's handshake
 * retry handles reconnection.
 */

import type { Provider, Logger } from '@polkadot/shared';
import { createDefaultLogger } from '@polkadot/shared';

function isProtocolMessage(data: unknown): boolean {
  return (
    typeof data === 'object' &&
    data !== null &&
    'requestId' in (data as Record<string, unknown>) &&
    'payload' in (data as Record<string, unknown>)
  );
}

function isValidMessage(event: MessageEvent, sourceWindow: Window | null, currentWindow: Window): boolean {
  return (
    sourceWindow !== null &&
    event.source !== currentWindow &&
    event.source === sourceWindow &&
    event.data != null &&
    (event.data instanceof Uint8Array ||
      (typeof event.data === 'object' && event.data.constructor?.name === 'Uint8Array') ||
      isProtocolMessage(event.data))
  );
}

export type WindowRef = Window | (() => Window | null);

function resolveWindow(ref: WindowRef): Window | null {
  return typeof ref === 'function' ? ref() : ref;
}

export function createWindowProvider(target: WindowRef, logger?: Logger): Provider {
  let disposed = false;
  const subscribers = new Set<(message: Uint8Array | unknown) => void>();

  const messageHandler = (event: MessageEvent): void => {
    if (disposed) return;
    if (!isValidMessage(event, resolveWindow(target), window)) return;

    for (const subscriber of subscribers) {
      subscriber(event.data);
    }
  };

  window.addEventListener('message', messageHandler);

  return {
    logger: logger ?? createDefaultLogger(),

    isCorrectEnvironment() {
      return true;
    },

    postMessage(message) {
      if (disposed) return;
      const targetWindow = resolveWindow(target);
      if (!targetWindow) return;

      if (message instanceof Uint8Array) {
        targetWindow.postMessage(message, '*', [message.buffer]);
      } else {
        targetWindow.postMessage(message, '*');
      }
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
