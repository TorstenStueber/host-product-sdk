/**
 * E2E product harness.
 *
 * Runs inside the iframe. Creates a product-side transport and sends
 * protocol requests to the host. Exposes results on window.__e2e.
 *
 * Reads `?codec=scale|structured_clone|upgrade` from the URL:
 * - `structured_clone`: use structured clone codec throughout
 * - `scale`: use SCALE codec throughout
 * - `upgrade`: start with SCALE, upgrade to structured clone after handshake
 */
import type { Provider, Transport, Subscription } from '@polkadot/host-api';
import {
  createTransport,
  structuredCloneCodecAdapter,
  scaleCodecAdapter,
  requestCodecUpgrade,
} from '@polkadot/host-api';

type ProductE2E = {
  ready: boolean;
  transport: Transport | undefined;
  results: Record<string, unknown>;
  errors: Record<string, unknown>;
  connectionStatuses: string[];
  run: (testName: string) => Promise<unknown>;
};

const codecParam = new URLSearchParams(location.search).get('codec') ?? 'structured_clone';

// -- Create product-side provider (iframe -> parent) -------------------------

function createProductProvider(): Provider {
  const subscribers = new Set<(message: Uint8Array | unknown) => void>();

  function isProtocolMessage(data: unknown): boolean {
    return (
      typeof data === 'object' &&
      data !== null &&
      'requestId' in (data as Record<string, unknown>) &&
      'payload' in (data as Record<string, unknown>)
    );
  }

  const handler = (event: MessageEvent) => {
    if (event.source === window) return;
    if (event.data == null) return;
    if (
      !(event.data instanceof Uint8Array) &&
      !(typeof event.data === 'object' && event.data.constructor?.name === 'Uint8Array') &&
      !isProtocolMessage(event.data)
    ) {
      return;
    }
    for (const sub of subscribers) {
      sub(event.data);
    }
  };

  window.addEventListener('message', handler);

  return {
    postMessage(message) {
      if (message instanceof Uint8Array) {
        window.top!.postMessage(message, '*', [message.buffer]);
      } else {
        window.top!.postMessage(message, '*');
      }
    },
    subscribe(callback) {
      subscribers.add(callback);
      return () => subscribers.delete(callback);
    },
    dispose() {
      subscribers.clear();
      window.removeEventListener('message', handler);
    },
  };
}

// -- Setup -------------------------------------------------------------------

const provider = createProductProvider();
const transport = createTransport({
  provider,
  handshake: 'initiate',
});

const e2e: ProductE2E = {
  ready: false,
  transport,
  results: {},
  errors: {},
  connectionStatuses: [],
  run: () => Promise.resolve(undefined),
};
(window as unknown as Record<string, unknown>).__e2e = e2e;

// -- Test runners (called by Playwright) -------------------------------------

async function waitReady(): Promise<void> {
  await transport.whenReady();
  if (codecParam === 'upgrade') {
    await requestCodecUpgrade(transport, {
      scale: scaleCodecAdapter,
      structured_clone: structuredCloneCodecAdapter,
    });
  }
}

async function testFeatureSupported(genesisHash: `0x${string}`): Promise<unknown> {
  const result = await transport.request('host_feature_supported', {
    tag: 'v1',
    value: { tag: 'Chain', value: genesisHash },
  });
  return result;
}

async function testAccountGet(): Promise<unknown> {
  const result = await transport.request('host_account_get', { tag: 'v1', value: ['testProduct', 0] });
  return result;
}

async function testGetNonProductAccounts(): Promise<unknown> {
  const result = await transport.request('host_get_non_product_accounts', { tag: 'v1', value: undefined });
  return result;
}

async function testSignPayload(): Promise<unknown> {
  const result = await transport.request('host_sign_payload', {
    tag: 'v1',
    value: {
      address: '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY',
      blockHash: '0x1234',
      blockNumber: '0x01',
      era: '0x00',
      genesisHash: '0xabc123',
      method: '0xcafe',
      nonce: '0x01',
      specVersion: '0x01',
      tip: '0x00',
      transactionVersion: '0x01',
      signedExtensions: [],
      version: 4,
      assetId: undefined,
      metadataHash: undefined,
      mode: undefined,
      withSignedTransaction: undefined,
    },
  });
  return result;
}

async function testSignRaw(): Promise<unknown> {
  const result = await transport.request('host_sign_raw', {
    tag: 'v1',
    value: {
      address: '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY',
      data: { tag: 'Payload', value: 'hello world' },
    },
  });
  return result;
}

async function testLocalStorage(): Promise<unknown> {
  // Write
  const writeValue = new TextEncoder().encode('test-value-123');
  await transport.request('host_local_storage_write', { tag: 'v1', value: ['myKey', writeValue] });

  // Read
  const readResult = await transport.request('host_local_storage_read', { tag: 'v1', value: 'myKey' });

  // Clear
  await transport.request('host_local_storage_clear', { tag: 'v1', value: 'myKey' });

  // Read after clear
  const readAfterClear = await transport.request('host_local_storage_read', { tag: 'v1', value: 'myKey' });

  return { readResult, readAfterClear };
}

async function testConnectionStatus(): Promise<unknown> {
  return new Promise<unknown>(resolve => {
    const statuses: unknown[] = [];
    const sub: Subscription = transport.subscribe(
      'host_account_connection_status_subscribe',
      { tag: 'v1', value: undefined },
      payload => {
        statuses.push(payload);
        if (statuses.length >= 1) {
          sub.unsubscribe();
          resolve(statuses);
        }
      },
    );

    // Timeout fallback
    setTimeout(() => resolve(statuses), 3000);
  });
}

async function testNavigateTo(): Promise<unknown> {
  const result = await transport.request('host_navigate_to', { tag: 'v1', value: 'https://polkadot.network' });
  return result;
}

async function testDevicePermission(): Promise<unknown> {
  const result = await transport.request('host_device_permission', { tag: 'v1', value: 'Camera' });
  return result;
}

// -- Error test runners -------------------------------------------------------

async function testSignPayloadRejected(): Promise<unknown> {
  const result = await transport.request('host_sign_payload', {
    tag: 'v1',
    value: {
      address: 'REJECT_ME',
      blockHash: '0x1234',
      blockNumber: '0x01',
      era: '0x00',
      genesisHash: '0xabc123',
      method: '0xcafe',
      nonce: '0x01',
      specVersion: '0x01',
      tip: '0x00',
      transactionVersion: '0x01',
      signedExtensions: [],
      version: 4,
      assetId: undefined,
      metadataHash: undefined,
      mode: undefined,
      withSignedTransaction: undefined,
    },
  });
  return result;
}

async function testCreateTransactionError(): Promise<unknown> {
  const result = await transport.request('host_create_transaction', {
    tag: 'v1',
    value: [
      ['testApp', 0],
      {
        tag: 'v1',
        value: {
          signer: undefined,
          callData: '0xcafe',
          extensions: [],
          txExtVersion: 0,
          context: {
            metadata: '0x00',
            tokenSymbol: 'DOT',
            tokenDecimals: 10,
            bestBlockHeight: 100,
          },
        },
      },
    ],
  });
  return result;
}

async function testAccountGetAliasError(): Promise<unknown> {
  const result = await transport.request('host_account_get_alias', { tag: 'v1', value: ['testApp', 0] });
  return result;
}

async function testNavigateToBlocked(): Promise<unknown> {
  const result = await transport.request('host_navigate_to', { tag: 'v1', value: 'blocked://denied' });
  return result;
}

async function testStorageWriteFull(): Promise<unknown> {
  const result = await transport.request('host_local_storage_write', {
    tag: 'v1',
    value: ['__FULL__', new TextEncoder().encode('data')],
  });
  return result;
}

// -- Dispatcher (Playwright calls window.__e2e.run('testName')) ---------------

e2e.run = async (testName: string): Promise<unknown> => {
  try {
    switch (testName) {
      case 'waitReady':
        return await waitReady();
      case 'featureSupported_abc123':
        return await testFeatureSupported('0xabc123');
      case 'featureSupported_unknown':
        return await testFeatureSupported('0xdeadbeef');
      case 'accountGet':
        return await testAccountGet();
      case 'getNonProductAccounts':
        return await testGetNonProductAccounts();
      case 'signPayload':
        return await testSignPayload();
      case 'signRaw':
        return await testSignRaw();
      case 'localStorage':
        return await testLocalStorage();
      case 'connectionStatus':
        return await testConnectionStatus();
      case 'navigateTo':
        return await testNavigateTo();
      case 'devicePermission':
        return await testDevicePermission();
      case 'signPayloadRejected':
        return await testSignPayloadRejected();
      case 'createTransactionError':
        return await testCreateTransactionError();
      case 'accountGetAliasError':
        return await testAccountGetAliasError();
      case 'navigateToBlocked':
        return await testNavigateToBlocked();
      case 'storageWriteFull':
        return await testStorageWriteFull();
      default:
        return { error: `Unknown test: ${testName}` };
    }
  } catch (err) {
    e2e.errors[testName] = String(err);
    return { error: String(err) };
  }
};

e2e.ready = true;
document.getElementById('status')!.textContent = 'product-ready';
