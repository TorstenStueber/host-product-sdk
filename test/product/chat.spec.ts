/**
 * Product chat tests.
 *
 * Tests handleCustomMessageRendering as a standalone function, verifying
 * that it registers a handler on the transport and dispatches rendering
 * requests to the callback.
 *
 * Uses a real MessageChannel so the full provider → transport → facade
 * stack is exercised.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTransport, createMessagePortProvider, createProductFacade } from '@polkadot/api-protocol';
import type { Transport, ProductFacade } from '@polkadot/api-protocol';
import { handleCustomMessageRendering } from '@polkadot/product';
import type { CustomRendererNode } from '@polkadot/product';

function flush(): Promise<void> {
  return new Promise(r => setTimeout(r, 0));
}

describe('handleCustomMessageRendering', () => {
  let channel: MessageChannel;
  let hostTransport: Transport;
  let facade: ProductFacade;

  beforeEach(() => {
    channel = new MessageChannel();
    hostTransport = createTransport({
      provider: createMessagePortProvider(channel.port2),
      handshake: 'respond',
      idPrefix: 'h:',
    });
    facade = createProductFacade({
      messaging: { type: 'messagePort', port: channel.port1 },
    });
  });

  afterEach(() => {
    try {
      hostTransport?.destroy();
    } catch {
      /* */
    }
  });

  it('registers a handler and receives rendering requests from the host', async () => {
    await facade.whenReady();

    const rendererCalls: { messageId: string; messageType: string }[] = [];
    const cleanupFn = vi.fn();

    handleCustomMessageRendering((params, _render) => {
      rendererCalls.push({
        messageId: params.messageId,
        messageType: params.messageType,
      });
      return cleanupFn;
    }, facade);

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
    expect(rendererCalls[0]!.messageId).toBe('msg-42');
    expect(rendererCalls[0]!.messageType).toBe('poll');
  });

  it('provides a render function to the callback', async () => {
    await facade.whenReady();

    let renderFn: ((node: CustomRendererNode) => void) | undefined;

    handleCustomMessageRendering((_params, render) => {
      renderFn = render;
      return () => {};
    }, facade);

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
      expect(typeof renderFn).toBe('function');
    });
  });

  it('returns an unsubscribe function that deregisters the handler', async () => {
    await facade.whenReady();

    const unsub = handleCustomMessageRendering(() => () => {}, facade);

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
