/**
 * HostApi proxy method tests.
 *
 * Verifies that the HostApi facade correctly delegates transport lifecycle
 * methods (whenReady, handleHostSubscription) to the underlying transport.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHostApi, createTransport } from '@polkadot/host-api';
import type { Transport } from '@polkadot/host-api';
import { createMockProviderPair } from '../helpers/mockProvider.js';
import type { MockProvider } from '../helpers/mockProvider.js';

function flush(): Promise<void> {
  return new Promise(r => setTimeout(r, 0));
}

describe('HostApi transport proxies', () => {
  let hostProvider: MockProvider;
  let productProvider: MockProvider;
  let hostTransport: Transport;
  let productTransport: Transport;

  beforeEach(() => {
    [hostProvider, productProvider] = createMockProviderPair();
    hostTransport = createTransport({ provider: hostProvider, handshake: 'respond', idPrefix: 'h:' });
    productTransport = createTransport({ provider: productProvider, handshake: 'initiate', idPrefix: 'p:' });
  });

  afterEach(() => {
    try {
      hostTransport?.destroy();
    } catch {
      /* */
    }
    try {
      productTransport?.destroy();
    } catch {
      /* */
    }
  });

  it('whenReady delegates to transport and resolves after handshake', async () => {
    const hostApi = createHostApi(productTransport);
    await hostApi.whenReady();
  });

  it('handleHostSubscription registers a handler on the transport', async () => {
    const hostApi = createHostApi(productTransport);
    await hostApi.whenReady();

    const receivedValues: unknown[] = [];

    // Register a handler for a subscription method on the product side.
    // The host will initiate this subscription.
    hostApi.handleHostSubscription('product_chat_custom_message_render_subscribe', (params, send, interrupt) => {
      receivedValues.push(params);
      return () => {};
    });

    // Host subscribes to the product's handler
    hostTransport.subscribe(
      'product_chat_custom_message_render_subscribe',
      {
        tag: 'v1',
        value: { messageId: 'msg1', messageType: 'custom', payload: new Uint8Array([1]) },
      },
      () => {},
    );

    await flush();
    await flush();

    expect(receivedValues).toHaveLength(1);
    expect((receivedValues[0] as { tag: string }).tag).toBe('v1');
  });

  it('handleHostSubscription returns an unsubscribe function', async () => {
    const hostApi = createHostApi(productTransport);
    await hostApi.whenReady();

    const unsub = hostApi.handleHostSubscription('product_chat_custom_message_render_subscribe', () => () => {});

    expect(typeof unsub).toBe('function');
    unsub(); // Should not throw
  });
});
