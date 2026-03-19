/**
 * Transport unit tests.
 *
 * Exercises the core transport layer: handshake, request/response correlation,
 * subscription lifecycle, multiplexing, connection status events, and cleanup.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createTransport,
  structuredCloneCodecAdapter,
} from '@polkadot/shared';
import type { Transport, CodecAdapter, ProtocolMessage } from '@polkadot/shared';
import { createMockProviderPair, createSyncMockProviderPair } from '../helpers/mockProvider.js';
import type { MockProvider } from '../helpers/mockProvider.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createCodec(): CodecAdapter {
  return structuredCloneCodecAdapter;
}

/** Flush microtask queue (for async provider delivery). */
function flush(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Transport', () => {
  let hostProvider: MockProvider;
  let productProvider: MockProvider;
  let hostTransport: Transport;
  let productTransport: Transport;

  beforeEach(() => {
    [hostProvider, productProvider] = createMockProviderPair();
  });

  afterEach(() => {
    try { hostTransport?.destroy(); } catch { /* already destroyed */ }
    try { productTransport?.destroy(); } catch { /* already destroyed */ }
  });

  // -----------------------------------------------------------------------
  // createTransport shape
  // -----------------------------------------------------------------------

  describe('createTransport', () => {
    it('returns a Transport object with all expected methods', () => {
      const transport = createTransport({
        provider: hostProvider,
        codecAdapter: createCodec(),
      });

      expect(transport).toBeDefined();
      expect(typeof transport.isCorrectEnvironment).toBe('function');
      expect(typeof transport.isReady).toBe('function');
      expect(typeof transport.destroy).toBe('function');
      expect(typeof transport.onConnectionStatusChange).toBe('function');
      expect(typeof transport.onDestroy).toBe('function');
      expect(typeof transport.swapCodecAdapter).toBe('function');
      expect(typeof transport.request).toBe('function');
      expect(typeof transport.handleRequest).toBe('function');
      expect(typeof transport.subscribe).toBe('function');
      expect(typeof transport.handleSubscription).toBe('function');
      expect(typeof transport.postMessage).toBe('function');
      expect(typeof transport.listenMessages).toBe('function');
      expect(transport.provider).toBe(hostProvider);

      transport.destroy();
    });

    it('isCorrectEnvironment delegates to provider', () => {
      const transport = createTransport({
        provider: hostProvider,
        codecAdapter: createCodec(),
      });
      expect(transport.isCorrectEnvironment()).toBe(true);

      // Both mock providers return true (both sides are in their
      // "correct" environment for sending/receiving).
      const transport2 = createTransport({
        provider: productProvider,
        codecAdapter: createCodec(),
      });
      expect(transport2.isCorrectEnvironment()).toBe(true);

      transport.destroy();
      transport2.destroy();
    });
  });

  // -----------------------------------------------------------------------
  // Handshake flow
  // -----------------------------------------------------------------------

  describe('handshake', () => {
    it('product receives handshake response from host and becomes connected', async () => {
      hostTransport = createTransport({
        provider: hostProvider,
        codecAdapter: createCodec(),
      });

      productTransport = createTransport({
        provider: productProvider,
        codecAdapter: createCodec(),
      });

      // The host transport auto-wires handshake handler in createTransport
      // when isCorrectEnvironment() returns true.
      const ready = await productTransport.isReady();
      expect(ready).toBe(true);
    });

    it('connection status changes to connected after successful handshake', async () => {
      hostTransport = createTransport({
        provider: hostProvider,
        codecAdapter: createCodec(),
      });

      productTransport = createTransport({
        provider: productProvider,
        codecAdapter: createCodec(),
      });

      const statuses: string[] = [];
      productTransport.onConnectionStatusChange((status) => {
        statuses.push(status);
      });

      await productTransport.isReady();

      expect(statuses).toContain('connected');
    });
  });

  // -----------------------------------------------------------------------
  // Request / Response correlation
  // -----------------------------------------------------------------------

  describe('request/response', () => {
    beforeEach(() => {
      hostTransport = createTransport({
        provider: hostProvider,
        codecAdapter: createCodec(),
      });

      productTransport = createTransport({
        provider: productProvider,
        codecAdapter: createCodec(),
      });
    });

    it('send request with ID, response with same ID resolves promise', async () => {
      // Host handles "test_method" requests
      hostTransport.handleRequest('test_method', async (msg) => {
        return { echo: msg };
      });

      // Wait for handshake
      await productTransport.isReady();

      const result = await productTransport.request('test_method', { hello: 'world' });
      expect(result).toEqual({ echo: { hello: 'world' } });
    });

    it('multiple concurrent requests resolve independently', async () => {
      hostTransport.handleRequest('slow_method', async (msg) => {
        const { id, delay: ms } = msg as { id: number; delay: number };
        await new Promise((r) => setTimeout(r, ms));
        return { id, done: true };
      });

      await productTransport.isReady();

      const [r1, r2] = await Promise.all([
        productTransport.request('slow_method', { id: 1, delay: 10 }),
        productTransport.request('slow_method', { id: 2, delay: 5 }),
      ]);

      expect((r1 as { id: number }).id).toBe(1);
      expect((r2 as { id: number }).id).toBe(2);
    });
  });

  // -----------------------------------------------------------------------
  // Subscription lifecycle
  // -----------------------------------------------------------------------

  describe('subscriptions', () => {
    beforeEach(() => {
      hostTransport = createTransport({
        provider: hostProvider,
        codecAdapter: createCodec(),
      });

      productTransport = createTransport({
        provider: productProvider,
        codecAdapter: createCodec(),
      });
    });

    it('start subscription, receive multiple values, then stop', async () => {
      const received: unknown[] = [];

      // Host handles subscription: sends 3 values then interrupts
      hostTransport.handleSubscription('counter', (_params, send, interrupt) => {
        let count = 0;
        const interval = setInterval(() => {
          count++;
          send({ count });
          if (count >= 3) {
            clearInterval(interval);
            interrupt();
          }
        }, 10);

        return () => {
          clearInterval(interval);
        };
      });

      await productTransport.isReady();

      await new Promise<void>((resolve) => {
        const sub = productTransport.subscribe('counter', { start: 0 }, (value) => {
          received.push(value);
        });

        sub.onInterrupt(() => {
          resolve();
        });
      });

      expect(received).toHaveLength(3);
      expect(received[0]).toEqual({ count: 1 });
      expect(received[1]).toEqual({ count: 2 });
      expect(received[2]).toEqual({ count: 3 });
    });

    it('unsubscribe stops receiving values', async () => {
      const received: unknown[] = [];

      hostTransport.handleSubscription('ticker', (_params, send) => {
        let count = 0;
        const interval = setInterval(() => {
          count++;
          send({ tick: count });
        }, 5);

        return () => {
          clearInterval(interval);
        };
      });

      await productTransport.isReady();

      const sub = productTransport.subscribe('ticker', {}, (value) => {
        received.push(value);
      });

      // Wait for a few ticks
      await new Promise((r) => setTimeout(r, 30));
      const countBefore = received.length;
      expect(countBefore).toBeGreaterThan(0);

      sub.unsubscribe();

      // Wait more and verify no new values
      await new Promise((r) => setTimeout(r, 30));
      expect(received.length).toBe(countBefore);
    });
  });

  // -----------------------------------------------------------------------
  // Subscription multiplexing
  // -----------------------------------------------------------------------

  describe('subscription multiplexing', () => {
    beforeEach(() => {
      hostTransport = createTransport({
        provider: hostProvider,
        codecAdapter: createCodec(),
      });

      productTransport = createTransport({
        provider: productProvider,
        codecAdapter: createCodec(),
      });
    });

    it('two subscribers to same method+payload share one wire subscription', async () => {
      let handlerCallCount = 0;

      hostTransport.handleSubscription('shared_sub', (_params, send) => {
        handlerCallCount++;
        let count = 0;
        const interval = setInterval(() => {
          count++;
          send({ n: count });
          if (count >= 2) clearInterval(interval);
        }, 10);

        return () => clearInterval(interval);
      });

      await productTransport.isReady();

      const received1: unknown[] = [];
      const received2: unknown[] = [];

      const sub1 = productTransport.subscribe('shared_sub', { key: 'same' }, (v) => {
        received1.push(v);
      });
      const sub2 = productTransport.subscribe('shared_sub', { key: 'same' }, (v) => {
        received2.push(v);
      });

      await new Promise((r) => setTimeout(r, 50));

      // Both should have received the same events
      expect(received1.length).toBeGreaterThan(0);
      expect(received2.length).toBeGreaterThan(0);
      expect(received1).toEqual(received2);

      // Only one handler invocation (multiplexed)
      expect(handlerCallCount).toBe(1);

      sub1.unsubscribe();
      sub2.unsubscribe();
    });
  });

  // -----------------------------------------------------------------------
  // Connection status change events
  // -----------------------------------------------------------------------

  describe('connection status events', () => {
    it('onConnectionStatusChange fires with current status immediately', () => {
      const transport = createTransport({
        provider: hostProvider,
        codecAdapter: createCodec(),
      });

      const statuses: string[] = [];
      transport.onConnectionStatusChange((s) => statuses.push(s));

      // Initial status should be 'disconnected' (before handshake)
      expect(statuses).toContain('disconnected');

      transport.destroy();
    });

    it('status transitions through connecting -> connected on handshake', async () => {
      hostTransport = createTransport({
        provider: hostProvider,
        codecAdapter: createCodec(),
      });

      productTransport = createTransport({
        provider: productProvider,
        codecAdapter: createCodec(),
      });

      const statuses: string[] = [];
      productTransport.onConnectionStatusChange((s) => statuses.push(s));

      await productTransport.isReady();

      expect(statuses).toContain('connecting');
      expect(statuses).toContain('connected');
    });
  });

  // -----------------------------------------------------------------------
  // Destroy cleanup
  // -----------------------------------------------------------------------

  describe('destroy', () => {
    it('fires onDestroy callback', () => {
      const transport = createTransport({
        provider: hostProvider,
        codecAdapter: createCodec(),
      });

      const destroyed = vi.fn();
      transport.onDestroy(destroyed);
      transport.destroy();

      expect(destroyed).toHaveBeenCalledTimes(1);
    });

    it('sets connection status to disconnected', () => {
      hostTransport = createTransport({
        provider: hostProvider,
        codecAdapter: createCodec(),
      });

      const statuses: string[] = [];
      hostTransport.onConnectionStatusChange((s) => statuses.push(s));

      hostTransport.destroy();

      expect(statuses[statuses.length - 1]).toBe('disconnected');
    });

    it('throws on use after destroy', () => {
      const transport = createTransport({
        provider: hostProvider,
        codecAdapter: createCodec(),
      });
      transport.destroy();

      expect(() => transport.isReady()).toThrow('disposed');
    });
  });

  // -----------------------------------------------------------------------
  // Codec adapter swap
  // -----------------------------------------------------------------------

  describe('swapCodecAdapter', () => {
    it('changes encoding behavior after swap', () => {
      const [hp, pp] = createSyncMockProviderPair();

      const codec1 = createCodec();
      const transport = createTransport({
        provider: hp,
        codecAdapter: codec1,
      });

      const messages: unknown[] = [];
      pp.subscribe((msg) => messages.push(msg));

      transport.postMessage('id1', { tag: 'test', value: 'original' });
      expect(messages.length).toBe(1);

      // Swap to a custom codec that wraps messages
      const customCodec: CodecAdapter = {
        encode(message: ProtocolMessage) {
          return { ...message, _wrapped: true } as unknown as ProtocolMessage;
        },
        decode(data) {
          return data as ProtocolMessage;
        },
      };

      transport.swapCodecAdapter(customCodec);
      transport.postMessage('id2', { tag: 'test', value: 'swapped' });

      expect(messages.length).toBe(2);
      expect((messages[1] as Record<string, unknown>)._wrapped).toBe(true);

      transport.destroy();
    });
  });

  // -----------------------------------------------------------------------
  // Low-level postMessage / listenMessages
  // -----------------------------------------------------------------------

  describe('postMessage / listenMessages', () => {
    it('listenMessages filters by action tag', async () => {
      const [hp, pp] = createMockProviderPair();

      const transport = createTransport({
        provider: hp,
        codecAdapter: createCodec(),
      });

      const received: unknown[] = [];
      transport.listenMessages('target_action', (requestId, data) => {
        received.push({ requestId, data });
      });

      // Inject messages from the product side
      const codec = createCodec();
      pp.postMessage(codec.encode({
        requestId: 'r1',
        payload: { tag: 'target_action', value: 'hit' },
      }));
      pp.postMessage(codec.encode({
        requestId: 'r2',
        payload: { tag: 'other_action', value: 'miss' },
      }));
      pp.postMessage(codec.encode({
        requestId: 'r3',
        payload: { tag: 'target_action', value: 'hit2' },
      }));

      await flush();

      // Only target_action messages should be received
      expect(received).toHaveLength(2);
      expect((received[0] as { requestId: string }).requestId).toBe('r1');
      expect((received[1] as { requestId: string }).requestId).toBe('r3');

      transport.destroy();
    });
  });
});
