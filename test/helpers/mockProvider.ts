/**
 * Mock provider pair for testing the transport layer.
 *
 * Creates two providers connected to each other: when one posts a message,
 * the other's subscribers receive it -- like two sides of postMessage.
 */

import type { Provider } from '@polkadot/api-protocol';

export type MockProvider = Provider & {
  /** Manually inject a message as if it was received from the other side. */
  _injectMessage(message: unknown): void;
};

function createMockProvider(sendTo: () => MockProvider | undefined): MockProvider {
  const subscribers = new Set<(message: unknown) => void>();
  let disposed = false;

  return {
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
 * - `hostProvider`: messages posted here are delivered to productProvider's subscribers.
 * - `productProvider`: messages posted here are delivered to hostProvider's subscribers.
 */
export function createMockProviderPair(): [MockProvider, MockProvider] {
  let hostProvider: MockProvider;
  let productProvider: MockProvider;

  hostProvider = createMockProvider(() => productProvider);
  productProvider = createMockProvider(() => hostProvider);

  return [hostProvider, productProvider];
}

/**
 * Create a synchronous mock provider pair where messages are delivered
 * immediately (no microtask delay). Useful for simpler unit tests.
 */
export function createSyncMockProviderPair(): [MockProvider, MockProvider] {
  let hostProvider: MockProvider;
  let productProvider: MockProvider;

  function createSyncProvider(sendTo: () => MockProvider | undefined): MockProvider {
    const subscribers = new Set<(message: unknown) => void>();
    let disposed = false;

    return {
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

  hostProvider = createSyncProvider(() => productProvider);
  productProvider = createSyncProvider(() => hostProvider);

  return [hostProvider, productProvider];
}
