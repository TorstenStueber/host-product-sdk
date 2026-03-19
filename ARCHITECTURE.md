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

Error enums (e.g. `SigningErr`, `StorageErr`) use plain `Enum` -- the SCALE bytes are identical to the original `@novasamatech/scale` `ErrEnum`, but decoding produces plain `{tag, value}` objects on the wire. Proper `Error` class instances are constructed separately (see 1.12 Error Classes below).

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

Error types are NOT exported here -- they are provided as proper `Error` classes from `codec/scale/errors.ts` (see 1.12 below).

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

### 1.12 Error Classes (`codec/scale/errors.ts`)

Protocol error classes that match the `CodecError` hierarchy from `triangle-js-sdks` / `@novasamatech/scale`. Each error enum has a namespace with a class per variant, all extending `Error` directly:

```typescript
import { SigningErr, NavigateToErr, GenericError } from '@polkadot/shared';

// Host handler creates proper Error instances:
ctx.err(new SigningErr.Rejected());
ctx.err(new NavigateToErr.Unknown({ reason: 'blocked' }));

// Product consumer receives proper Error instances:
err instanceof SigningErr.Rejected  // true
err.name      // 'SigningErr::Rejected'
err.message   // 'Rejected'
err.instance  // 'Rejected'
err.tag       // 'Rejected'
err.payload   // undefined (alias for .value)
```

**Wire format constraint** -- structured clone does not preserve custom `Error` properties (only `.message`, `.name`, `.stack` survive). Therefore error class instances cannot cross the iframe boundary directly. Instead:

1. **Host side** (`wireRequest`): the handler returns an error class instance via `ctx.err(new SigningErr.Rejected())`. Before encoding, `wireRequest` flattens it to a plain `{tag, value}` object: `{ tag: error.tag, value: error.value }`. This plain object is safe for both SCALE encoding and structured clone.

2. **Wire**: plain `{tag: 'Rejected', value: undefined}` travels across the iframe boundary.

3. **Product side** (`hostApi`): each method calls `makeRequest()` which returns the plain error, then `.mapErr()` hydrates it into the correct error class instance using the error enum's `fromPlain()` method:
   ```typescript
   signPayload(payload) {
     return makeRequest(transport, 'host_sign_payload', payload)
       .mapErr(e => hydrate(e, SigningErr.fromPlain));
   }
   ```

This gives both sides proper `Error` instances with `instanceof` support, `.name`, `.message`, `.payload`, and `.instance` properties matching `triangle-js-sdks`, while keeping the wire format compatible with both codecs.

**Error enums defined** (12 enums + 1 standalone class):

| Error enum | Variants | Used by |
|---|---|---|
| `GenericError` | (standalone) | `host_feature_supported`, `host_push_notification`, `host_device_permission`, `remote_permission`, chain methods, JSON-RPC |
| `HandshakeErr` | `Timeout`, `UnsupportedProtocolVersion`, `Unknown` | `host_handshake` |
| `RequestCredentialsErr` | `NotConnected`, `Rejected`, `DomainNotValid`, `Unknown` | `host_account_get`, `host_account_get_alias`, `host_get_non_product_accounts` |
| `CreateProofErr` | `RingNotFound`, `Rejected`, `Unknown` | `host_account_create_proof` |
| `SigningErr` | `FailedToDecode`, `Rejected`, `PermissionDenied`, `Unknown` | `host_sign_payload`, `host_sign_raw` |
| `CreateTransactionErr` | `FailedToDecode`, `Rejected`, `NotSupported`, `PermissionDenied`, `Unknown` | `host_create_transaction`, `host_create_transaction_with_non_product_account` |
| `StorageErr` | `Full`, `Unknown` | `host_local_storage_read`, `host_local_storage_write`, `host_local_storage_clear` |
| `NavigateToErr` | `PermissionDenied`, `Unknown` | `host_navigate_to` |
| `ChatRoomRegistrationErr` | `PermissionDenied`, `Unknown` | `host_chat_create_room` |
| `ChatBotRegistrationErr` | `PermissionDenied`, `Unknown` | `host_chat_register_bot` |
| `ChatMessagePostingErr` | `MessageTooLarge`, `Unknown` | `host_chat_post_message` |
| `StatementProofErr` | `UnableToSign`, `UnknownAccount`, `Unknown` | `remote_statement_store_create_proof` |
| `PreimageSubmitErr` | `Unknown` | `remote_preimage_submit` |

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

Handler context provides `ctx.ok(value)` and `ctx.err(error)`. No manual type annotations -- all param/ok/err types flow from `hostApiProtocol`. Handlers use error class instances: `ctx.err(new SigningErr.Rejected())`. The container flattens these to `{tag, value}` before encoding for wire safety.

### 2.4 Handlers (`handlers/`)

**`registry.ts`** -- `wireAllHandlers(container, config)`: orchestrator calling each domain wiring function. `HandlersConfig` has `getSession()`, `subscribeAuthState()`, `chainProvider()`, plus callbacks.

**`host.ts`** -- `featureSupported` (config callback or chainProvider check), `navigateTo` (callback or `window.open`), `pushNotification` (callback or `console.warn`).

**`permissions.ts`** -- `devicePermission` and `permission` return `false` by default.

**`storage.ts`** -- Scoped browser localStorage. Keys prefixed with `config.storagePrefix` (default `"${appId}:"`). Values stored as base64 strings.

**`accounts.ts`** -- `accountGet` derives product-specific public key via HDKD from session. `getNonProductAccounts` returns root account. `connectionStatusSubscribe` pushes connected/disconnected. `getAlias`/`createProof` are stubs.

**`signing.ts`** -- `signPayload`/`signRaw` delegate to config callbacks. Return `new SigningErr.PermissionDenied()` if no session. `createTransaction` returns `new CreateTransactionErr.NotSupported('...')` by default.

**`chain.ts`** -- Wires `container.handleChainConnection(config.chainProvider)`.

**`chat.ts`**, **`statementStore.ts`**, **`preimage.ts`** -- Stubs returning error class instances (e.g. `new ChatRoomRegistrationErr.PermissionDenied()`).

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

Product-side facade. Wraps every transport method (~35 methods) with strong types derived from the protocol codecs. Each request method hydrates errors into proper `Error` class instances via `.mapErr()`:

```typescript
const hostApi = createHostApi(sandboxTransport);

// Request methods return ResultAsync with typed ok/err
hostApi.signPayload(payload).match(
  (ok) => ok.value,                        // Tagged<'v1', SigningResult>
  (err) => {
    const error = err.value;               // SigningErr.Rejected | SigningErr.Unknown | ...
    error instanceof SigningErr.Rejected;   // true
    error.name;                            // 'SigningErr::Rejected'
    error.message;                         // 'Rejected'
    error.payload;                         // undefined
  },
);

// Subscription methods return Subscription with typed payloads
const sub = hostApi.chainHeadFollow(args, callback);
sub.unsubscribe();
```

The internal `makeRequest<M, V>()` returns plain `{tag, value}` errors from the wire. Each per-method wrapper then hydrates via the error enum's `fromPlain()`:

```typescript
signPayload(payload) {
  return makeRequest(transport, 'host_sign_payload', payload)
    .mapErr(e => hydrate(e, SigningErr.fromPlain));
}
```

This gives each method a specific error return type (e.g. `SigningErr` variants for signing, `StorageErr` variants for storage) rather than a generic error type.

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

### 4.2 E2E Tests (1 file, 78 tests)

Playwright + headless Chromium. A Vite dev server serves two pages: host (creates Container + handlers with mock implementations using error classes) and product (inside iframe with its own Transport and HostApi). Real `postMessage` across the iframe boundary.

Every test runs three times via `?codec=` query parameter:
- **`structured_clone`** -- both sides use structured clone codec throughout
- **`scale`** -- both sides use SCALE codec throughout
- **`upgrade`** -- both sides start with SCALE, handshake completes, product calls `requestCodecUpgrade`, both sides swap to structured clone, then all protocol requests run over the upgraded connection

**Happy-path tests** (12 per codec): handshake, feature check, account get, non-product accounts, sign payload, sign raw, localStorage write/read/clear, connection status subscription, navigate, device permission, multiple sequential requests.

**Error wire-format tests** (5 per codec): verify that `Result` error envelopes (`success: false`) with plain `{tag, value}` survive the round-trip through encoding, iframe boundary, and decoding. Tests: sign payload rejected, create transaction not supported, account get alias unknown with reason, navigate to permission denied, storage write full.

**Error class hydration tests** (9 per codec): verify the full error class round-trip — host creates error class instances (e.g. `new SigningErr.Rejected()`), they are flattened to `{tag, value}` on the wire, and the product receives proper `Error` instances with correct `.name`, `.message`, `.instance`, `.payload`, and `instanceof` behavior. Tests cover: `SigningErr.Rejected`, `CreateTransactionErr.NotSupported`, `NavigateToErr.PermissionDenied`, `StorageErr.Full`, `RequestCredentialsErr.Unknown`, `CreateProofErr.Unknown`, `ChatRoomRegistrationErr.PermissionDenied`, `ChatMessagePostingErr.Unknown`, `StatementProofErr.Unknown`.

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
