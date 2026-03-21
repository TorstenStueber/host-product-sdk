/**
 * E2E host harness.
 *
 * Creates a ProtocolHandler from the iframe, wires handlers, and exposes
 * results on window.__e2e for Playwright to inspect.
 *
 * Reads `?codec=scale|structured_clone|upgrade` from the URL:
 * - `structured_clone`: use structured clone codec throughout
 * - `scale`: use SCALE codec throughout
 * - `upgrade`: start with SCALE, allow upgrade to structured clone
 */
import { createProtocolHandler } from '@polkadot/host';
import type { ProtocolHandler } from '@polkadot/host';
import {
  structuredCloneCodecAdapter,
  scaleCodecAdapter,
  createWindowProvider,
  okAsync,
  errAsync,
} from '@polkadot/host-api';
import type { CodecAdapterMap } from '@polkadot/host-api';

declare global {
  interface Window {
    __e2e: {
      ready: boolean;
      container: ProtocolHandler | null;
      signPayloadCalls: unknown[];
      signRawCalls: unknown[];
      storageBacking: Record<string, string>;
      connectionStatuses: string[];
    };
  }
}

const codecParam = new URLSearchParams(location.search).get('codec') ?? 'structured_clone';

// For the 'upgrade' and 'structured_clone' tests, register codec support
// so the product can negotiate an upgrade from SCALE to structured clone.
const supportedCodecs: CodecAdapterMap | undefined =
  codecParam === 'upgrade' || codecParam === 'structured_clone'
    ? { scale: scaleCodecAdapter, structured_clone: structuredCloneCodecAdapter }
    : undefined;

const e2e: Window['__e2e'] = {
  ready: false,
  container: null,
  signPayloadCalls: [],
  signRawCalls: [],
  storageBacking: {},
  connectionStatuses: [],
};
window.__e2e = e2e;

const iframe = document.getElementById('product-frame') as HTMLIFrameElement;
iframe.src = `/product.html?codec=${codecParam}`;
const provider = createWindowProvider(() => iframe.contentWindow);
const container = createProtocolHandler({ provider, supportedCodecs });
e2e.container = container;

// --- Feature supported ---
container.handleFeatureSupported(_feature => {
  // Only support "Chain" feature with a specific genesis hash
  const f = _feature as { tag: string; value: unknown } | undefined;
  if (f && f.tag === 'Chain' && f.value === '0xabc123') {
    return okAsync(true);
  }
  return okAsync(false);
});

// --- Permissions (deny all) ---
container.handleDevicePermission(_req => okAsync(false));
container.handlePermission(_req => okAsync(false));

// --- Navigation ---
container.handleNavigateTo(url => {
  if (url === 'blocked://denied') {
    return errAsync({ tag: 'PermissionDenied' as const, value: undefined });
  }
  // Don't actually open, just record
  (window as unknown as Record<string, unknown>).__lastNavUrl = url;
  return okAsync(undefined);
});

// --- Push notification ---
container.handlePushNotification(_notif => {
  return okAsync(undefined);
});

// --- Local storage (in-memory scoped) ---
const storagePrefix = 'e2e:';
const storageData: Record<string, Uint8Array> = {};

container.handleLocalStorageRead(key => {
  const fullKey = storagePrefix + (key as string);
  const val = storageData[fullKey];
  return okAsync(val ?? undefined);
});

container.handleLocalStorageWrite(params => {
  const [key, value] = params as [string, Uint8Array];
  if (key === '__FULL__') {
    return errAsync({ tag: 'Full' as const, value: undefined });
  }
  const fullKey = storagePrefix + key;
  storageData[fullKey] = value;
  e2e.storageBacking[fullKey] = btoa(String.fromCharCode(...value));
  return okAsync(undefined);
});

container.handleLocalStorageClear(key => {
  const fullKey = storagePrefix + (key as string);
  delete storageData[fullKey];
  delete e2e.storageBacking[fullKey];
  return okAsync(undefined);
});

// --- Accounts ---
container.handleAccountGet(params => {
  // Return a mock account with a deterministic public key
  const pk = new Uint8Array(32);
  pk[0] = 0x42;
  return okAsync({ publicKey: pk, name: 'TestAccount' });
});

container.handleGetNonProductAccounts(_params => {
  const pk = new Uint8Array(32);
  pk[0] = 0xaa;
  return okAsync([{ publicKey: pk, name: 'RootAccount' }]);
});

container.handleAccountConnectionStatusSubscribe((_params, send, _interrupt) => {
  // Send initial 'connected' status
  send('connected');
  e2e.connectionStatuses.push('connected');
  return () => {};
});

container.handleAccountGetAlias(_params => {
  return errAsync({ tag: 'Unknown' as const, value: { reason: 'Not supported' } });
});

container.handleAccountCreateProof(_params => {
  return errAsync({ tag: 'Unknown' as const, value: { reason: 'Not supported' } });
});

// --- Signing ---
container.handleSignPayload(params => {
  const p = params as { address?: string };
  if (p.address === 'REJECT_ME') {
    return errAsync({ tag: 'Rejected' as const, value: undefined });
  }
  e2e.signPayloadCalls.push(params);
  return okAsync({
    signature: '0x' + 'ab'.repeat(64),
    signedTransaction: undefined,
  });
});

container.handleSignRaw(params => {
  e2e.signRawCalls.push(params);
  return okAsync({
    signature: '0x' + 'cd'.repeat(64),
    signedTransaction: undefined,
  });
});

container.handleCreateTransaction(_params => {
  return errAsync({ tag: 'NotSupported' as const, value: 'Not implemented in E2E' });
});

container.handleCreateTransactionWithNonProductAccount(_params => {
  return errAsync({ tag: 'NotSupported' as const, value: 'Not implemented in E2E' });
});

// --- Chat (no-op) ---
container.handleChatCreateRoom(_p => errAsync({ tag: 'PermissionDenied' as const, value: undefined }));
container.handleChatRegisterBot(_p => errAsync({ tag: 'PermissionDenied' as const, value: undefined }));
container.handleChatPostMessage(_p => errAsync({ tag: 'Unknown' as const, value: { reason: 'disabled' } }));
container.handleChatListSubscribe((_p, _s, interrupt) => {
  interrupt();
  return () => {};
});
container.handleChatActionSubscribe((_p, _s, interrupt) => {
  interrupt();
  return () => {};
});
// Note: product_chat_custom_message_render_subscribe is host-initiated
// (via container.renderChatCustomMessage), so no handler registration needed.

// --- Statement store (no-op) ---
container.handleStatementStoreCreateProof(_p => errAsync({ tag: 'Unknown' as const, value: { reason: 'disabled' } }));
container.handleStatementStoreSubmit(_p => errAsync({ reason: 'disabled' })); // GenericErr — plain object
container.handleStatementStoreSubscribe((_p, _s, interrupt) => {
  interrupt();
  return () => {};
});

// --- Preimage (no-op) ---
container.handlePreimageSubmit(_p => errAsync({ tag: 'Unknown' as const, value: { reason: 'disabled' } }));
container.handlePreimageLookupSubscribe((_p, _s, interrupt) => {
  interrupt();
  return () => {};
});

// --- Chain (minimal stub) ---
container.handleChainHeadFollow((_p, _s, interrupt) => {
  interrupt();
  return () => {};
});
container.handleChainHeadHeader(_p => okAsync(undefined));
container.handleChainHeadBody(_p => okAsync({ tag: 'LimitReached' as const, value: undefined }));
container.handleChainHeadStorage(_p => okAsync({ tag: 'LimitReached' as const, value: undefined }));
container.handleChainHeadCall(_p => okAsync({ tag: 'LimitReached' as const, value: undefined }));
container.handleChainHeadUnpin(_p => okAsync(undefined));
container.handleChainHeadContinue(_p => okAsync(undefined));
container.handleChainHeadStopOperation(_p => okAsync(undefined));
container.handleChainSpecGenesisHash(_p => okAsync('0xabc123'));
container.handleChainSpecChainName(_p => okAsync('TestChain'));
container.handleChainSpecProperties(_p => okAsync('{"tokenSymbol":"DOT"}'));
container.handleChainTransactionBroadcast(_p => okAsync(undefined));
container.handleChainTransactionStop(_p => okAsync(undefined));

e2e.ready = true;
document.getElementById('status')!.textContent = 'host-ready';
