/**
 * Product chat tests.
 *
 * Tests handleCustomMessageRendering as a standalone function, verifying
 * that it registers a handler on the transport and dispatches rendering
 * requests to the callback.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTransport } from '@polkadot/host-api';
import type { Transport } from '@polkadot/host-api';
import { createHostApi } from '@polkadot/host-api';
import { handleCustomMessageRendering } from '@polkadot/product';
import { createMockProviderPair } from '../helpers/mockProvider.js';
import type { MockProvider } from '../helpers/mockProvider.js';

function flush(): Promise<void> {
  return new Promise(r => setTimeout(r, 0));
}

describe('handleCustomMessageRendering', () => {
  let hostProvider: MockProvider;
  let productProvider: MockProvider;
  let hostTransport: Transport;
  let productTransport: Transport;

  beforeEach(() => {
    [hostProvider, productProvider] = createMockProviderPair();
    hostTransport = createTransport({ provider: hostProvider, idPrefix: 'h:' });
    productTransport = createTransport({ provider: productProvider, idPrefix: 'p:' });
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

  it('registers a handler and receives rendering requests from the host', async () => {
    const hostApi = createHostApi(productTransport);
    await hostApi.isReady();

    const rendererCalls: { messageId: string; messageType: string }[] = [];
    const cleanupFn = vi.fn();

    handleCustomMessageRendering((params, _render) => {
      rendererCalls.push({
        messageId: params.messageId,
        messageType: params.messageType,
      });
      return cleanupFn;
    }, hostApi);

    // Host initiates a custom message rendering subscription
    hostTransport.subscribe(
      'product_chat_custom_message_render_subscribe',
      {
        tag: 'v1',
        value: {
          messageId: 'msg-42',
          messageType: 'poll',
          payload: new Uint8Array([1, 2, 3]),
        },
      },
      () => {},
    );

    await flush();
    await flush();

    expect(rendererCalls).toHaveLength(1);
    expect(rendererCalls[0].messageId).toBe('msg-42');
    expect(rendererCalls[0].messageType).toBe('poll');
  });

  it('provides a render function to the callback', async () => {
    const hostApi = createHostApi(productTransport);
    await hostApi.isReady();

    let renderFn: ((node: unknown) => void) | null = null;

    handleCustomMessageRendering((_params, render) => {
      renderFn = render;
      return () => {};
    }, hostApi);

    hostTransport.subscribe(
      'product_chat_custom_message_render_subscribe',
      {
        tag: 'v1',
        value: {
          messageId: 'msg-1',
          messageType: 'greeting',
          payload: new Uint8Array([]),
        },
      },
      () => {},
    );

    await vi.waitFor(() => {
      expect(renderFn).not.toBeNull();
    });

    expect(typeof renderFn).toBe('function');
  });

  it('returns an unsubscribe function that deregisters the handler', async () => {
    const hostApi = createHostApi(productTransport);
    await hostApi.isReady();

    const unsub = handleCustomMessageRendering(() => () => {}, hostApi);

    expect(typeof unsub).toBe('function');
    unsub();

    // After deregistration, new subscriptions should get interrupted
    let interrupted = false;
    const sub = hostTransport.subscribe(
      'product_chat_custom_message_render_subscribe',
      {
        tag: 'v1',
        value: {
          messageId: 'msg-1',
          messageType: 'test',
          payload: new Uint8Array([]),
        },
      },
      () => {},
    );
    sub.onInterrupt(() => {
      interrupted = true;
    });

    await flush();
    await flush();

    expect(interrupted).toBe(true);
  });
});
