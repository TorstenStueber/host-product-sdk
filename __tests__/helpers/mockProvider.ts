/**
 * Mock provider pair for testing the transport layer.
 *
 * Creates two providers connected to each other: when one posts a message,
 * the other's subscribers receive it -- like two sides of postMessage.
 */

import type { Provider, Logger } from '@polkadot/host-api';
import { createDefaultLogger } from '@polkadot/host-api';

export type MockProvider = Provider & {
  /** Manually inject a message as if it was received from the other side. */
  _injectMessage(message: unknown): void;
};

function createMockProvider(name: string, isCorrectEnv: boolean, sendTo: () => MockProvider | null): MockProvider {
  const logger: Logger = createDefaultLogger(name);
  const subscribers = new Set<(message: unknown) => void>();
  let disposed = false;

  return {
    logger,

    isCorrectEnvironment() {
      return isCorrectEnv;
    },

    postMessage(message: unknown) {
      if (disposed) return;
      // Deliver asynchronously to mimic real postMessage behavior,
      // but use queueMicrotask for speed in tests.
      const target = sendTo();
      if (target) {
        queueMicrotask(() => target._injectMessage(message));
      }
    },

    subscribe(callback: (message: unknown) => void): () => void {
      subscribers.add(callback);
      return () => subscribers.delete(callback);
    },

    dispose() {
      disposed = true;
      subscribers.clear();
    },

    _injectMessage(message: unknown) {
      if (disposed) return;
      for (const cb of subscribers) {
        cb(message);
      }
    },
  };
}

/**
 * Create a pair of mock providers connected to each other.
 *
 * - `hostProvider`: simulates the host side (isCorrectEnvironment = true).
 *   Messages posted here are delivered to productProvider's subscribers.
 * - `productProvider`: simulates the product side (isCorrectEnvironment = false).
 *   Messages posted here are delivered to hostProvider's subscribers.
 */
export function createMockProviderPair(): [MockProvider, MockProvider] {
  let hostProvider: MockProvider;
  let productProvider: MockProvider;

  // Host provider: correct environment = true (it IS the host)
  hostProvider = createMockProvider('host', true, () => productProvider);

  // Product provider: correct environment = true as well.
  // Both sides must report isCorrectEnvironment() = true for their
  // respective transports to function (send/receive messages).
  // The host transport auto-wires the handshake handler only when
  // isCorrectEnvironment is true, so we distinguish host from product
  // by which provider auto-wires the handler (the host one).
  productProvider = createMockProvider('product', true, () => hostProvider);

  return [hostProvider, productProvider];
}

/**
 * Create a synchronous mock provider pair where messages are delivered
 * immediately (no microtask delay). Useful for simpler unit tests.
 */
export function createSyncMockProviderPair(): [MockProvider, MockProvider] {
  let hostProvider: MockProvider;
  let productProvider: MockProvider;

  function createSyncProvider(name: string, isCorrectEnv: boolean, sendTo: () => MockProvider | null): MockProvider {
    const logger: Logger = createDefaultLogger(name);
    const subscribers = new Set<(message: unknown) => void>();
    let disposed = false;

    return {
      logger,

      isCorrectEnvironment() {
        return isCorrectEnv;
      },

      postMessage(message: unknown) {
        if (disposed) return;
        const target = sendTo();
        if (target) {
          target._injectMessage(message);
        }
      },

      subscribe(callback: (message: unknown) => void): () => void {
        subscribers.add(callback);
        return () => subscribers.delete(callback);
      },

      dispose() {
        disposed = true;
        subscribers.clear();
      },

      _injectMessage(message: unknown) {
        if (disposed) return;
        for (const cb of subscribers) {
          cb(message);
        }
      },
    };
  }

  hostProvider = createSyncProvider('host', true, () => productProvider);
  productProvider = createSyncProvider('product', true, () => hostProvider);

  return [hostProvider, productProvider];
}
