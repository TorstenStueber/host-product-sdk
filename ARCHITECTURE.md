# Architecture

## What This System Does

A **host** application (like dot.li) embeds third-party **product** dApps inside iframes. The two sides communicate over `window.postMessage`. The product asks the host for accounts, signatures, storage, chain data. The host responds.

```
+------------------------------------------+
|  Host page                               |
|  createHostSdk({ ... })                  |
|    sdk.embed(iframe, url)                |
|         |  postMessage                   |
|  +------v----------------------------+   |
|  |  Product iframe                   |   |
|  |  hostApi.accountGet(...)          |   |
|  +-----------------------------------+   |
+------------------------------------------+
```

Three npm packages:

| Package | Published | Purpose |
|---|---|---|
| `@polkadot/shared` | No (workspace-only) | Protocol types, codecs, transport, utilities |
| `@polkadot/host` | Yes | Container, handlers, auth, SDK entry point |
| `@polkadot/product` | Yes | Product-side facade, accounts, chain bridge |

Runtime dependencies of shared: `scale-ts`, `nanoevents`, `neverthrow`.

---

## Part 1: `@polkadot/shared` (31 files)

Everything both sides depend on. Read bottom-up: utilities, then codec, then transport, then protocol types.

### 1.1 Utilities (`util/`)

**`util/logger.ts`** -- A `Logger` type (info/warn/error/log + `withPrefix()`) and `createDefaultLogger(prefix?)` that wraps `console`.

**`util/idFactory.ts`** -- `createIdFactory(prefix)` returns a function that generates prefixed incrementing IDs. Each factory has its own independent counter. The host uses prefix `"h:"`, the product uses `"p:"`, so IDs never collide on the shared postMessage channel.

**`util/helpers.ts`** -- Four small utilities:
- `delay(ms)` -- Promise that resolves after a timeout
- `promiseWithResolvers<T>()` -- ES2024 polyfill
- `composeAction(method, suffix)` -- builds `"host_account_get_request"` from `"host_account_get"` + `"request"`
- `extractErrorMessage(err)` -- safely gets a string from any thrown value

### 1.2 Codec Adapter (`codec/adapter.ts`)

The core abstraction that decouples encoding from transport:

```typescript
type ProtocolMessage = {
  requestId: string;
  payload: { tag: string; value: unknown };
};

interface CodecAdapter {
  encode(message: ProtocolMessage): Uint8Array | ProtocolMessage;
  decode(data: Uint8Array | ProtocolMessage): ProtocolMessage;
}
```

Every message on the wire has a `requestId` (for correlation) and a `payload` (a tagged union where `tag` identifies the action like `"host_account_get_request"`).

### 1.3 Structured Clone Codec (`codec/structured/index.ts`)

The simplest codec -- does nothing:

```typescript
export const structuredCloneCodecAdapter: CodecAdapter = {
  encode: (msg) => msg,          // pass through
  decode: (data) => data as ProtocolMessage,
};
```

`postMessage` already handles serialization via the browser's structured clone algorithm. No need to encode/decode. Works for all iframes regardless of origin.

### 1.4 SCALE Codec Primitives (`codec/scale/primitives.ts`)

Thin wrappers over `scale-ts` for Polkadot-specific needs. Previously provided by the external `@novasamatech/scale` package -- inlined to remove the dependency (~170 lines):

| Function | What it does |
|---|---|
| `Enum(inner)` | Re-exported from scale-ts. Tagged union codec |
| `Hex(length?)` | SCALE codec for `0x`-prefixed hex strings |
| `Nullable(inner)` | Like `Option` but uses `null` instead of `undefined` |
| `Status(...labels)` | Enum without values -- maps string labels to u8 indices |
| `lazy(fn)` | Deferred codec for recursive types |
| `OptionBool` | Optimized `Option(bool)` encoding (0=none, 1=false, 2=true) |

Error enums (e.g. `SigningErr`, `StorageErr`) use plain `Enum` -- the SCALE bytes are identical to the original `@novasamatech/scale` `ErrEnum`, but decoding produces plain `{tag, value}` discriminated unions instead of `CodecError` class instances. This is simpler and works naturally with neverthrow's `Result` pattern (see 1.12 Error Representation).

Also exports `HexString` type (`` `0x${string}` ``) and `toHexString()` validator.

### 1.5 SCALE V1 Codecs (`codec/scale/v1/`)

17 files defining the wire format for every protocol message. These are exact ports from the old `@novasamatech/host-api`. Each file defines SCALE codecs and exports `CodecType<>`-derived TypeScript types.

**`commonCodecs.ts`** -- `GenesisHash = Hex()`, `GenericErr = Struct({ reason: str })`.

**`accounts.ts`** -- `AccountId = Bytes(32)`, `ProductAccountId = Tuple(str, u32)`, `Account = Struct({ publicKey, name })`, error enums (`RequestCredentialsErr`, `CreateProofErr`), `AccountConnectionStatus`, and all request/response/subscription codecs.

**`sign.ts`** -- `SigningPayload` (16 fields: address, blockHash, era, method, nonce, etc.), `SigningResult`, `RawPayload`, `SigningErr`.

**`chainInteraction.ts`** -- The largest file. All `chainHead_v1` JSON-RPC as SCALE: `ChainHeadEvent` (12-variant enum: Initialized, NewBlock, BestBlockChanged, Finalized, plus operation events), request/response pairs for header/body/storage/call/unpin/continue/stopOperation, ChainSpec methods, transaction broadcast/stop.

**`chat.ts`** -- Room/bot registration, `ChatMessageContent` (7-variant enum: Text, RichText, Actions, File, Reaction, ReactionRemoved, Custom), actions, custom rendering.

**`customRenderer.ts`** -- Recursive UI component tree matching the original wire format exactly. 9 node variants (Nil, String, Box, Column, Row, Spacer, Text, Button, TextField), each wrapped in a Component struct with `{modifiers: Vector(Modifier), props, children: Vector(Children)}`. Modifiers are a tagged enum (margin, padding, background, border, sizes, fill flags). Uses `lazy()` for recursive children.

**Other v1 files**: `localStorage.ts`, `navigation.ts`, `notification.ts`, `feature.ts`, `devicePermission.ts`, `remotePermission.ts`, `createTransaction.ts`, `statementStore.ts`, `preimage.ts`, `jsonRpc.ts`, `handshake.ts`.

### 1.6 Protocol Assembly (`codec/scale/protocol.ts`)

Imports all v1 codecs and assembles them into a flat, explicit registry with no helper functions:

```typescript
export const hostApiProtocol = {
  // Request methods have _request and _response:
  host_handshake: {
    _request: Enum({ v1: HandshakeV1_request }),
    _response: Enum({ v1: HandshakeV1_response }),
  },
  // Subscription methods have _start and _receive (_stop/_interrupt inferred as _void):
  host_account_connection_status_subscribe: {
    _start: Enum({ v1: AccountConnectionStatusV1_start }),
    _receive: Enum({ v1: AccountConnectionStatusV1_receive }),
  },
  // ...42 methods total
} as const;
```

Each codec is wrapped in `Enum({v1: ...})` matching the original `triangle-js-sdks` wire format (version discriminant byte). Versioning is per-type: when a v2 is added, it becomes `Enum({v1: codec1, v2: codec2})` -- each method versions its request/response types independently.

Each entry's exact codec types are preserved by TypeScript, so `typeof hostApiProtocol.host_handshake._request` gives the precise codec type.

**Derived method name types** -- since `hostApiProtocol` is declared `as const`, TypeScript preserves the literal key types. Mapped types split them into two union types:

- `RequestMethod` -- union of all keys with `_request`/`_response` (e.g. `'host_handshake' | 'host_account_get' | ...`)
- `SubscriptionMethod` -- union of all keys with `_start`/`_receive` (e.g. `'host_account_connection_status_subscribe' | ...`)
- `ActionString` -- union of all valid wire action strings: `` `${RequestMethod}_${'request'|'response'}` | `${SubscriptionMethod}_${'start'|'receive'|'stop'|'interrupt'}` ``

These types are used throughout the transport, container, and product API to ensure method names are checked at compile time.

**Derived per-method per-version types** -- given a method name `M` and version tag `V` (e.g. `'v1'`), the following types extract the inner codec types using `CodecType<>` and `Extract<>`:

- `RequestParams<M, V>` -- handler params type (from `_request` codec)
- `ResponseOk<M, V>` -- Ok type from the `Result` response (from `_response` codec)
- `ResponseErr<M, V>` -- Err type from the `Result` response
- `SubscriptionParams<M, V>` -- subscription start params (from `_start` codec)
- `SubscriptionPayload<M, V>` -- subscription receive payload (from `_receive` codec)
- `RequestVersions<M>`, `ResponseVersions<M>`, `StartVersions<M>`, `ReceiveVersions<M>` -- available version tags

These types are the single source of truth for handler signatures on both the host and product sides. The Container interface, `wireRequest`/`wireSubscription` helpers, and the product HostApi facade all derive their types from the protocol codecs through these utilities.

The `MessagePayload` enum is built by flattening all entries (concatenating method name + suffix into action keys like `host_handshake_request`). For subscriptions, `_stop` and `_interrupt` default to `_void` if omitted. Then:

- `Message = Struct({ requestId: str, payload: MessagePayload })` -- the top-level wire format
- `createScaleCodecAdapter(messageCodec)` -- wraps any scale-ts Codec into a CodecAdapter
- `scaleCodecAdapter` -- ready-to-use instance

### 1.7 Protocol Types (`protocol/types.ts`)

Re-exports data types (params, results, structs) derived from SCALE codecs via `CodecType<>`:

```typescript
export type { AccountType as Account } from '../codec/scale/v1/accounts.js';
export type { SigningResultType as SigningResult } from '../codec/scale/v1/sign.js';
```

Error types are plain `{tag, value}` discriminated unions (see 1.12 Error Representation).

Optional values use `undefined` (not `null`) because SCALE's `Option` codec maps absent values to `undefined`. The exception is `Nullable` (our custom primitive) which uses `null` -- used for fields like `TxPayloadV1.signer` where the original wire format requires `null` semantics.

### 1.8 Provider (`transport/provider.ts`)

The lowest abstraction -- a raw message pipe:

```typescript
type Provider = {
  readonly logger: Logger;
  isCorrectEnvironment(): boolean;
  postMessage(message: Uint8Array | unknown): void;
  subscribe(callback: (message: Uint8Array | unknown) => void): () => void;
  dispose(): void;
};
```

Knows nothing about protocol methods, IDs, or codecs. Four implementations exist across host and product.

### 1.9 Transport (`transport/transport.ts`)

**The engine of the system.** ~580 lines. Takes a Provider + CodecAdapter, returns a Transport.

**Handshake** -- `transport.isReady()` sends `host_handshake_request` every 50ms, waits up to 10s. The host side auto-registers a handler that validates the protocol version. Connection status goes `disconnected` -> `connecting` -> `connected`.

**Request/Response** -- `transport.request(method, payload)` takes a `RequestMethod`, generates a unique ID (e.g. `"p:1"`), posts `{requestId, payload: {tag: "method_request", value}}`, listens for `{tag: "method_response"}` with matching requestId, resolves the Promise. Supports `AbortSignal`.

**Handle Request** (host side) -- `transport.handleRequest(method, handler)` takes a `RequestMethod`, listens for `_request` messages, calls the handler, sends `_response` with the same requestId.

**Subscriptions** -- `transport.subscribe(method, payload, callback)` takes a `SubscriptionMethod`, sends `_start`, listens for `_receive`. `unsubscribe()` sends `_stop`. Host can `interrupt()`.

**Multiplexing** -- Two callers subscribing to the same method+payload share one wire subscription. When the last listener unsubscribes, `_stop` is sent.

**Low-level** -- `postMessage` and `listenMessages` operate on `ActionString` (the composed `method_suffix` strings). `composeAction(method, suffix)` is generic and returns `` `${M}_${S}` ``, so the types flow through correctly.

**Codec swap** -- `transport.swapCodecAdapter(newAdapter)` hot-swaps encoding mid-session.

### 1.10 Codec Negotiation (`codec/negotiation.ts`)

Post-handshake codec upgrade flow.

**Product side** -- `requestCodecUpgrade(transport, adapters)`: after handshake, sends `host_codec_upgrade` with supported formats, waits 1s for response, swaps codec if host agrees. Returns selected format or `null`.

**Host side** -- `handleCodecUpgrade(transport, adapters, preference?)`: picks best format from intersection, responds, then swaps its codec. Uses low-level `listenMessages`/`postMessage` (not `handleRequest`) so the encode-then-swap happens synchronously — the response is guaranteed to be encoded with the old codec before the swap.

**Backward compatibility**: old hosts ignore the unknown method -> product catches timeout -> stays on SCALE.

### 1.11 Main Entry Point (`index.ts`)

Single flat file re-exporting everything from leaf modules. No barrel chains.

### 1.12 Error Representation

Errors use plain `{tag, value}` discriminated unions -- the same representation that the SCALE codecs produce. This follows the pattern encouraged by `neverthrow`, where the `E` type parameter in `Result<T, E>` / `ResultAsync<T, E>` is a data type, not an Error class:

```typescript
// Host handler returns a plain error object:
ctx.err({ tag: 'Rejected', value: undefined });
ctx.err({ tag: 'Unknown', value: { reason: 'Not configured' } });

// Product consumer narrows via the tag discriminant:
result.match(
  (ok) => ok.value,
  (err) => {
    switch (err.value.tag) {
      case 'Rejected':     // err.value.value is undefined
      case 'Unknown':      // err.value.value is { reason: string }
      case 'PermissionDenied':  // err.value.value is undefined
    }
  },
);
```

TypeScript narrows `value` automatically when the `tag` is checked, giving full type safety without error classes. This approach also avoids the structured clone limitation (custom Error properties are stripped during postMessage), keeping the wire format clean for both SCALE and structured clone codecs.

This differs from triangle-js-sdks, which uses `CodecError` class instances baked into the SCALE codec via `ErrEnum`. Their approach gives `instanceof` checks and `.message` strings but couples the codec layer to a class hierarchy. Our plain objects are simpler, work naturally with neverthrow's `.match()` / `.mapErr()` / `.andThen()`, and require no flatten/hydrate layer between host and product.

---

## Part 2: `@polkadot/host` (30 files)

What runs on the host page.

### 2.1 Providers (`container/`)

**`windowProvider.ts`** -- `createWindowProvider(target)`: the shared primitive for postMessage communication. Accepts either a direct `Window` reference or a lazy getter `() => Window | null`. Validates incoming messages (accepts both Uint8Array for SCALE and protocol message objects for structured clone), manages subscribers, handles Uint8Array buffer transfer. When the getter returns null, outgoing messages are silently dropped and incoming messages that can't be validated are ignored. Used directly for nested dApps and as the underlying provider for iframes.

**`iframeProvider.ts`** -- `createIframeProvider({ iframe, url })`: thin wrapper around `createWindowProvider`. Sets `iframe.src` and passes `() => iframe.contentWindow` as a lazy window reference. No buffering or readiness checks -- before the iframe loads, `contentWindow` is null so messages are dropped; the transport's handshake retry (every 50ms for up to 10s) handles reconnection once the iframe is ready. Overrides `dispose()` to also clear `iframe.src`.

**`webviewProvider.ts`** -- `createWebviewProvider({ webview })`: for Electron `<webview>`, uses MessageChannel/MessagePort.

### 2.2 Container (`container/container.ts`)

`createContainer({ provider, codecAdapter?, supportedCodecs? })`:

1. Creates a Transport with `idPrefix: 'h:'` and `scaleCodecAdapter` by default
2. If `supportedCodecs` provided, auto-registers codec upgrade handler
3. Returns Container with ~40 `handle*()` methods

The internal helpers `wireRequest(method, handlers, defaultError)` and `wireSubscription(method, handlers)` take a **version handler map** -- an object keyed by version tag, each value a handler for that version:

```typescript
wireRequest('host_account_get', { v1: handler }, defaultError);
wireSubscription('host_account_connection_status_subscribe', { v1: handler });
```

A single transport handler is registered per method. When a message arrives, its version tag is inspected and dispatched to the matching handler. If no handler matches the version, requests get a v1 error response (`defaultError`) and subscriptions get interrupted. The same version tag governs both incoming and outgoing types -- `v1` requests produce `v1` responses, `v2` requests produce `v2` responses.

Internal helpers:
- `unwrap(message, version)` extracts the inner value from `{tag: version, value: data}`
- `wrapOk(version, value)` / `wrapErr(version, error)` wrap into `{tag: version, value: {success: true/false, value}}`
- `wrap(version, value)` wraps subscription payloads without Result envelope

The handler's params, ok, and err types are derived from the protocol codecs via `RequestParams<M, V>`, `ResponseOk<M, V>`, `ResponseErr<M, V>`. TypeScript enforces that handler implementations match the SCALE codec shapes.

**Adding a new version** -- when a method needs a v2, three changes are needed:

1. **`codec/scale/v1/` (or new `v2/`)** -- define the new v2 codec (e.g. `AccountGetV2_request`, `AccountGetV2_response`).
2. **`codec/scale/protocol.ts`** -- extend the method's enum: `_request: Enum({ v1: AccountGetV1_request, v2: AccountGetV2_request })`. The `RequestVersions<M>` type automatically becomes `'v1' | 'v2'`, and `RequestParams<M, 'v2'>` derives the v2 types.
3. **`container.ts`** -- add the v2 handler to the map: `wireRequest('host_account_get', { v1: handlerV1, v2: handlerV2 }, defaultError)`. TypeScript enforces that `handlerV2` matches the v2 codec types. Existing v1 clients continue to work unchanged.

For subscriptions, the same pattern applies: extend `_start`/`_receive` enums and add the version entry to the handler map.

`handleChainConnection(factory)` is special -- creates a `ChainConnectionManager` and wires all ~15 chain methods with its own inline version dispatch.

### 2.3 Container Types (`container/types.ts`)

The `Container` interface derives all handler types from the protocol codecs:

```typescript
type RequestHandler<M extends RequestMethod, V extends string = 'v1'> = (
  params: RequestParams<M, V>,
  ctx: HandlerContext,
) => HandlerResult<ResponseOk<M, V>, ResponseErr<M, V>> | Promise<...>;

interface Container {
  handleAccountGet(handler: RequestHandler<'host_account_get'>): VoidFunction;
  // ~40 more...
  dispose(): void;
}
```

Handler context provides `ctx.ok(value)` and `ctx.err(error)`. No manual type annotations -- all param/ok/err types flow from `hostApiProtocol`. Errors are plain `{tag, value}` objects: `ctx.err({ tag: 'Rejected', value: undefined })`.

### 2.4 Handlers (`handlers/`)

**`registry.ts`** -- `wireAllHandlers(container, config)`: orchestrator calling each domain wiring function. `HandlersConfig` has `getSession()`, `subscribeAuthState()`, `chainProvider()`, plus callbacks.

**`host.ts`** -- `featureSupported` (config callback or chainProvider check), `navigateTo` (callback or `window.open`), `pushNotification` (callback or `console.warn`).

**`permissions.ts`** -- `devicePermission` and `permission` return `false` by default.

**`storage.ts`** -- Scoped browser localStorage. Keys prefixed with `config.storagePrefix` (default `"${appId}:"`). Values stored as base64 strings.

**`accounts.ts`** -- `accountGet` derives product-specific public key via HDKD from session. `getNonProductAccounts` returns root account. `connectionStatusSubscribe` pushes connected/disconnected. `getAlias`/`createProof` are stubs.

**`signing.ts`** -- `signPayload`/`signRaw` delegate to config callbacks. Return `{tag: 'PermissionDenied', value: undefined}` if no session. `createTransaction` returns `{tag: 'NotSupported', value: '...'}` by default.

**`chain.ts`** -- Wires `container.handleChainConnection(config.chainProvider)`.

**`chat.ts`**, **`statementStore.ts`**, **`preimage.ts`** -- Stubs returning plain error objects (e.g. `{tag: 'PermissionDenied', value: undefined}`).

### 2.5 Chain Subsystem

**`chain/connectionManager.ts`** -- Manages real JSON-RPC connections:
- **Connection pooling**: ref-counted per genesis hash
- **Request correlation**: auto-incrementing JSON-RPC ID -> Promise
- **Follow multiplexing**: `startFollow()` starts `chainHead_v1_follow`, converts JSON-RPC events to typed `ChainHeadEvent`
- Type converters for JSON-RPC <-> protocol format

**`chain/rateLimiter.ts`** -- Token-bucket rate limiter. Two strategies: `drop` (reject immediately) and `queue` (buffer up to max, process as tokens refill).

### 2.6 Storage Adapters (`storage/`)

`StorageAdapter` interface: async `read(key)`, `write(key, value)`, `clear(key)` for Uint8Array values.
- `createMemoryStorageAdapter()` -- Map-backed, for testing
- `createLocalStorageAdapter(prefix)` -- browser localStorage, base64, prefix-scoped

### 2.7 Auth (`auth/`)

**`authManager.ts`** -- State machine: `idle -> pairing -> attesting -> authenticated -> (disconnect) -> idle`. Any state can go to `error`. Pub-sub via `subscribe(callback)`. `getSession()` returns session if authenticated.

**`crypto.ts`** -- `deriveProductPublicKey(rootPublicKey, productId, derivationIndex)`: HDKD soft derivation through junctions `['product', productId, derivationIndex]`.

**`pappAdapter.ts`** -- Stub interface for QR-code pairing (to be ported from old host-papp).

### 2.8 Nested Bridge (`nested/`)

**`detector.ts`** -- `setupNestedBridgeDetector()`: listens for postMessage from windows OTHER than the primary iframe. Auto-creates `createWindowProvider` + Container + handlers bridge for each nested dApp.

### 2.9 SDK Entry Point (`sdk.ts`)

```typescript
const sdk = createHostSdk({
  appId: 'dot.li',
  chainProvider: (genesisHash) => getSmoldotProvider(genesisHash),
  onSignPayload: (session, payload) => showSignModal(session, payload),
});

const product = sdk.embed(iframeElement, 'https://dapp.example.com');
product.dispose();
sdk.dispose();
```

Creates AuthManager, then `embed()` creates iframeProvider -> Container -> wireAllHandlers(). Also exposes `setSession()` / `clearSession()` for external auth management.

**`types.ts`** -- `HostSdkConfig` with all options: `appId`, `chainProvider`, `supportedCodecs`, signing callbacks, permission callbacks, UI callbacks.

---

## Part 3: `@polkadot/product` (12 files)

What runs inside the iframe.

### 3.1 Transport (`transport/sandboxTransport.ts`)

Detects the environment:
- `isIframe()` -> listens on `window`, posts to `window.top`
- `isWebview()` -> uses injected `MessagePort`

Creates transport with `idPrefix: 'p:'` and `scaleCodecAdapter`. Exports singletons `sandboxProvider` and `sandboxTransport`.

### 3.2 Host API (`hostApi.ts`)

Product-side facade. Wraps every transport method (~35 methods) with strong types derived from the protocol codecs. Version tagging is handled internally -- callers pass raw payloads and receive unwrapped results:

```typescript
const hostApi = createHostApi(sandboxTransport);

// Request methods take raw payloads, return ResultAsync<Ok, Err> directly
hostApi.signPayload(signingPayload).match(
  (result) => result.signature,    // SigningResult — no version wrapper
  (err) => {
    // err is the error discriminated union directly:
    //   { tag: 'Rejected'; value: undefined }
    // | { tag: 'PermissionDenied'; value: undefined }
    // | { tag: 'Unknown'; value: { reason: string } }
    switch (err.tag) {
      case 'Unknown': console.log(err.value.reason); // narrowed
    }
  },
);

// Subscription methods receive unwrapped payloads
hostApi.accountConnectionStatusSubscribe(undefined, (status) => {
  // status is AccountConnectionStatus directly — no version wrapper
});
```

The internal `makeRequest(transport, method, version, payload)` wraps the payload in `{tag: version, value: payload}` before sending, and unwraps the response by stripping the version tag and splitting the `{success: true/false, value}` Result envelope. Callers never see the versioned wire format. `makeSubscription` similarly wraps start payloads and unwraps received payloads.

### 3.3 Accounts (`accounts.ts`)

`createAccountsProvider()`:
- `getProductAccount(dotNsId, derivationIndex?)` -> `hostApi.accountGet`
- `getNonProductAccounts()`
- `getProductAccountSigner(account)` -> returns signer routing through the transport
- `subscribeAccountConnectionStatus(callback)`

### 3.4 Chain (`chain.ts`)

The most complex file (~695 lines). `createPapiProvider(genesisHash)` returns a standard `JsonRpcProvider` compatible with Polkadot API (PAPI).

When PAPI calls `send('{"method":"chainHead_v1_follow",...}')`: parses JSON-RPC, maps to `hostApi` method, converts parameters, converts response back to JSON-RPC. Handles all `chainHead_v1_*`, `chainSpec_v1_*`, `transaction_v1_*` methods.

### 3.5 Storage (`storage.ts`)

```typescript
const storage = createLocalStorage();
await storage.writeString('key', 'value');
await storage.writeJSON('settings', { theme: 'dark' });
const val = await storage.readString('key');
```

Wraps `hostApi.localStorageWrite/Read/Clear` with convenience methods.

### 3.6 Chat, Statement Store, Preimage

**`chat.ts`** -- `createProductChatManager()`: register rooms/bots, send messages, subscribe to actions, custom renderer dispatch.

**`statementStore.ts`** -- `createStatementStore()`: subscribe to topics, create proofs, submit statements.

**`preimage.ts`** -- `createPreimageManager()`: lookup subscriptions, submit preimages.

### 3.7 Extension (`extension.ts`)

`injectSpektrExtension()` makes the transport bridge look like a polkadot-js browser extension. Any dApp using `@polkadot/extension-dapp` discovers it as `"spektr"`. Signing routes through the transport.

### 3.8 Constants (`constants.ts`)

`WellKnownChain` (genesis hashes for Polkadot, Kusama, Westend, Rococo + asset hubs), `SpektrExtensionName = 'spektr'`.

---

## Part 4: Tests

### 4.1 Unit Tests (12 files, 142 tests)

**Test helper** (`helpers/mockProvider.ts`): creates connected mock Provider pairs (async and sync variants).

**Shared** (5 files):
- `transport.spec.ts` (16 tests) -- handshake, request/response correlation, subscriptions, multiplexing, connection status, destroy, codec swap
- `negotiation.spec.ts` (4 tests) -- upgrade succeeds, fails gracefully, picks best intersection, requests work after upgrade
- `codec.spec.ts` (6 tests) -- structured clone round-trips, rejects Uint8Array, nested objects
- `protocol.spec.ts` (18 tests) -- all methods present in hostApiProtocol, correct types, error type construction
- `util.spec.ts` (24 tests) -- logger, createIdFactory, delay, promiseWithResolvers, composeAction, toHexString

**Host** (5 files):
- `handlers.spec.ts` (16 tests) -- featureSupported, navigateTo, pushNotification, permissions, storage
- `authManager.spec.ts` (14 tests) -- full state machine, subscribe/unsubscribe
- `storage.spec.ts` (11 tests) -- memory adapter CRUD, prefix isolation
- `rateLimiter.spec.ts` (10 tests) -- drop/queue strategies
- `sdk.spec.ts` (7 tests) -- construction, session management

**Product** (2 files):
- `constants.spec.ts` (13 tests) -- all chains present, hex format
- `storage.spec.ts` (3 tests) -- API shape verification

### 4.2 E2E Tests (1 file, 51 tests)

Playwright + headless Chromium. A Vite dev server serves two pages: host (creates Container + handlers with mock implementations) and product (inside iframe with its own Transport). Real `postMessage` across the iframe boundary.

Every test runs three times via `?codec=` query parameter:
- **`structured_clone`** -- both sides use structured clone codec throughout
- **`scale`** -- both sides use SCALE codec throughout
- **`upgrade`** -- both sides start with SCALE, handshake completes, product calls `requestCodecUpgrade`, both sides swap to structured clone, then all protocol requests run over the upgraded connection

**Happy-path tests** (12 per codec): handshake, feature check, account get, non-product accounts, sign payload, sign raw, localStorage write/read/clear, connection status subscription, navigate, device permission, multiple sequential requests.

**Error-path tests** (5 per codec): sign payload rejected (`Rejected` tag, no value), create transaction not supported (`NotSupported` tag with string value), account get alias unknown (`Unknown` tag with `{reason}` struct), navigate to permission denied (`PermissionDenied` tag, no value), storage write full (`Full` tag, no value). These verify that `Result` error envelopes (`success: false`) with plain `{tag, value}` discriminated unions survive the round-trip through encoding, iframe boundary, and decoding across all three codec modes.

---

## Part 5: Data Flow Example

**Product requests an account:**

```
Product: accounts.getProductAccount('myApp', 0)
  -> hostApi.accountGet({ tag: 'v1', value: ['myApp', 0] })
  -> transport.request('host_account_get', payload)
    -> nextId() -> "p:1"
    -> codec.encode({
         requestId: "p:1",
         payload: { tag: "host_account_get_request", value: {tag:'v1', value:['myApp',0]} }
       })
    -> provider.postMessage(data)
    -> window.top.postMessage(data, '*')

       -- crosses iframe boundary --

Host: iframeProvider receives MessageEvent
  -> validates source === iframe.contentWindow
  -> codec.decode(data)
  -> transport dispatches: tag matches "host_account_get_request", requestId "p:1"
  -> container.wireRequest unwraps v1 -> ['myApp', 0]
  -> handleAccountGet(['myApp', 0], ctx) runs
    -> derives product public key via HDKD
    -> ctx.ok({ publicKey: <derived>, name: 'Alice' })
  -> container wraps -> { tag:'v1', value: { success: true, value: {publicKey, name} } }
  -> transport.postMessage("p:1", { tag: "host_account_get_response", value: ... })
  -> codec.encode -> iframe.contentWindow.postMessage

       -- crosses back --

Product: provider receives
  -> codec.decode
  -> transport matches: tag "host_account_get_response" AND requestId "p:1"
  -> Promise resolves
  -> hostApi splits into ResultAsync.ok(...)
  -> accounts provider returns { publicKey, name: 'Alice' }
```

---

## Part 6: Codec Negotiation Flow

```
Product                              Host
   |                                   |
   |--- handshake_request (SCALE) ---->|
   |<-- handshake_response (SCALE) ----|
   |                                   |
   |--- codec_upgrade_request -------->|
   |    { supportedFormats:            |
   |      ['structured_clone','scale'] }|
   |                                   |
   |<-- codec_upgrade_response --------|
   |    { selectedFormat:              |
   |      'structured_clone' }         |
   |                                   |
   |  [both sides swap codec adapter]  |
   |                                   |
   |--- account_get (struct clone) --->|
   |<-- account_response (struct) -----|
```

If the host is old and doesn't support the upgrade method, the request times out after 1 second and both sides stay on their current codec.
