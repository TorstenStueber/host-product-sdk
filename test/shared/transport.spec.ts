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
  scaleCodecAdapter,
  MethodNotSupportedError,
} from '@polkadot/host-api';
import type { Transport, CodecAdapter, ProtocolMessage } from '@polkadot/host-api';
import { createMockProviderPair, createSyncMockProviderPair } from '../helpers/mockProvider.js';
import type { MockProvider } from '../helpers/mockProvider.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Flush microtask queue (for async provider delivery). */
function flush(): Promise<void> {
  return new Promise(r => setTimeout(r, 0));
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
    try {
      hostTransport?.destroy();
    } catch {
      /* already destroyed */
    }
    try {
      productTransport?.destroy();
    } catch {
      /* already destroyed */
    }
  });

  // -----------------------------------------------------------------------
  // createTransport shape
  // -----------------------------------------------------------------------

  describe('createTransport', () => {
    it('returns a Transport object with all expected methods', () => {
      const transport = createTransport({
        provider: hostProvider,
        handshake: 'respond',
      });

      expect(transport).toBeDefined();
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

      transport.destroy();
    });
  });

  // -----------------------------------------------------------------------
  // Handshake flow
  // -----------------------------------------------------------------------

  describe('handshake', () => {
    it('product receives handshake response from host and becomes connected', async () => {
      hostTransport = createTransport({
        provider: hostProvider,
        handshake: 'respond',
      });

      productTransport = createTransport({
        provider: productProvider,
        handshake: 'initiate',
      });

      // The host transport auto-wires handshake handler in createTransport
      // The host transport uses handshake: 'respond' to auto-wire the handler.
      const ready = await productTransport.isReady();
      expect(ready).toBe(true);
    });

    it('connection status changes to connected after successful handshake', async () => {
      hostTransport = createTransport({
        provider: hostProvider,
        handshake: 'respond',
      });

      productTransport = createTransport({
        provider: productProvider,
        handshake: 'initiate',
      });

      const statuses: string[] = [];
      productTransport.onConnectionStatusChange(status => {
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
        handshake: 'respond',
      });

      productTransport = createTransport({
        provider: productProvider,
        handshake: 'initiate',
      });
    });

    it('send request with ID, response with same ID resolves promise', async () => {
      // Host handles "host_feature_supported" requests
      hostTransport.handleRequest('host_feature_supported', async msg => {
        // Unwrap and respond with a valid versioned response
        return { tag: 'v1', value: { success: true, value: true } };
      });

      // Wait for handshake
      await productTransport.isReady();

      const result = await productTransport.request('host_feature_supported', {
        tag: 'v1',
        value: { tag: 'Chain', value: '0xabc123' },
      });
      expect(result).toEqual({ tag: 'v1', value: { success: true, value: true } });
    });

    it('multiple concurrent requests resolve independently', async () => {
      hostTransport.handleRequest('host_feature_supported', async msg => {
        // Add a small delay to keep the concurrency test meaningful
        await new Promise(r => setTimeout(r, 5));
        // Differentiate responses based on the genesis hash in the payload
        const inner = msg as { tag: string; value: { tag: string; value: string } };
        const isFirst = inner.value.value === '0xaaa111';
        return {
          tag: 'v1',
          value: { success: true, value: isFirst },
        };
      });

      await productTransport.isReady();

      const [r1, r2] = await Promise.all([
        productTransport.request('host_feature_supported', {
          tag: 'v1',
          value: { tag: 'Chain', value: '0xaaa111' },
        }),
        productTransport.request('host_feature_supported', {
          tag: 'v1',
          value: { tag: 'Chain', value: '0xbbb222' },
        }),
      ]);

      // Both resolve independently — first request gets true, second gets false
      expect((r1 as { tag: string; value: { success: boolean; value: boolean } }).value.value).toBe(true);
      expect((r2 as { tag: string; value: { success: boolean; value: boolean } }).value.value).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Subscription lifecycle
  // -----------------------------------------------------------------------

  describe('subscriptions', () => {
    beforeEach(() => {
      hostTransport = createTransport({
        provider: hostProvider,
        handshake: 'respond',
      });

      productTransport = createTransport({
        provider: productProvider,
        handshake: 'initiate',
      });
    });

    it('start subscription, receive multiple values, then stop', async () => {
      const received: unknown[] = [];

      // Host handles subscription: sends 3 values then interrupts
      hostTransport.handleSubscription('host_account_connection_status_subscribe', (_params, send, interrupt) => {
        let count = 0;
        const interval = setInterval(() => {
          count++;
          send({ tag: 'v1', value: 'connected' });
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

      await new Promise<void>(resolve => {
        const sub = productTransport.subscribe(
          'host_account_connection_status_subscribe',
          { tag: 'v1', value: undefined },
          value => {
            received.push(value);
          },
        );

        sub.onInterrupt(() => {
          resolve();
        });
      });

      expect(received).toHaveLength(3);
      expect(received[0]).toEqual({ tag: 'v1', value: 'connected' });
      expect(received[1]).toEqual({ tag: 'v1', value: 'connected' });
      expect(received[2]).toEqual({ tag: 'v1', value: 'connected' });
    });

    it('unsubscribe stops receiving values', async () => {
      const received: unknown[] = [];

      hostTransport.handleSubscription('host_account_connection_status_subscribe', (_params, send) => {
        let count = 0;
        const interval = setInterval(() => {
          count++;
          send({ tag: 'v1', value: 'connected' });
        }, 5);

        return () => {
          clearInterval(interval);
        };
      });

      await productTransport.isReady();

      const sub = productTransport.subscribe(
        'host_account_connection_status_subscribe',
        { tag: 'v1', value: undefined },
        value => {
          received.push(value);
        },
      );

      // Wait for a few ticks
      await new Promise(r => setTimeout(r, 30));
      const countBefore = received.length;
      expect(countBefore).toBeGreaterThan(0);

      sub.unsubscribe();

      // Wait more and verify no new values
      await new Promise(r => setTimeout(r, 30));
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
        handshake: 'respond',
      });

      productTransport = createTransport({
        provider: productProvider,
        handshake: 'initiate',
      });
    });

    it('two subscribers to same method+payload share one wire subscription', async () => {
      let handlerCallCount = 0;

      hostTransport.handleSubscription('host_account_connection_status_subscribe', (_params, send) => {
        handlerCallCount++;
        let count = 0;
        const interval = setInterval(() => {
          count++;
          send({ tag: 'v1', value: 'connected' });
          if (count >= 2) clearInterval(interval);
        }, 10);

        return () => clearInterval(interval);
      });

      await productTransport.isReady();

      const received1: unknown[] = [];
      const received2: unknown[] = [];

      const sub1 = productTransport.subscribe(
        'host_account_connection_status_subscribe',
        { tag: 'v1', value: undefined },
        v => {
          received1.push(v);
        },
      );
      const sub2 = productTransport.subscribe(
        'host_account_connection_status_subscribe',
        { tag: 'v1', value: undefined },
        v => {
          received2.push(v);
        },
      );

      await new Promise(r => setTimeout(r, 50));

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
        handshake: 'respond',
      });

      const statuses: string[] = [];
      transport.onConnectionStatusChange(s => statuses.push(s));

      // Initial status should be 'disconnected' (before handshake)
      expect(statuses).toContain('disconnected');

      transport.destroy();
    });

    it('status transitions through connecting -> connected on handshake', async () => {
      hostTransport = createTransport({
        provider: hostProvider,
        handshake: 'respond',
      });

      productTransport = createTransport({
        provider: productProvider,
        handshake: 'initiate',
      });

      const statuses: string[] = [];
      productTransport.onConnectionStatusChange(s => statuses.push(s));

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
        handshake: 'respond',
      });

      const destroyed = vi.fn();
      transport.onDestroy(destroyed);
      transport.destroy();

      expect(destroyed).toHaveBeenCalledTimes(1);
    });

    it('sets connection status to disconnected', () => {
      hostTransport = createTransport({
        provider: hostProvider,
        handshake: 'respond',
      });

      const statuses: string[] = [];
      hostTransport.onConnectionStatusChange(s => statuses.push(s));

      hostTransport.destroy();

      expect(statuses[statuses.length - 1]).toBe('disconnected');
    });

    it('throws on use after destroy', () => {
      const transport = createTransport({
        provider: hostProvider,
        handshake: 'respond',
      });
      transport.destroy();

      expect(() => transport.isReady()).toThrow('disposed');
    });
  });

  // -----------------------------------------------------------------------
  // Codec adapter swap
  // -----------------------------------------------------------------------

  describe('swapCodecAdapter', () => {
    it('after swapping to structuredCloneCodecAdapter, outgoing messages are plain objects instead of Uint8Array', () => {
      const [hp, pp] = createSyncMockProviderPair();

      const transport = createTransport({
        provider: hp,
        handshake: 'respond',
      });

      const messages: unknown[] = [];
      pp.subscribe(msg => messages.push(msg));

      // Before swap: transport starts with SCALE codec, so messages are Uint8Array
      transport.postMessage('id1', {
        tag: 'host_feature_supported_request',
        value: { tag: 'v1', value: { tag: 'Chain', value: '0xabc123' } },
      });
      expect(messages.length).toBe(1);
      expect(messages[0]).toBeInstanceOf(Uint8Array);

      // Swap to structured clone
      transport.swapCodecAdapter(structuredCloneCodecAdapter);
      transport.postMessage('id2', {
        tag: 'host_feature_supported_request',
        value: { tag: 'v1', value: { tag: 'Chain', value: '0xdef456' } },
      });

      expect(messages.length).toBe(2);
      // After swap: messages are plain objects, not Uint8Array
      expect(messages[1]).not.toBeInstanceOf(Uint8Array);
      expect((messages[1] as Record<string, unknown>).requestId).toBe('id2');

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
        handshake: 'respond',
      });

      const received: unknown[] = [];
      transport.listenMessages('host_feature_supported_request', (requestId, data) => {
        received.push({ requestId, data });
      });

      // Inject messages from the product side using structured clone format
      // (the transport auto-detects plain objects with requestId)
      pp.postMessage({
        requestId: 'r1',
        payload: {
          tag: 'host_feature_supported_request',
          value: { tag: 'v1', value: { tag: 'Chain', value: '0xaaa' } },
        },
      });
      pp.postMessage({
        requestId: 'r2',
        payload: {
          tag: 'host_feature_supported_response',
          value: { tag: 'v1', value: { success: true, value: true } },
        },
      });
      pp.postMessage({
        requestId: 'r3',
        payload: {
          tag: 'host_feature_supported_request',
          value: { tag: 'v1', value: { tag: 'Chain', value: '0xbbb' } },
        },
      });

      await flush();

      // Only host_feature_supported_request messages should be received
      expect(received).toHaveLength(2);
      expect((received[0] as { requestId: string }).requestId).toBe('r1');
      expect((received[1] as { requestId: string }).requestId).toBe('r3');

      transport.destroy();
    });
  });

  // -----------------------------------------------------------------------
  // Not-supported catch-all
  // -----------------------------------------------------------------------

  describe('not-supported catch-all', () => {
    beforeEach(() => {
      hostTransport = createTransport({
        provider: hostProvider,
        handshake: 'respond',
      });

      productTransport = createTransport({
        provider: productProvider,
        handshake: 'initiate',
      });
    });

    it('request to method with no handler rejects with MethodNotSupportedError', async () => {
      await productTransport.isReady();

      // Swap both sides to structured clone so the NOT_SUPPORTED_MARKER
      // can be encoded (SCALE cannot encode arbitrary marker objects).
      hostTransport.swapCodecAdapter(structuredCloneCodecAdapter);
      productTransport.swapCodecAdapter(structuredCloneCodecAdapter);

      await expect(
        productTransport.request('host_push_notification', {
          tag: 'v1',
          value: { text: 'hello', deeplink: undefined },
        }),
      ).rejects.toThrow(MethodNotSupportedError);
    });

    it('subscription to method with no handler gets interrupted', async () => {
      await productTransport.isReady();

      const interrupted = await new Promise<boolean>(resolve => {
        const sub = productTransport.subscribe(
          'host_account_connection_status_subscribe',
          { tag: 'v1', value: undefined },
          () => {},
        );

        sub.onInterrupt(() => {
          resolve(true);
        });

        // Safety timeout in case interrupt never fires
        setTimeout(() => resolve(false), 2000);
      });

      expect(interrupted).toBe(true);
    });

    it('deregistering a handler makes subsequent requests fail with MethodNotSupportedError', async () => {
      // Register a handler, then immediately unsubscribe it
      const unsubscribe = hostTransport.handleRequest('host_feature_supported', async () => {
        return { tag: 'v1', value: { success: true, value: true } };
      });

      unsubscribe();

      await productTransport.isReady();

      // Swap both sides to structured clone so the NOT_SUPPORTED_MARKER
      // can be encoded (SCALE cannot encode arbitrary marker objects).
      hostTransport.swapCodecAdapter(structuredCloneCodecAdapter);
      productTransport.swapCodecAdapter(structuredCloneCodecAdapter);

      await expect(
        productTransport.request('host_feature_supported', {
          tag: 'v1',
          value: { tag: 'Chain', value: '0xabc123' },
        }),
      ).rejects.toThrow(MethodNotSupportedError);
    });

    it('not-supported does not fire for methods that have handlers', async () => {
      hostTransport.handleRequest('host_feature_supported', async () => {
        return { tag: 'v1', value: { success: true, value: true } };
      });

      await productTransport.isReady();

      const result = await productTransport.request('host_feature_supported', {
        tag: 'v1',
        value: { tag: 'Chain', value: '0xabc123' },
      });

      expect(result).toEqual({ tag: 'v1', value: { success: true, value: true } });
    });
  });

  // -----------------------------------------------------------------------
  // Auto-detect codec
  // -----------------------------------------------------------------------

  describe('auto-detect codec', () => {
    it('Uint8Array messages are decoded with SCALE', async () => {
      const [hp, pp] = createMockProviderPair();

      hostTransport = createTransport({
        provider: hp,
        handshake: 'respond',
      });

      const received: unknown[] = [];
      hostTransport.listenMessages('host_feature_supported_request', (requestId, data) => {
        received.push({ requestId, data });
      });

      // Encode a message with SCALE and inject the resulting Uint8Array
      const encoded = scaleCodecAdapter.encode({
        requestId: 'r1',
        payload: {
          tag: 'host_feature_supported_request',
          value: { tag: 'v1', value: { tag: 'Chain', value: '0xabc123' } },
        },
      });

      expect(encoded).toBeInstanceOf(Uint8Array);

      // Inject the Uint8Array into the product provider so the host receives it
      pp.postMessage(encoded);

      await flush();

      expect(received).toHaveLength(1);
      expect((received[0] as { requestId: string }).requestId).toBe('r1');
    });

    it('plain object messages are decoded as structured clone', async () => {
      const [hp, pp] = createMockProviderPair();

      hostTransport = createTransport({
        provider: hp,
        handshake: 'respond',
      });

      const received: unknown[] = [];
      hostTransport.listenMessages('host_feature_supported_request', (requestId, data) => {
        received.push({ requestId, data });
      });

      // Inject a plain object (structured clone format)
      pp.postMessage({
        requestId: 'r2',
        payload: {
          tag: 'host_feature_supported_request',
          value: { tag: 'v1', value: { tag: 'Chain', value: '0xdef456' } },
        },
      });

      await flush();

      expect(received).toHaveLength(1);
      expect((received[0] as { requestId: string }).requestId).toBe('r2');
    });

    it('receiving a structured clone message auto-upgrades outgoing codec', () => {
      const [hp, pp] = createSyncMockProviderPair();

      hostTransport = createTransport({
        provider: hp,
        handshake: 'respond',
      });

      const outgoing: unknown[] = [];
      pp.subscribe(msg => outgoing.push(msg));

      // Initially, outgoing messages are SCALE-encoded (Uint8Array)
      hostTransport.postMessage('id1', {
        tag: 'host_feature_supported_request',
        value: { tag: 'v1', value: { tag: 'Chain', value: '0xabc' } },
      });
      expect(outgoing.length).toBe(1);
      expect(outgoing[0]).toBeInstanceOf(Uint8Array);

      // Inject a structured clone message from the product side.
      // Use a _response action so the not-supported catch-all ignores it
      // (catch-all only fires for _request and _start).
      pp.postMessage({
        requestId: 'sc1',
        payload: {
          tag: 'host_feature_supported_response',
          value: { tag: 'v1', value: { success: true, value: true } },
        },
      });

      // After receiving structured clone, outgoing should now be plain objects
      hostTransport.postMessage('id2', {
        tag: 'host_feature_supported_response',
        value: { tag: 'v1', value: { success: true, value: true } },
      });
      expect(outgoing.length).toBe(2);
      expect(outgoing[1]).not.toBeInstanceOf(Uint8Array);
      expect((outgoing[1] as Record<string, unknown>).requestId).toBe('id2');
    });
  });
});
