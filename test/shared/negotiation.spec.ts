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
  scaleCodecAdapter,
  requestCodecUpgrade,
  handleCodecUpgrade,
} from '@polkadot/host-api';
import { createMockProviderPair } from '../helpers/mockProvider.js';

function setupTransports() {
  const [hostProvider, productProvider] = createMockProviderPair();

  const hostTransport = createTransport({
    provider: hostProvider,
    handshake: 'respond',
    idPrefix: 'h:',
  });

  const productTransport = createTransport({
    provider: productProvider,
    handshake: 'initiate',
    idPrefix: 'p:',
  });

  return { hostTransport, productTransport };
}

async function connectTransports(
  hostTransport: ReturnType<typeof createTransport>,
  productTransport: ReturnType<typeof createTransport>,
) {
  const [hostReady, productReady] = await Promise.all([hostTransport.isReady(), productTransport.isReady()]);
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

    // Should return undefined (upgrade failed, staying on current).
    expect(result).toBeUndefined();

    hostTransport.destroy();
    productTransport.destroy();
  });

  it('host picks the best format from the intersection', async () => {
    const { hostTransport, productTransport } = setupTransports();

    // Host supports both (structured_clone always preferred).
    const cleanup = handleCodecUpgrade(hostTransport, {
      structured_clone: structuredCloneCodecAdapter,
      scale: scaleCodecAdapter,
    });

    await connectTransports(hostTransport, productTransport);

    // Product only supports scale.
    const result = await requestCodecUpgrade(productTransport, {
      scale: scaleCodecAdapter,
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
    hostTransport.handleRequest('host_feature_supported', async message => {
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
    const response = await productTransport.request('host_feature_supported', {
      tag: 'v1',
      value: { tag: 'Chain', value: '0xabc' },
    });

    expect(response).toEqual({ tag: 'v1', value: { success: true, value: true } });

    cleanup();
    hostTransport.destroy();
    productTransport.destroy();
  });

  it('product gets undefined immediately (not after timeout) when host has not-supported catch-all', async () => {
    const { hostTransport, productTransport } = setupTransports();

    // Do NOT register handleCodecUpgrade — the not-supported catch-all
    // should respond immediately with MethodNotSupportedError.

    await connectTransports(hostTransport, productTransport);

    // Swap to structured clone so the NOT_SUPPORTED_MARKER can be
    // encoded (SCALE cannot encode arbitrary marker objects).
    hostTransport.swapCodecAdapter(structuredCloneCodecAdapter);
    productTransport.swapCodecAdapter(structuredCloneCodecAdapter);

    const start = performance.now();

    const result = await requestCodecUpgrade(productTransport, {
      structured_clone: structuredCloneCodecAdapter,
    });

    const elapsed = performance.now() - start;

    // Should return undefined (upgrade failed).
    expect(result).toBeUndefined();

    // Should resolve near-instantly, well under the 1s UPGRADE_TIMEOUT.
    expect(elapsed).toBeLessThan(200);

    hostTransport.destroy();
    productTransport.destroy();
  });
});
