/**
 * Codec negotiation tests.
 *
 * Tests the post-handshake codec upgrade flow between host and product
 * transports using mock providers.
 */

import { describe, it, expect } from 'vitest';
import {
  createTransport,
  structuredCloneCodecAdapter,
  requestCodecUpgrade,
  handleCodecUpgrade,
  scaleCodecAdapter,
} from '@polkadot/shared';
import type { CodecAdapter, CodecAdapterMap, ProtocolMessage, PostMessageData } from '@polkadot/shared';
import { createMockProviderPair } from '../helpers/mockProvider.js';

// A test adapter that marks messages so we can detect which codec is active.
class MarkerCodecAdapter implements CodecAdapter {
  constructor(public readonly marker: string) {}

  encode(message: ProtocolMessage): PostMessageData {
    // Tag the message so we can verify the adapter was swapped.
    return { ...message, __codec: this.marker } as unknown as ProtocolMessage;
  }

  decode(data: PostMessageData): ProtocolMessage {
    return data as ProtocolMessage;
  }
}

function setupTransports() {
  const [hostProvider, productProvider] = createMockProviderPair();

  const hostTransport = createTransport({
    provider: hostProvider,
    codecAdapter: structuredCloneCodecAdapter,
    idPrefix: 'h:',
  });

  const productTransport = createTransport({
    provider: productProvider,
    codecAdapter: structuredCloneCodecAdapter,
    idPrefix: 'p:',
  });

  return { hostTransport, productTransport };
}

async function connectTransports(hostTransport: ReturnType<typeof createTransport>, productTransport: ReturnType<typeof createTransport>) {
  const [hostReady, productReady] = await Promise.all([
    hostTransport.isReady(),
    productTransport.isReady(),
  ]);
  expect(hostReady).toBe(true);
  expect(productReady).toBe(true);
}

describe('Codec negotiation', () => {
  it('product upgrades to structured_clone when host supports it', async () => {
    const { hostTransport, productTransport } = setupTransports();

    const structuredAdapter = structuredCloneCodecAdapter;

    // Host registers codec upgrade handler supporting structured_clone.
    const cleanup = handleCodecUpgrade(hostTransport, {
      structured_clone: structuredAdapter,
    });

    // Connect.
    await connectTransports(hostTransport, productTransport);

    // Product requests upgrade.
    const result = await requestCodecUpgrade(productTransport, {
      structured_clone: structuredAdapter,
    });

    expect(result).toBe('structured_clone');

    cleanup();
    hostTransport.destroy();
    productTransport.destroy();
  });

  it('product stays on current codec when host does not support upgrade', async () => {
    const { hostTransport, productTransport } = setupTransports();

    // Host does NOT register any codec upgrade handler.
    // The request will timeout.

    await connectTransports(hostTransport, productTransport);

    const result = await requestCodecUpgrade(productTransport, {
      structured_clone: structuredCloneCodecAdapter,
    });

    // Should return null (upgrade failed, staying on current).
    expect(result).toBeNull();

    hostTransport.destroy();
    productTransport.destroy();
  });

  it('host picks the best format from the intersection', async () => {
    const { hostTransport, productTransport } = setupTransports();

    const structuredAdapter = structuredCloneCodecAdapter;
    const markerAdapter = new MarkerCodecAdapter('scale');

    // Host supports both, prefers structured_clone.
    const cleanup = handleCodecUpgrade(
      hostTransport,
      { structured_clone: structuredAdapter, scale: markerAdapter },
      ['structured_clone', 'scale'],
    );

    await connectTransports(hostTransport, productTransport);

    // Product only supports scale.
    const result = await requestCodecUpgrade(productTransport, {
      scale: markerAdapter,
    });

    // Should pick scale (the only common one).
    expect(result).toBe('scale');

    cleanup();
    hostTransport.destroy();
    productTransport.destroy();
  });

  it('request/response still works after codec upgrade', async () => {
    const { hostTransport, productTransport } = setupTransports();

    const structuredAdapter = structuredCloneCodecAdapter;

    const cleanup = handleCodecUpgrade(hostTransport, {
      structured_clone: structuredAdapter,
    });

    await connectTransports(hostTransport, productTransport);

    // Register a test handler on the host side.
    hostTransport.handleRequest('host_feature_supported', async (message) => {
      return { tag: 'v1', value: { success: true, value: true } };
    });

    // Upgrade codec.
    const upgradeResult = await requestCodecUpgrade(productTransport, {
      structured_clone: structuredAdapter,
    });
    expect(upgradeResult).toBe('structured_clone');

    // Wait a tick for the host-side swap (uses queueMicrotask).
    await new Promise(resolve => setTimeout(resolve, 10));

    // Now send a request — should work with the new codec.
    const response = await productTransport.request(
      'host_feature_supported',
      { tag: 'v1', value: { tag: 'Chain', value: '0xabc' } },
    );

    expect(response).toEqual({ tag: 'v1', value: { success: true, value: true } });

    cleanup();
    hostTransport.destroy();
    productTransport.destroy();
  });
});
