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
import type { Provider, Transport, Subscription } from '@polkadot/shared';
import {
  createTransport,
  structuredCloneCodecAdapter,
  scaleCodecAdapter,
  requestCodecUpgrade,
  createDefaultLogger,
  SigningErr, CreateTransactionErr, NavigateToErr, StorageErr,
  RequestCredentialsErr, CreateProofErr,
  ChatRoomRegistrationErr, ChatBotRegistrationErr, ChatMessagePostingErr,
  StatementProofErr,
} from '@polkadot/shared';
import type { CodecAdapter } from '@polkadot/shared';
import { createHostApi } from '@polkadot/product';

function enumValue<V extends string, T>(tag: V, value: T): { tag: V; value: T } {
  return { tag, value };
}

declare global {
  interface Window {
    __e2e: {
      ready: boolean;
      transport: Transport | null;
      results: Record<string, unknown>;
      errors: Record<string, unknown>;
      connectionStatuses: string[];
      run: (testName: string) => Promise<unknown>;
    };
  }
}

// -- Codec selection ----------------------------------------------------------

const codecParam = new URLSearchParams(location.search).get('codec') ?? 'structured_clone';
const codecAdapter: CodecAdapter = (codecParam === 'scale' || codecParam === 'upgrade')
  ? scaleCodecAdapter
  : structuredCloneCodecAdapter;

// -- Create product-side provider (iframe -> parent) -------------------------

function createProductProvider(): Provider {
  const subscribers = new Set<(message: Uint8Array | unknown) => void>();
  const logger = createDefaultLogger('Product');

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
    logger,
    isCorrectEnvironment: () => window !== window.top,
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
  codecAdapter,
});
const hostApi = createHostApi(transport);

const e2e: Window['__e2e'] = {
  ready: false,
  transport,
  results: {},
  errors: {},
  connectionStatuses: [],
  run: () => Promise.resolve(null),
};
window.__e2e = e2e;

// -- Test runners (called by Playwright) -------------------------------------

async function waitReady(): Promise<boolean> {
  const ready = await transport.isReady();
  if (ready && codecParam === 'upgrade') {
    await requestCodecUpgrade(transport, {
      scale: scaleCodecAdapter,
      structured_clone: structuredCloneCodecAdapter,
    });
  }
  return ready;
}

async function testFeatureSupported(genesisHash: string): Promise<unknown> {
  const result = await transport.request(
    'host_feature_supported',
    { tag: 'v1', value: { tag: 'Chain', value: genesisHash } },
  );
  return result;
}

async function testAccountGet(): Promise<unknown> {
  const result = await transport.request(
    'host_account_get',
    { tag: 'v1', value: ['testProduct', 0] },
  );
  return result;
}

async function testGetNonProductAccounts(): Promise<unknown> {
  const result = await transport.request(
    'host_get_non_product_accounts',
    { tag: 'v1', value: undefined },
  );
  return result;
}

async function testSignPayload(): Promise<unknown> {
  const result = await transport.request(
    'host_sign_payload',
    {
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
    },
  );
  return result;
}

async function testSignRaw(): Promise<unknown> {
  const result = await transport.request(
    'host_sign_raw',
    {
      tag: 'v1',
      value: {
        address: '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY',
        data: { tag: 'Payload', value: 'hello world' },
      },
    },
  );
  return result;
}

async function testLocalStorage(): Promise<unknown> {
  // Write
  const writeValue = new TextEncoder().encode('test-value-123');
  await transport.request(
    'host_local_storage_write',
    { tag: 'v1', value: ['myKey', writeValue] },
  );

  // Read
  const readResult = await transport.request(
    'host_local_storage_read',
    { tag: 'v1', value: 'myKey' },
  );

  // Clear
  await transport.request(
    'host_local_storage_clear',
    { tag: 'v1', value: 'myKey' },
  );

  // Read after clear
  const readAfterClear = await transport.request(
    'host_local_storage_read',
    { tag: 'v1', value: 'myKey' },
  );

  return { readResult, readAfterClear };
}

async function testConnectionStatus(): Promise<unknown> {
  return new Promise<unknown>((resolve) => {
    const statuses: unknown[] = [];
    const sub: Subscription = transport.subscribe(
      'host_account_connection_status_subscribe',
      { tag: 'v1', value: undefined },
      (payload) => {
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
  const result = await transport.request(
    'host_navigate_to',
    { tag: 'v1', value: 'https://polkadot.network' },
  );
  return result;
}

async function testDevicePermission(): Promise<unknown> {
  const result = await transport.request(
    'host_device_permission',
    { tag: 'v1', value: 'Camera' },
  );
  return result;
}

// -- Error test runners -------------------------------------------------------

async function testSignPayloadRejected(): Promise<unknown> {
  const result = await transport.request(
    'host_sign_payload',
    {
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
    },
  );
  return result;
}

async function testCreateTransactionError(): Promise<unknown> {
  const result = await transport.request(
    'host_create_transaction',
    {
      tag: 'v1',
      value: [
        ['testApp', 0],
        {
          tag: 'v1',
          value: {
            signer: null,
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
    },
  );
  return result;
}

async function testAccountGetAliasError(): Promise<unknown> {
  const result = await transport.request(
    'host_account_get_alias',
    { tag: 'v1', value: ['testApp', 0] },
  );
  return result;
}

async function testNavigateToBlocked(): Promise<unknown> {
  const result = await transport.request(
    'host_navigate_to',
    { tag: 'v1', value: 'blocked://denied' },
  );
  return result;
}

async function testStorageWriteFull(): Promise<unknown> {
  const result = await transport.request(
    'host_local_storage_write',
    { tag: 'v1', value: ['__FULL__', new TextEncoder().encode('data')] },
  );
  return result;
}

// -- Error class test runners (use hostApi for hydrated errors) ---------------

type ErrorClassInfo = {
  isError: boolean;
  name: string;
  message: string;
  instance: string;
  tag: string;
  payload: unknown;
  value: unknown;
  instanceOfChecks: Record<string, boolean>;
};

function inspectError(err: any, instanceOfChecks: Record<string, new (...args: any[]) => any>): ErrorClassInfo {
  return {
    isError: err instanceof Error,
    name: err.name,
    message: err.message,
    instance: err.instance,
    tag: err.tag,
    payload: err.payload,
    value: err.value,
    instanceOfChecks: Object.fromEntries(
      Object.entries(instanceOfChecks).map(([k, cls]) => [k, err instanceof cls]),
    ),
  };
}

async function testErrorClass_signPayloadRejected(): Promise<ErrorClassInfo | null> {
  const result = await hostApi.signPayload(enumValue('v1', {
    address: 'REJECT_ME',
    blockHash: '0x1234', blockNumber: '0x01', era: '0x00',
    genesisHash: '0xabc123', method: '0xcafe', nonce: '0x01',
    specVersion: '0x01', tip: '0x00', transactionVersion: '0x01',
    signedExtensions: [], version: 4,
    assetId: undefined, metadataHash: undefined, mode: undefined, withSignedTransaction: undefined,
  }));
  return result.match(
    () => null,
    (err) => inspectError(err.value, {
      'SigningErr.Rejected': SigningErr.Rejected,
      'SigningErr.Unknown': SigningErr.Unknown,
      Error: Error,
    }),
  );
}

async function testErrorClass_createTransaction(): Promise<ErrorClassInfo | null> {
  const result = await hostApi.createTransaction(enumValue('v1', [
    ['testApp', 0],
    { tag: 'v1' as const, value: {
      signer: null, callData: '0xcafe', extensions: [], txExtVersion: 0,
      context: { metadata: '0x00', tokenSymbol: 'DOT', tokenDecimals: 10, bestBlockHeight: 100 },
    }},
  ]));
  return result.match(
    () => null,
    (err) => inspectError(err.value, {
      'CreateTransactionErr.NotSupported': CreateTransactionErr.NotSupported,
      'CreateTransactionErr.Rejected': CreateTransactionErr.Rejected,
      Error: Error,
    }),
  );
}

async function testErrorClass_navigateToBlocked(): Promise<ErrorClassInfo | null> {
  const result = await hostApi.navigateTo(enumValue('v1', 'blocked://denied'));
  return result.match(
    () => null,
    (err) => inspectError(err.value, {
      'NavigateToErr.PermissionDenied': NavigateToErr.PermissionDenied,
      'NavigateToErr.Unknown': NavigateToErr.Unknown,
      Error: Error,
    }),
  );
}

async function testErrorClass_storageWriteFull(): Promise<ErrorClassInfo | null> {
  const result = await hostApi.localStorageWrite(enumValue('v1', ['__FULL__', new TextEncoder().encode('data')]));
  return result.match(
    () => null,
    (err) => inspectError(err.value, {
      'StorageErr.Full': StorageErr.Full,
      'StorageErr.Unknown': StorageErr.Unknown,
      Error: Error,
    }),
  );
}

async function testErrorClass_accountGetAlias(): Promise<ErrorClassInfo | null> {
  const result = await hostApi.accountGetAlias(enumValue('v1', ['testApp', 0]));
  return result.match(
    () => null,
    (err) => inspectError(err.value, {
      'RequestCredentialsErr.Unknown': RequestCredentialsErr.Unknown,
      'RequestCredentialsErr.Rejected': RequestCredentialsErr.Rejected,
      Error: Error,
    }),
  );
}

async function testErrorClass_accountCreateProof(): Promise<ErrorClassInfo | null> {
  const result = await hostApi.accountCreateProof(enumValue('v1', [
    ['testApp', 0],
    { genesisHash: '0xabc123', ringRootHash: '0xdead', hints: undefined },
    new Uint8Array(32),
  ]));
  return result.match(
    () => null,
    (err) => inspectError(err.value, {
      'CreateProofErr.Unknown': CreateProofErr.Unknown,
      'CreateProofErr.Rejected': CreateProofErr.Rejected,
      Error: Error,
    }),
  );
}

async function testErrorClass_chatCreateRoom(): Promise<ErrorClassInfo | null> {
  const result = await hostApi.chatCreateRoom(enumValue('v1', {
    roomId: 'test', name: 'Test', icon: 'http://x', description: 'test',
  }));
  return result.match(
    () => null,
    (err) => inspectError(err.value, {
      'ChatRoomRegistrationErr.PermissionDenied': ChatRoomRegistrationErr.PermissionDenied,
      Error: Error,
    }),
  );
}

async function testErrorClass_chatPostMessage(): Promise<ErrorClassInfo | null> {
  const result = await hostApi.chatPostMessage(enumValue('v1', {
    roomId: 'test', payload: { tag: 'Text' as const, value: 'hello' },
  }));
  return result.match(
    () => null,
    (err) => inspectError(err.value, {
      'ChatMessagePostingErr.Unknown': ChatMessagePostingErr.Unknown,
      Error: Error,
    }),
  );
}

async function testErrorClass_statementStoreCreateProof(): Promise<ErrorClassInfo | null> {
  const result = await hostApi.statementStoreCreateProof(enumValue('v1', [
    ['testApp', 0],
    {
      proof: undefined, decryptionKey: undefined, expiry: undefined,
      channel: undefined, topics: [], data: undefined,
    },
  ]));
  return result.match(
    () => null,
    (err) => inspectError(err.value, {
      'StatementProofErr.Unknown': StatementProofErr.Unknown,
      Error: Error,
    }),
  );
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
      // Error class tests (use hostApi for hydrated errors)
      case 'errorClass_signPayloadRejected':
        return await testErrorClass_signPayloadRejected();
      case 'errorClass_createTransaction':
        return await testErrorClass_createTransaction();
      case 'errorClass_navigateToBlocked':
        return await testErrorClass_navigateToBlocked();
      case 'errorClass_storageWriteFull':
        return await testErrorClass_storageWriteFull();
      case 'errorClass_accountGetAlias':
        return await testErrorClass_accountGetAlias();
      case 'errorClass_accountCreateProof':
        return await testErrorClass_accountCreateProof();
      case 'errorClass_chatCreateRoom':
        return await testErrorClass_chatCreateRoom();
      case 'errorClass_chatPostMessage':
        return await testErrorClass_chatPostMessage();
      case 'errorClass_statementStoreCreateProof':
        return await testErrorClass_statementStoreCreateProof();
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
