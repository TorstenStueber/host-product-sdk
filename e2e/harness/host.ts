/**
 * E2E host harness.
 *
 * Creates a Container from the iframe, wires handlers, and exposes
 * results on window.__e2e for Playwright to inspect.
 *
 * Reads `?codec=scale|structured_clone|upgrade` from the URL:
 * - `structured_clone`: use structured clone codec throughout
 * - `scale`: use SCALE codec throughout
 * - `upgrade`: start with SCALE, allow upgrade to structured clone
 */
import { createContainer, createIframeProvider } from '@polkadot/host';
import type { Container } from '@polkadot/host';
import {
  structuredCloneCodecAdapter, scaleCodecAdapter,
} from '@polkadot/shared';
import type { CodecAdapter, CodecAdapterMap } from '@polkadot/shared';

declare global {
  interface Window {
    __e2e: {
      ready: boolean;
      container: Container | null;
      signPayloadCalls: unknown[];
      signRawCalls: unknown[];
      storageBacking: Record<string, string>;
      connectionStatuses: string[];
    };
  }
}

const codecParam = new URLSearchParams(location.search).get('codec') ?? 'structured_clone';

let codecAdapter: CodecAdapter;
let supportedCodecs: CodecAdapterMap | undefined;

if (codecParam === 'scale' || codecParam === 'upgrade') {
  codecAdapter = scaleCodecAdapter;
  if (codecParam === 'upgrade') {
    supportedCodecs = { scale: scaleCodecAdapter, structured_clone: structuredCloneCodecAdapter };
  }
} else {
  codecAdapter = structuredCloneCodecAdapter;
}

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
const provider = createIframeProvider({
  iframe,
  url: `/product.html?codec=${codecParam}`,
});
const container = createContainer({ provider, codecAdapter, supportedCodecs });
e2e.container = container;

// --- Feature supported ---
container.handleFeatureSupported((_feature, ctx) => {
  // Only support "Chain" feature with a specific genesis hash
  const f = _feature as { tag: string; value: unknown } | undefined;
  if (f && f.tag === 'Chain' && f.value === '0xabc123') {
    return ctx.ok(true);
  }
  return ctx.ok(false);
});

// --- Permissions (deny all) ---
container.handleDevicePermission((_req, ctx) => ctx.ok(false));
container.handlePermission((_req, ctx) => ctx.ok(false));

// --- Navigation ---
container.handleNavigateTo((url, ctx) => {
  if (url === 'blocked://denied') {
    return ctx.err({ tag: 'PermissionDenied' as const, value: undefined });
  }
  // Don't actually open, just record
  (window as unknown as Record<string, unknown>).__lastNavUrl = url;
  return ctx.ok(undefined);
});

// --- Push notification ---
container.handlePushNotification((_notif, ctx) => {
  return ctx.ok(undefined);
});

// --- Local storage (in-memory scoped) ---
const storagePrefix = 'e2e:';
const storageData: Record<string, Uint8Array> = {};

container.handleLocalStorageRead((key, ctx) => {
  const fullKey = storagePrefix + (key as string);
  const val = storageData[fullKey];
  return ctx.ok(val ?? undefined);
});

container.handleLocalStorageWrite((params, ctx) => {
  const [key, value] = params as [string, Uint8Array];
  if (key === '__FULL__') {
    return ctx.err({ tag: 'Full' as const, value: undefined });
  }
  const fullKey = storagePrefix + key;
  storageData[fullKey] = value;
  e2e.storageBacking[fullKey] = btoa(String.fromCharCode(...value));
  return ctx.ok(undefined);
});

container.handleLocalStorageClear((key, ctx) => {
  const fullKey = storagePrefix + (key as string);
  delete storageData[fullKey];
  delete e2e.storageBacking[fullKey];
  return ctx.ok(undefined);
});

// --- Accounts ---
container.handleAccountGet((params, ctx) => {
  // Return a mock account with a deterministic public key
  const pk = new Uint8Array(32);
  pk[0] = 0x42;
  return ctx.ok({ publicKey: pk, name: 'TestAccount' });
});

container.handleGetNonProductAccounts((_params, ctx) => {
  const pk = new Uint8Array(32);
  pk[0] = 0xAA;
  return ctx.ok([{ publicKey: pk, name: 'RootAccount' }]);
});

container.handleAccountConnectionStatusSubscribe((_params, send, _interrupt) => {
  // Send initial 'connected' status
  send('connected');
  e2e.connectionStatuses.push('connected');
  return () => {};
});

container.handleAccountGetAlias((_params, ctx) => {
  return ctx.err({ tag: 'Unknown' as const, value: { reason: 'Not supported' } });
});

container.handleAccountCreateProof((_params, ctx) => {
  return ctx.err({ tag: 'Unknown' as const, value: { reason: 'Not supported' } });
});

// --- Signing ---
container.handleSignPayload((params, ctx) => {
  const p = params as { address?: string };
  if (p.address === 'REJECT_ME') {
    return ctx.err({ tag: 'Rejected' as const, value: undefined });
  }
  e2e.signPayloadCalls.push(params);
  return ctx.ok({
    signature: '0x' + 'ab'.repeat(64),
    signedTransaction: undefined,
  });
});

container.handleSignRaw((params, ctx) => {
  e2e.signRawCalls.push(params);
  return ctx.ok({
    signature: '0x' + 'cd'.repeat(64),
    signedTransaction: undefined,
  });
});

container.handleCreateTransaction((_params, ctx) => {
  return ctx.err({ tag: 'NotSupported' as const, value: 'Not implemented in E2E' });
});

container.handleCreateTransactionWithNonProductAccount((_params, ctx) => {
  return ctx.err({ tag: 'NotSupported' as const, value: 'Not implemented in E2E' });
});

// --- Chat (no-op) ---
container.handleChatCreateRoom((_p, ctx) => ctx.err({ tag: 'PermissionDenied' as const, value: undefined }));
container.handleChatRegisterBot((_p, ctx) => ctx.err({ tag: 'PermissionDenied' as const, value: undefined }));
container.handleChatPostMessage((_p, ctx) => ctx.err({ tag: 'Unknown' as const, value: { reason: 'disabled' } }));
container.handleChatListSubscribe((_p, _s, interrupt) => { interrupt(); return () => {}; });
container.handleChatActionSubscribe((_p, _s, interrupt) => { interrupt(); return () => {}; });
container.handleChatCustomMessageRenderSubscribe((_p, _s, interrupt) => { interrupt(); return () => {}; });

// --- Statement store (no-op) ---
container.handleStatementStoreCreateProof((_p, ctx) => ctx.err({ tag: 'Unknown' as const, value: { reason: 'disabled' } }));
container.handleStatementStoreSubmit((_p, ctx) => ctx.err({ reason: 'disabled' }));  // GenericErr — plain object
container.handleStatementStoreSubscribe((_p, _s, interrupt) => { interrupt(); return () => {}; });

// --- Preimage (no-op) ---
container.handlePreimageSubmit((_p, ctx) => ctx.err({ tag: 'Unknown' as const, value: { reason: 'disabled' } }));
container.handlePreimageLookupSubscribe((_p, _s, interrupt) => { interrupt(); return () => {}; });

// --- Chain (minimal stub) ---
container.handleChainHeadFollow((_p, _s, interrupt) => { interrupt(); return () => {}; });
container.handleChainHeadHeader((_p, ctx) => ctx.ok(undefined));
container.handleChainHeadBody((_p, ctx) => ctx.ok({ tag: 'LimitReached' as const, value: undefined }));
container.handleChainHeadStorage((_p, ctx) => ctx.ok({ tag: 'LimitReached' as const, value: undefined }));
container.handleChainHeadCall((_p, ctx) => ctx.ok({ tag: 'LimitReached' as const, value: undefined }));
container.handleChainHeadUnpin((_p, ctx) => ctx.ok(undefined));
container.handleChainHeadContinue((_p, ctx) => ctx.ok(undefined));
container.handleChainHeadStopOperation((_p, ctx) => ctx.ok(undefined));
container.handleChainSpecGenesisHash((_p, ctx) => ctx.ok('0xabc123'));
container.handleChainSpecChainName((_p, ctx) => ctx.ok('TestChain'));
container.handleChainSpecProperties((_p, ctx) => ctx.ok('{"tokenSymbol":"DOT"}'));
container.handleChainTransactionBroadcast((_p, ctx) => ctx.ok(undefined));
container.handleChainTransactionStop((_p, ctx) => ctx.ok(undefined));

e2e.ready = true;
document.getElementById('status')!.textContent = 'host-ready';
