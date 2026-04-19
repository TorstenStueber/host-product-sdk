# Building a Host with `@polkadot/host`

This guide explains how to build a Polkadot host application using the `@polkadot/host` package. A host embeds
third-party product dApps inside iframes and provides them with accounts, signing, chain data, and storage through a
postMessage-based protocol.

## Quick Start

The simplest host needs three things: an app ID, an iframe, and a URL to load.

```typescript
import { createHostSdk } from '@polkadot/host';

const sdk = createHostSdk({ appId: 'my-host' });

const iframe = document.getElementById('product-frame') as HTMLIFrameElement;
const product = sdk.embed(iframe, 'https://dapp.example.com');

// Later, tear down:
product.dispose();
sdk.dispose();
```

This creates a host that can serve basic requests (localStorage, navigation, feature checks) but has no authentication,
signing, or chain connectivity. Products embedded this way will see the user as disconnected.

## Full Setup with SSO Pairing

To enable authentication via the Polkadot mobile wallet (QR-code pairing), chain connections, signing, and identity
resolution:

```typescript
import { createHostSdk, PEOPLE_PARACHAIN_ENDPOINTS } from '@polkadot/host';

const sdk = createHostSdk({
  appId: 'my-host',

  // SSO: connect to the People/statement-store parachain
  statementStoreEndpoints: [...PEOPLE_PARACHAIN_ENDPOINTS],
  pairingMetadata: 'https://my-host.com/metadata.json',

  // Chain: provide JSON-RPC providers for Substrate chains
  chainProvider: genesisHash => {
    // Return a JsonRpcProvider for supported chains, or undefined
    return getSmoldotProvider(genesisHash); // your smoldot setup
  },

  // Signing: show a confirmation modal before remote signing
  onSignApproval: async payload => {
    return await showConfirmationModal(payload); // returns true/false
  },

  // UI callbacks
  onNavigateTo: url => window.open(url, '_blank'),
  onPushNotification: ({ text }) => showToast(text),
});
```

When `statementStoreEndpoints` is provided, the SDK automatically:

- Creates a single WebSocket connection to the People parachain
- Sets up the SSO manager for QR-code pairing
- Persists sessions and secrets to localStorage (survives page reloads)
- Auto-restores persisted sessions on creation
- Wires remote signing through the encrypted statement-store channel
- Resolves identity from `Resources.Consumers` on the People parachain
- Registers statement store handlers for product-facing operations
- Runs attestation (lite person registration) during pairing

## Configuration Reference

### `HostSdkConfig`

| Option                                     | Type                                                            | Default        | Description                                                                  |
| ------------------------------------------ | --------------------------------------------------------------- | -------------- | ---------------------------------------------------------------------------- |
| `appId`                                    | `string`                                                        | _required_     | Application identifier. Used for storage scoping and auth.                   |
| `storagePrefix`                            | `string`                                                        | `${appId}:`    | Prefix for localStorage keys.                                                |
| `statementStoreEndpoints`                  | `string[]`                                                      | -              | WebSocket URLs for the People parachain. Enables SSO, signing, identity.     |
| `statementStoreHeartbeatTimeout`           | `number`                                                        | `120000`       | WebSocket heartbeat timeout in ms.                                           |
| `pairingMetadata`                          | `string`                                                        | `''`           | URL to host metadata JSON shown during QR pairing.                           |
| `chainProvider`                            | `(genesisHash) => JsonRpcProvider \| undefined`                 | -              | Factory for chain connections. Called when a product requests chain data.    |
| `onSignPayload`                            | `(session, payload) => SigningResult \| Promise<SigningResult>` | remote signing | Override: handle payload signing yourself.                                   |
| `onSignRaw`                                | `(session, payload) => SigningResult \| Promise<SigningResult>` | remote signing | Override: handle raw signing yourself.                                       |
| `onSignApproval`                           | `(payload) => boolean \| Promise<boolean>`                      | auto-approve   | Gate for remote signing. Show a modal, return true/false.                    |
| `onCreateTransaction`                      | callback                                                        | -              | Handle transaction creation.                                                 |
| `onCreateTransactionWithNonProductAccount` | callback                                                        | -              | Handle transaction creation for non-product accounts.                        |
| `onFeatureSupported`                       | `(feature) => boolean`                                          | chain check    | Custom feature support. Default checks `chainProvider` for `Chain` features. |
| `onDevicePermission`                       | `(permission) => boolean \| Promise<boolean>`                   | `false`        | Device permission handler.                                                   |
| `onPermission`                             | `(request) => boolean \| Promise<boolean>`                      | `false`        | Remote permission handler.                                                   |
| `onNavigateTo`                             | `(url) => void`                                                 | `window.open`  | Navigation handler.                                                          |
| `onPushNotification`                       | `(notification) => void`                                        | `console.warn` | Push notification handler.                                                   |

## `HostSdk` API

### `sdk.embed(iframe, url): EmbeddedProduct`

Embeds a product dApp in an iframe. Sets `iframe.src = url`, creates a postMessage bridge, and wires all protocol
handlers. Returns an `EmbeddedProduct` with a `dispose()` method.

```typescript
const product = sdk.embed(iframe, 'https://dapp.example.com');

// Access the raw protocol handler if needed:
product.container; // HostFacade

// Tear down:
product.dispose();
```

### `sdk.pair()`

Start QR-code-based pairing with the Polkadot mobile wallet. Requires `statementStoreEndpoints` to be configured. No-op
if already paired or pairing in progress.

The pairing flow:

1. Generates a fresh mnemonic and derives sr25519 + P-256 keys
2. Builds a QR payload and transitions to `pairing` state (with the QR string)
3. Waits for the mobile wallet to scan and respond
4. Performs P-256 ECDH to establish an encrypted session
5. Runs attestation in parallel (registers the user on the People parachain)
6. Persists session metadata and secrets
7. Transitions to `authenticated` state

Subscribe to `sdk.auth` to track progress:

```typescript
sdk.auth.subscribe(state => {
  switch (state.status) {
    case 'idle':
      hideModal();
      break;
    case 'pairing':
      showQrCode(state.payload); // state.payload is the QR deeplink
      break;
    case 'authenticated':
      hideModal();
      showUser(state.session, state.identity);
      break;
    case 'error':
      showError(state.message);
      break;
  }
});

sdk.pair();
```

### `sdk.cancelPairing()`

Cancel an in-progress pairing. Transitions to `idle`. No-op if not pairing.

### `sdk.clearSession()`

Disconnect the current session. Clears persisted session metadata and secrets. Transitions to `idle`.

### `sdk.setSession(session, identity?)`

Manually set the authenticated session. Use this if you manage auth externally (e.g., your own auth provider).

```typescript
sdk.setSession(
  { rootPublicKey: publicKeyBytes, displayName: 'Alice' },
  { liteUsername: 'alice', fullUsername: 'Alice Smith' },
);
```

### `sdk.auth: AuthManager`

The auth state manager. Provides:

- `sdk.auth.getState(): AuthState` -- current state snapshot
- `sdk.auth.subscribe(callback): () => void` -- subscribe to state changes
- `sdk.auth.getSession(): UserSession | undefined` -- get the current session (if authenticated)

Auth states: `idle`, `pairing` (with `payload`), `attesting` (with optional `username`), `authenticated` (with `session`
and `identity`), `error` (with `message`).

### `sdk.dispose()`

Tear down the SDK and all embedded products. Closes the WebSocket connection, stops the SSO manager, and cleans up all
resources.

## Signing

### Remote Signing (default)

When `statementStoreEndpoints` is configured and no `onSignPayload`/`onSignRaw` callbacks are provided, the SDK
automatically routes sign requests through the encrypted statement-store channel to the paired mobile wallet:

1. Product requests signing (via the host-product protocol)
2. SDK calls `onSignApproval(payload)` if configured -- return `true` to proceed, `false` to reject
3. SDK encrypts the request with the AES session key
4. Publishes to the statement-store topic
5. Mobile wallet receives, user confirms on phone, wallet signs
6. Response is decrypted and returned to the product

The 90-second timeout protects against dropped connections.

### Custom Signing

If you want to handle signing yourself (e.g., using a local keystore):

```typescript
const sdk = createHostSdk({
  appId: 'my-host',
  onSignPayload: async (session, payload) => {
    const signature = await myKeystore.sign(payload);
    return { signature: `0x${signature}`, signedTransaction: undefined };
  },
  onSignRaw: async (session, payload) => {
    const signature = await myKeystore.signRaw(payload.data);
    return { signature: `0x${signature}`, signedTransaction: undefined };
  },
});
```

When `onSignPayload`/`onSignRaw` are set, the SDK does NOT use remote signing. You are fully responsible for producing
the signature.

## Chain Connections

Products request chain data via the protocol. The SDK delegates to your `chainProvider`:

```typescript
import { getSmProvider } from 'polkadot-api/sm-provider';
import { startFromWorker } from 'polkadot-api/smoldot/from-worker';
import SmWorker from 'polkadot-api/smoldot/worker?worker';

const smoldot = startFromWorker(new SmWorker());
const chains = new Map<string, JsonRpcProvider>();

const sdk = createHostSdk({
  appId: 'my-host',
  chainProvider: genesisHash => {
    if (chains.has(genesisHash)) return chains.get(genesisHash);
    const chain = smoldot.addChain({ chainSpec: getSpecFor(genesisHash) });
    const provider = getSmProvider(chain);
    chains.set(genesisHash, provider);
    return provider;
  },
});
```

The SDK also auto-checks `chainProvider` for `Chain`-type feature support queries: if `chainProvider(genesisHash)`
returns a provider, the feature is supported.

## Nested dApps

If a product embeds another dApp via iframe (dApp-in-dApp), all nested dApps send their postMessage to `window.top`. The
SDK's `embed()` does NOT automatically detect nested dApps. Use `setupNestedBridgeDetector` for this:

```typescript
import { setupNestedBridgeDetector } from '@polkadot/host';

const product = sdk.embed(iframe, url);

const disposeNested = setupNestedBridgeDetector({
  primaryIframe: iframe,
  label: 'my-dapp',
  createConfig: nestedId => ({
    appId: 'my-host',
    storagePrefix: `my-host:nested-${nestedId}:`,
    // ... same handlers as the primary bridge
  }),
});

// Cleanup:
disposeNested();
product.dispose();
```

## Electron / Webview Support

For Electron webview tags, acquire a MessagePort and pass it to the SDK:

```typescript
import { acquireWebviewPort, createHostFacade, wireAllHandlers } from '@polkadot/host';

const port = await acquireWebviewPort({ webview: myWebviewElement });
const container = createHostFacade({
  messaging: { type: 'messagePort', port },
});
const cleanup = wireAllHandlers(container, handlersConfig);
```

## Low-Level API

If you need more control than `createHostSdk` provides, you can compose the components yourself:

### Manual Handler Wiring

```typescript
import { createHostFacade, wireAllHandlers } from '@polkadot/host';
import type { HandlersConfig } from '@polkadot/host';

const container = createHostFacade({
  messaging: { type: 'window', target: iframe.contentWindow! },
});

const config: HandlersConfig = {
  appId: 'my-host',
  storagePrefix: 'my-host:',
  getSession: () => ({ rootPublicKey: myPublicKey }),
  subscribeAuthState: callback => {
    callback('authenticated');
    return () => {};
  },
  chainProvider: myChainProvider,
  onSignPayload: mySignHandler,
  // ... more handlers
};

const cleanup = wireAllHandlers(container, config);

// Cleanup:
cleanup();
container.dispose();
```

### Manual SSO Setup

```typescript
import {
  createStatementStoreClient,
  createSsoManager,
  createSsoSessionStore,
  createSecretStore,
  createPairingExecutor,
  createLocalStorageAdapter,
  PEOPLE_PARACHAIN_ENDPOINTS,
} from '@polkadot/host';

// 1. Chain client (single WebSocket for everything)
const chain = createStatementStoreClient(PEOPLE_PARACHAIN_ENDPOINTS);

// 2. Persistence
const storage = createLocalStorageAdapter('my-host:sso:');
const sessionStore = createSsoSessionStore(storage);
const secretStore = createSecretStore(storage);

// 3. SSO manager
const sso = createSsoManager({
  statementStore: chain.statementStore,
  sessionStore,
  secretStore,
  pairingExecutor: createPairingExecutor({
    metadata: 'https://my-host.com/metadata.json',
    getUnsafeApi: () => chain.getUnsafeApi(),
  }),
});

// 4. Subscribe to state changes
sso.subscribe((state) => {
  console.log('SSO state:', state.status);
});

// 5. Restore persisted session or start pairing
await sso.restoreSession();
if (sso.getState().status === 'idle') {
  sso.pair();
}

// 6. Build remote signer from secrets
const secrets = await sso.getSecrets();
if (secrets) {
  const signer = createRemoteSigner({
    manager: sso,
    statementStore: chain.statementStore,
    executor: createSignRequestExecutor({
      sessionKey: ...,
      signer: ...,
      remoteAccountId: ...,
      localAccountId: ...,
      sessionId: ...,
    }),
  });
}

// Cleanup:
sso.dispose();
chain.dispose();
```

### Identity Resolution

```typescript
import { createIdentityResolver, createChainIdentityProvider } from '@polkadot/host';

// Using the chain client from above:
const identityProvider = createChainIdentityProvider(() => chain.getUnsafeApi());
const resolver = createIdentityResolver(identityProvider);

const identity = await resolver.getIdentity('0xaabbcc...');
// { liteUsername: 'alice', fullUsername: 'Alice Smith', ... }

// Cache control:
resolver.invalidate('0xaabbcc...');
resolver.invalidateAll();
```

### Statement Store (Direct Access)

```typescript
import { createStatementStoreClient, PEOPLE_PARACHAIN_ENDPOINTS } from '@polkadot/host';

const chain = createStatementStoreClient(PEOPLE_PARACHAIN_ENDPOINTS);

// Subscribe to statements on a topic
const unsub = chain.statementStore.subscribe(
  [myTopic], // array of 32-byte Uint8Array topics
  statements => {
    for (const stmt of statements) {
      console.log('Received:', stmt.data);
    }
  },
);

// Submit a signed statement
await chain.statementStore.submit({
  topics: [myTopic],
  data: myEncryptedPayload,
  proof: { tag: 'sr25519', value: { signer: myPublicKey, signature: mySignature } },
});

// Query existing statements
const existing = await chain.statementStore.query([myTopic]);
```

## Storage Adapters

The SDK uses `ReactiveStorageAdapter` for session persistence. Two implementations are provided:

```typescript
import { createMemoryStorageAdapter, createLocalStorageAdapter } from '@polkadot/host';

// In-memory (for testing):
const memory = createMemoryStorageAdapter();

// Browser localStorage (for production):
const local = createLocalStorageAdapter('my-prefix:');

// Both support reactive subscriptions:
const unsub = local.subscribe('myKey', value => {
  console.log('Changed:', value); // Uint8Array | undefined
});
```

## Metadata JSON

The `pairingMetadata` URL should serve a JSON file with this structure:

```json
{
  "name": "My Host App",
  "icon": "https://my-host.com/icon-256x256.png"
}
```

The icon should be a rasterized image (PNG/JPEG) with a minimum size of 256x256 pixels. This is displayed on the mobile
wallet during the QR pairing flow.

## Protocol Compatibility

This package implements the same SCALE-encoded wire protocol as `triangle-js-sdks` (`@novasamatech/*` packages).
Products built against either implementation can communicate with hosts built against either — the protocol is
byte-identical.

The SSO pairing protocol (QR handshake, statement-store messaging, remote signing) is wire-compatible with
`@novasamatech/host-papp`. A mobile wallet that works with triangle-js-sdks hosts also works with `@polkadot/host`.

## Dependencies

Runtime dependencies:

| Package                            | Purpose                                                         |
| ---------------------------------- | --------------------------------------------------------------- |
| `@noble/ciphers`                   | AES-GCM encryption                                              |
| `@noble/hashes`                    | HKDF-SHA256, blake2b                                            |
| `@noble/curves`                    | P-256 ECDH (pairing handshake)                                  |
| `@scure/sr25519`                   | Sr25519 signing                                                 |
| `@polkadot-labs/hdkd-helpers`      | BIP-39 mnemonics, HDKD key derivation                           |
| `@polkadot-api/substrate-bindings` | AccountId SS58 codec                                            |
| `@novasamatech/sdk-statement`      | Statement-store parachain RPC                                   |
| `polkadot-api`                     | Chain client                                                    |
| `@polkadot-api/ws-provider`        | WebSocket transport                                             |
| `verifiablejs`                     | Bandersnatch ring-VRF (5.8 MB WASM, lazy-loaded during pairing) |
| `neverthrow`                       | Result types                                                    |
| `scale-ts`                         | SCALE codec                                                     |
