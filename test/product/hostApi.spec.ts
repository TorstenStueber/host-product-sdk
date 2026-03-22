/**
 * HostApi proxy method tests.
 *
 * Verifies that the HostApi facade correctly delegates transport lifecycle
 * methods (whenReady, handleHostSubscription) to the underlying transport.
 *
 * Uses a real MessageChannel so the full provider → transport → facade
 * stack is exercised.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHostApi, createTransport, createMessagePortProvider } from '@polkadot/host-api';
import type { HostApi, Transport } from '@polkadot/host-api';

function flush(): Promise<void> {
  return new Promise(r => setTimeout(r, 0));
}

describe('HostApi transport proxies', () => {
  let channel: MessageChannel;
  let hostTransport: Transport;
  let hostApi: HostApi;

  beforeEach(() => {
    channel = new MessageChannel();
    hostTransport = createTransport({
      provider: createMessagePortProvider(channel.port2),
      handshake: 'respond',
      idPrefix: 'h:',
    });
    hostApi = createHostApi({
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

  it('whenReady resolves after handshake', async () => {
    await hostApi.whenReady();
  });

  it('handleHostSubscription registers a handler on the transport', async () => {
    await hostApi.whenReady();

    const receivedValues: unknown[] = [];

    hostApi.handleHostSubscription('product_chat_custom_message_render_subscribe', (params, send, interrupt) => {
      receivedValues.push(params);
      return () => {};
    });

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
    await hostApi.whenReady();

    const unsub = hostApi.handleHostSubscription('product_chat_custom_message_render_subscribe', () => () => {});

    expect(typeof unsub).toBe('function');
    unsub();
  });
});
