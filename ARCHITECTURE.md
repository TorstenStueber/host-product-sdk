# Architecture

## What This System Does

A **host** application (like dot.li) embeds third-party **product** dApps inside iframes. The two sides communicate over
`window.postMessage`. The product asks the host for accounts, signatures, storage, chain data. The host responds.

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

| Package                  | Published           | Purpose                                                                  |
| ------------------------ | ------------------- | ------------------------------------------------------------------------ |
| `@polkadot/api-protocol` | No (workspace-only) | Protocol types, codecs, transport, host protocol handler, product facade |
| `@polkadot/host`         | Yes                 | Handlers, auth, storage, SDK entry point                                 |
| `@polkadot/product`      | Yes                 | Domain modules: accounts, chain, chat, storage, etc.                     |

Runtime dependencies of api-protocol: `scale-ts`, `nanoevents`, `neverthrow`, `@polkadot-api/json-rpc-provider`.

Runtime dependencies of host (in addition to api-protocol): `@noble/ciphers`, `@noble/hashes`, `@noble/curves` (AES-GCM,
HKDF, blake2b, P-256 ECDH), `@scure/sr25519` (sr25519 signing), `@polkadot-labs/hdkd-helpers` (BIP-39 mnemonics, HDKD),
`@polkadot-api/substrate-bindings` (AccountId SS58 codec), `@polkadot-api/json-rpc-provider` (transport interface),
`polkadot-api` (chain client), `verifiablejs` (Bandersnatch ring-VRF WASM for attestation).

---

## Part 1: `@polkadot/api-protocol`

The protocol package has three top-level directories:

- `src/api/`: the API definition (`hostApiProtocol` registry, derived types, domain types) — the core of the project
- `src/shared/`: codec adapters, transport, utilities — infrastructure that supports the API
- `src/host-facade/` and `src/product-facade/`: typed facades for each side (see Parts 1b and 1c)

Read bottom-up: utilities, then codec, then transport, then API definition.

### 1.1 Utilities (`util/`)

**`util/logger.ts`**: A `Logger` type (info/warn/error/log + `withPrefix()`) and `createDefaultLogger(prefix?)` that
wraps `console`.

**`util/idFactory.ts`**: `createIdFactory(prefix)` returns a function that generates prefixed incrementing IDs. Each
factory has its own independent counter. The host uses prefix `"h:"`, the product uses `"p:"`, so IDs never collide on
the shared postMessage channel.

**`util/helpers.ts`**: Four small utilities:

- `delay(ms)`: Promise that resolves after a timeout
- `promiseWithResolvers<T>()`: ES2024 polyfill
- `composeAction(method, suffix)`: builds `"host_account_get_request"` from `"host_account_get"` + `"request"`
- `extractErrorMessage(err)`: safely gets a string from any thrown value

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

Every message on the wire has a `requestId` (for correlation) and a `payload` (a tagged union where `tag` identifies the
action like `"host_account_get_request"`).

### 1.3 Structured Clone Codec (`codec/structured/index.ts`)

The simplest codec -- does nothing:

```typescript
export const structuredCloneCodecAdapter: CodecAdapter = {
  encode: msg => msg, // pass through
  decode: data => data as ProtocolMessage,
};
```

`postMessage` already handles serialization via the browser's structured clone algorithm. No need to encode/decode.
Works for all iframes regardless of origin.

### 1.4 SCALE Codec Primitives (`codec/scale/primitives.ts`)

Thin wrappers over `scale-ts` for Polkadot-specific needs. Previously provided by the external `@novasamatech/scale`
package -- inlined to remove the dependency (~130 lines):

| Function            | What it does                                                |
| ------------------- | ----------------------------------------------------------- |
| `Enum(inner)`       | Re-exported from scale-ts. Tagged union codec               |
| `Hex(length?)`      | SCALE codec for `0x`-prefixed hex strings                   |
| `Status(...labels)` | Enum without values -- maps string labels to u8 indices     |
| `lazy(fn)`          | Deferred codec for recursive types                          |
| `OptionBool`        | Optimized `Option(bool)` encoding (0=none, 1=false, 2=true) |

Error enums (e.g. `SigningErr`, `StorageErr`) use plain `Enum` -- the SCALE bytes are identical to the original
`@novasamatech/scale` `ErrEnum`, but decoding produces plain `{tag, value}` discriminated unions instead of `CodecError`
class instances. This is simpler and works naturally with neverthrow's `Result` pattern (see 1.12 Error Representation).

Also exports `HexString` type (`` `0x${string}` ``) and `toHexString()` validator.

### 1.5 SCALE V1 Codecs (`codec/scale/v1/`)

16 files defining the building-block SCALE codecs for the protocol. These are exact ports from the old
`@novasamatech/host-api`. Each file defines domain-specific codecs (structs, enums, error types) and exports
`CodecType<>`-derived TypeScript types. The per-method request/response/start/receive codecs are not exported separately
-- they are composed inline in `hostApiProtocol` (see 1.6).

**`commonCodecs.ts`**: `GenesisHash = Hex()`, `GenericErr = Struct({ reason: str })`.

**`accounts.ts`**: `AccountId = Bytes(32)`, `ProductAccountId = Tuple(str, u32)`,
`Account = Struct({ publicKey, name })`, error enums (`RequestCredentialsErr`, `CreateProofErr`),
`AccountConnectionStatus`.

**`sign.ts`**: `SigningPayload` (16 fields: address, blockHash, era, method, nonce, etc.), `SigningResult`,
`RawPayload`, `SigningErr`.

**`chainInteraction.ts`**: The largest file. All `chainHead_v1` JSON-RPC as SCALE: `ChainHeadEvent` (12-variant enum:
Initialized, NewBlock, BestBlockChanged, Finalized, plus operation events), `BlockHash`, `OperationId`,
`StorageQueryItem`, `OperationStartedResult`.

**`chat.ts`**: Room/bot registration, `ChatMessageContent` (7-variant enum: Text, RichText, Actions, File, Reaction,
ReactionRemoved, Custom), actions.

**`customRenderer.ts`**: Recursive UI component tree matching the original wire format exactly. 9 node variants (Nil,
String, Box, Column, Row, Spacer, Text, Button, TextField), each wrapped in a Component struct with
`{modifiers: Vector(Modifier), props, children: Vector(Children)}`. Modifiers are a tagged enum (margin, padding,
background, border, sizes, fill flags). Uses `lazy()` for recursive children.

**Other v1 files**: `localStorage.ts`, `navigation.ts`, `notification.ts`, `feature.ts`, `devicePermission.ts`,
`remotePermission.ts`, `createTransaction.ts`, `statementStore.ts`, `preimage.ts`, `handshake.ts`.

### 1.6 API Protocol Definition (`api/protocol.ts`)

Imports building-block codecs from the v1 files and composes them inline into a flat, explicit registry with no helper
functions:

```typescript
export const hostApiProtocol = {
  // Request methods have _request and _response:
  host_handshake: {
    _request: Enum({ v1: u8 }),
    _response: Enum({ v1: Result(_void, HandshakeErr) }),
  },
  // Subscription methods have _start and _receive (_stop/_interrupt inferred as _void):
  host_account_connection_status_subscribe: {
    _start: Enum({ v1: _void }),
    _receive: Enum({ v1: AccountConnectionStatus }),
  },
  // ...45 methods total (including host_codec_upgrade, our extension)
} as const;
```

Each codec is wrapped in `Enum({v1: ...})` matching the original `triangle-js-sdks` wire format (version discriminant
byte). Versioning is per-type: when a v2 is added, it becomes `Enum({v1: codec1, v2: codec2})` -- each method versions
its request/response types independently.

Each entry's exact codec types are preserved by TypeScript, so `typeof hostApiProtocol.host_handshake._request` gives
the precise codec type.

**Derived method name types**: since `hostApiProtocol` is declared `as const`, TypeScript preserves the literal key
types. Mapped types split them into two union types:

- `RequestMethod`: union of all keys with `_request`/`_response` (e.g. `'host_handshake' | 'host_account_get' | ...`)
- `SubscriptionMethod`: union of all keys with `_start`/`_receive` (e.g.
  `'host_account_connection_status_subscribe' | ...`)
- `ActionString`: union of all valid wire action strings:
  `` `${RequestMethod}_${'request'|'response'}` | `${SubscriptionMethod}_${'start'|'receive'|'stop'|'interrupt'}` ``

These types are used throughout the transport, protocol handler, and product API to ensure method names are checked at
compile time.

**Derived per-method per-version types**: given a method name `M` and version tag `V` (e.g. `'v1'`), the following types
extract the inner codec types using `CodecType<>` and `Extract<>`:

- `RequestCodecType<M>`, `ResponseCodecType<M>`: full versioned envelope types (e.g. `{ tag: 'v1'; value: ... }`) used
  by the transport layer
- `StartCodecType<M>`, `ReceiveCodecType<M>`: same for subscription methods
- `RequestParams<M, V>`: handler params type (inner value at a specific version, from `_request` codec)
- `ResponseOk<M, V>`: Ok type from the `Result` response (from `_response` codec)
- `ResponseErr<M, V>`: Err type from the `Result` response
- `SubscriptionParams<M, V>`: subscription start params (from `_start` codec)
- `SubscriptionPayload<M, V>`: subscription receive payload (from `_receive` codec)
- `RequestVersions<M>`, `ResponseVersions<M>`, `StartVersions<M>`, `ReceiveVersions<M>`: available version tags

These types are the single source of truth for handler signatures on both the host and product sides. The transport
methods are generic on the method name (`request<M>`, `handleRequest<M>`, etc.) so the versioned envelope types flow
through automatically. The HostFacade interface and the product ProductFacade derive their types from the same protocol
codecs.

The `MessagePayload` enum is built by flattening all entries (concatenating method name + suffix into action keys like
`host_handshake_request`). For subscriptions, `_stop` and `_interrupt` default to `_void` if omitted. Then:

- `Message = Struct({ requestId: str, payload: MessagePayload })`: the top-level wire format

The SCALE codec adapter (`createScaleCodecAdapter`, `scaleCodecAdapter`) lives separately in
`shared/codec/scale/adapter.ts` — it wraps the `Message` codec into a `CodecAdapter` for the transport layer.

### 1.7 API Types (`api/types.ts`)

Re-exports data types (params, results, structs) derived from SCALE codecs via `CodecType<>`:

```typescript
export type { AccountType as Account } from '../codec/scale/v1/accounts.js';
export type { SigningResultType as SigningResult } from '../codec/scale/v1/sign.js';
```

Error types are plain `{tag, value}` discriminated unions (see 1.12 Error Representation).

Optional values use `undefined` (not `null`) because SCALE's `Option` codec maps absent values to `undefined`. All
optional fields (e.g. `TxPayloadV1.signer`, `SigningResult.signedTransaction`) use `Option` directly -- there is no
`Nullable` wrapper. The codebase avoids `null` except where external APIs force it (DOM, JSON-RPC).

### 1.8 Provider (`transport/provider.ts`)

The lowest abstraction -- a raw message pipe:

```typescript
type Provider = {
  postMessage(message: Uint8Array | unknown): void;
  subscribe(callback: (message: Uint8Array | unknown) => void): () => void;
  dispose(): void;
};

type Messaging =
  | { type: 'window'; target: Window | Promise<Window> }
  | { type: 'messagePort'; port: MessagePort | Promise<MessagePort> };
```

The `Messaging` type is used by both `createHostFacade` and `createProductFacade` to describe how to reach the other
side. Both `window` and `messagePort` variants accept a direct value or a Promise for async acquisition.

Knows nothing about protocol methods, IDs, or codecs.

Two concrete provider implementations live in shared as neutral building blocks:

**`transport/windowProvider.ts`**: `createWindowProvider(target: Window | Promise<Window>)`: the generic `postMessage`
provider. Accepts either a direct `Window` reference or a Promise (for async acquisition). Validates incoming messages
(accepts both Uint8Array for SCALE and protocol message objects for structured clone), manages subscribers, handles
Uint8Array buffer transfer. Messages sent before the promise resolves are delivered once the window becomes available.
Used internally by `createHostFacade` and `createProductFacade` when `messaging.type` is `'window'`.

**`transport/messagePortProvider.ts`**: `createMessagePortProvider(port: MessagePort | Promise<MessagePort>)`:
communicates over a MessagePort. Accepts a ready port or a Promise (for async acquisition). Same message validation as
`createWindowProvider`. Used internally when `messaging.type` is `'messagePort'`.

### 1.9 Transport (`transport/transport.ts`)

**The engine of the system.** Takes a Provider, returns a Transport. Always starts with SCALE encoding — no codec
configuration needed.

**Auto-detect decoding**: incoming messages are decoded by inspecting their shape: `Uint8Array` → SCALE decode, plain
object with `requestId` → structured clone (identity). When a structured clone message is detected, the outgoing codec
is automatically upgraded to structured clone. This means the transport starts encoding with SCALE but transparently
upgrades to structured clone as soon as the other side sends a structured clone message.

**Not-supported catch-all**: the transport tracks which `_request` and `_start` actions have registered handlers. A
catch-all listener responds immediately to unhandled requests (with `NOT_SUPPORTED_MARKER`, detected by the sender's
`request()` which rejects with `MethodNotSupportedError`) and unhandled subscriptions (with `_interrupt`). This prevents
requests from hanging indefinitely when the other side doesn't support a method.

**Handshake**: `createTransport` takes a required `handshake: 'initiate' | 'respond'` option. The `'initiate'` side
(product) eagerly sends `host_handshake_request` every 50ms, up to 10s timeout. The `'respond'` side (host) auto-wires a
handler that validates the protocol version and resolves its own `whenReady()` when the first handshake succeeds.
`transport.whenReady()` returns `Promise<void>` that resolves when the handshake completes, or rejects on timeout or
disposal. Connection status goes `disconnected` -> `connecting` -> `connected`.

**Request/Response**: `transport.request<M>(method, payload)` is generic on the method name. It takes
`RequestCodecType<M>` (the versioned envelope), generates a unique ID (e.g. `"p:1"`), posts
`{requestId, payload: {tag: "method_request", value}}`, listens for `{tag: "method_response"}` with matching requestId,
and resolves with `ResponseCodecType<M>`. Supports `AbortSignal`. If the other side has no handler, rejects with
`MethodNotSupportedError`.

**Handle Request**: `transport.handleRequest<M>(method, handler)` is also generic. The handler receives
`RequestCodecType<M>` and must return `Promise<ResponseCodecType<M>>`.

**Subscriptions**: `transport.subscribe<M>(method, payload, callback)` sends `_start` with `StartCodecType<M>`, listens
for `_receive` with `ReceiveCodecType<M>`. `unsubscribe()` sends `_stop`. The other side can `interrupt()`.

**Handle Subscription**: `transport.handleSubscription<M>(method, handler)` registers a producer. `handler` returns a
cleanup function; the transport guarantees it runs exactly once on any termination path -- consumer-sent `_stop`,
synchronous `interrupt()` during `handler()`, or asynchronous `interrupt()` after the handler returned. `interrupt()` is
idempotent. Handlers should put teardown in the returned cleanup rather than running it inline before `interrupt()`.

**Multiplexing**: Two callers subscribing to the same method+payload share one wire subscription. When the last listener
unsubscribes, `_stop` is sent.

**Low-level**: `postMessage` and `listenMessages` operate on `ActionString` (the composed `method_suffix` strings).
`listenMessages` callback receives `(requestId, value)` -- just the payload value, not the full `{tag, value}` envelope
(the tag is redundant since it was used for filtering). `composeAction(method, suffix)` is generic and returns
`` `${M}_${S}` ``, so the types flow through correctly.

**Codec swap**: `transport.swapCodecAdapter(newAdapter)` hot-swaps the outgoing encoding. Used by `requestCodecUpgrade`
on the product side and `handleCodecUpgrade` on the host side.

### 1.10 Codec Negotiation (`codec/negotiation.ts`)

Post-handshake codec upgrade flow.

**Product side**: `requestCodecUpgrade(transport, adapters)`: after handshake, sends `host_codec_upgrade` with supported
formats, waits 1s for response, swaps its outgoing codec if host agrees. Returns selected format or `undefined`. The
`host_codec_upgrade` method has proper SCALE codecs in the protocol registry
(`Struct({ supportedFormats: Vector(str) })` for the request, `Struct({ selectedFormat: str })` for the response), so
`transport.request` is called with full type safety.

**Host side**: `handleCodecUpgrade(transport, adapters)`: picks best format from intersection (always prefers structured
clone), swaps the outgoing codec BEFORE sending the response, then sends the response. This means the response itself is
encoded as structured clone, which forces the product's `decodeIncoming` to auto-upgrade its outgoing codec too. Uses
low-level `listenMessages`/`postMessage` (not `handleRequest`) for explicit control of the swap-then-respond sequence.

**Race condition safety**: because the host swaps before responding, the response arrives as structured clone. Even if
the product's 1s timeout has already fired (so `requestCodecUpgrade` returned `undefined`), the product's
`decodeIncoming` detects the structured clone response and auto-upgrades the outgoing codec. Both sides converge on
structured clone regardless of timing.

**Automatic upgrade**: `createProductFacade` wraps the handshake so that after it succeeds, it automatically calls
`requestCodecUpgrade` with both `scale` and `structured_clone` adapters before `whenReady()` resolves. Since every
`transport.request()` and `transport.subscribe()` internally awaits `whenReady()`, the upgrade happens transparently
before any real protocol traffic.

**Backward compatibility**: old hosts running `triangle-js-sdks` don't have the not-supported catch-all, so the
product's request hangs until the 1s timeout. With our code, the not-supported catch-all responds immediately with
`MethodNotSupportedError`, so the product gets `undefined` near-instantly.

### 1.11 Main Entry Point (`index.ts`)

Single flat file re-exporting from all layers: `api/` (protocol definition, domain types), `shared/` (codec adapters,
transport, utilities), `host-facade/` (HostFacade), and `product-facade/` (ProductFacade). No barrel chains.

### 1.12 Error Representation

Errors use plain `{tag, value}` discriminated unions -- the same representation that the SCALE codecs produce. This
follows the pattern encouraged by `neverthrow`, where the `E` type parameter in `Result<T, E>` / `ResultAsync<T, E>` is
a data type, not an Error class:

```typescript
// Host handler returns ResultAsync with a plain error object:
errAsync({ tag: 'Rejected', value: undefined });
errAsync({ tag: 'Unknown', value: { reason: 'Not configured' } });

// Product consumer narrows via the tag discriminant:
result.match(
  ok => ok.value,
  err => {
    switch (err.value.tag) {
      case 'Rejected': // err.value.value is undefined
      case 'Unknown': // err.value.value is { reason: string }
      case 'PermissionDenied': // err.value.value is undefined
    }
  },
);
```

TypeScript narrows `value` automatically when the `tag` is checked, giving full type safety without error classes. This
approach also avoids the structured clone limitation (custom Error properties are stripped during postMessage), keeping
the wire format clean for both SCALE and structured clone codecs.

This differs from triangle-js-sdks, which uses `CodecError` class instances baked into the SCALE codec via `ErrEnum`.
Their approach gives `instanceof` checks and `.message` strings but couples the codec layer to a class hierarchy. Our
plain objects are simpler, work naturally with neverthrow's `.match()` / `.mapErr()` / `.andThen()`, and require no
flatten/hydrate layer between host and product.

---

## Part 1b: `@polkadot/api-protocol`: Host facade (`src/host-facade/`)

Host-side protocol handler, providers, and chain connection manager. These live in the `api-protocol` package because
they are the host's interface to the transport -- the bridge between the protocol layer and the handler implementations
in `@polkadot/host`.

### 1b.1 HostFacade (`host-facade/protocolHandler.ts`)

`createHostFacade(options)` builds the host-side communication stack:

```typescript
const handler = createHostFacade({
  messaging: { type: 'window', target: iframe.contentWindow },
  allowCodecUpgrade: true, // default
});
```

The `messaging` option determines the underlying provider (same tagged union as `createProductFacade` on the product
side):

- `{ type: 'window', target }` -> `createWindowProvider(target)` (iframe communication)
- `{ type: 'messagePort', port }` -> `createMessagePortProvider(port)` (webview communication)

`allowCodecUpgrade` (default `true`) registers a codec upgrade handler with hardcoded `scale` and `structured_clone`
adapters.

Internally creates a Transport with `handshake: 'respond'` and `idPrefix: 'h:'`. Returns HostFacade with 41 methods (40
`handle*()` for product-initiated requests/subscriptions, plus one host-initiated method: `renderChatCustomMessage`)

The internal helpers `wireRequest(method, handlers, defaultError)` and `wireSubscription(method, handlers)` take a
**version handler map**: an object keyed by version tag, each value a handler for that version:

```typescript
wireRequest('host_account_get', { v1: handler }, defaultError);
wireSubscription('host_account_connection_status_subscribe', { v1: handler });
```

A single transport handler is registered per method. When a message arrives, its version tag is inspected and dispatched
to the matching handler. If no handler matches the version, requests get a v1 error response (`defaultError`) and
subscriptions get interrupted. The same version tag governs both incoming and outgoing types -- `v1` requests produce
`v1` responses, `v2` requests produce `v2` responses.

Internal helpers:

- `unwrap(message, version)` extracts the inner value from `{tag: version, value: data}`
- `wrapOk(version, value)` / `wrapErr(version, error)` wrap into `{tag: version, value: {success: true/false, value}}`
- `wrap(version, value)` wraps subscription payloads without Result envelope

The handler's params, ok, and err types are derived from the protocol codecs via `RequestParams<M, V>`,
`ResponseOk<M, V>`, `ResponseErr<M, V>`. TypeScript enforces that handler implementations match the SCALE codec shapes.

**Adding a new version**: when a method needs a v2, three changes are needed:

1. **`codec/scale/v1/` (or new `v2/`)**: define the new v2 building-block codecs.
2. **`api/protocol.ts`**: extend the method's enum inline:
   `_request: Enum({ v1: ProductAccountId, v2: NewAccountGetV2Codec })`. The `RequestVersions<M>` type automatically
   becomes `'v1' | 'v2'`, and `RequestParams<M, 'v2'>` derives the v2 types.
3. **`protocolHandler.ts`**: add the v2 handler to the map:
   `wireRequest('host_account_get', { v1: handlerV1, v2: handlerV2 }, defaultError)`. TypeScript enforces that
   `handlerV2` matches the v2 codec types. Existing v1 clients continue to work unchanged.

For subscriptions, the same pattern applies: extend `_start`/`_receive` enums and add the version entry to the handler
map.

`handleChainConnection(factory)` is special -- creates a `ChainConnectionManager` and wires all 13 chain methods with
its own inline version dispatch.

### 1b.3 HostFacade Types (`host-facade/types.ts`)

The `HostFacade` interface derives all handler types from the protocol codecs:

```typescript
type RequestHandler<M extends RequestMethod, V extends string = 'v1'> = (
  params: RequestParams<M, V>,
) => ResultAsync<ResponseOk<M, V>, ResponseErr<M, V>>;

interface HostFacade {
  handleAccountGet(handler: RequestHandler<'host_account_get'>): VoidFunction;
  // 39 more handle*() methods...

  // Host-initiated (the one exception -- host subscribes to product):
  renderChatCustomMessage(params, callback): Subscription;

  dispose(): void;
}
```

Handlers return `ResultAsync` from neverthrow. No context object -- handlers use `okAsync(value)` and `errAsync(error)`
directly. All param/ok/err types flow from `hostApiProtocol`.

**Directionality**: almost all protocol methods are product-initiated: the product calls `transport.request()` or
`transport.subscribe()`, and the host handles them via `transport.handleRequest()` / `transport.handleSubscription()`.
The one exception is `product_chat_custom_message_render_subscribe`, where the host initiates a subscription to the
product (asking it to render a custom chat message UI). The protocol handler exposes this as `renderChatCustomMessage()`
(calling `transport.subscribe()`), while the product registers a handler via `handleCustomMessageRendering()` in
`chat.ts` (which calls `hostApi.handleHostSubscription()` -- a proxy for `transport.handleSubscription()`).

---

## Part 1c: `@polkadot/api-protocol`: Product facade (`src/product-facade/`)

Product-side ProductFacade. Lives in `api-protocol` because it is the product's interface to the transport -- the bridge
between the protocol layer and the domain modules in `@polkadot/product`.

### 1c.1 Product Facade (`product-facade/hostApi.ts`)

`createProductFacade(options)` builds the full product-side communication stack in one call:

```typescript
const hostApi = createProductFacade({
  messaging: { type: 'window', target: window.top },
});
```

The `messaging` option determines the underlying provider:

- `{ type: 'window', target }` -> `createWindowProvider(target)` (iframe communication)
- `{ type: 'messagePort', port }` -> `createMessagePortProvider(port)` (webview communication)

Internally, `createProductFacade` creates the provider, builds a transport with `handshake: 'initiate'` and
`idPrefix: 'p:'`, and wraps `whenReady()` so that after the handshake succeeds, it automatically attempts a codec
upgrade to structured clone before resolving.

Product-side facade. The **only** interface that product domain modules use to communicate with the host -- no module
imports `Transport` directly. Wraps every transport method (43 protocol methods plus transport lifecycle) with strong
types derived from the protocol codecs. Version tagging is handled internally -- callers pass raw payloads and receive
unwrapped results.

The internal `makeRequest(transport, method, version, payload)` wraps the payload in `{tag: version, value: payload}`
before sending, and unwraps the response by stripping the version tag and splitting the `{success: true/false, value}`
Result envelope. Callers never see the versioned wire format. `makeSubscription` similarly wraps start payloads and
unwraps received payloads.

**Transport proxies**: in addition to protocol methods, `ProductFacade` exposes:

- `whenReady()`: resolves when handshake and codec negotiation are complete
- `handleHostSubscription(method, handler)`: registers a handler for the one host-initiated subscription (custom chat
  message rendering)

---

## Part 2: `@polkadot/host`

What runs on the host page. Handlers, auth, storage adapters, and the SDK entry point. All code here imports from
`@polkadot/api-protocol` -- it never touches the transport directly.

### 2.1 Handlers (`handlers/`)

**`registry.ts`**: `wireAllHandlers(protocolHandler, config)`: orchestrator calling each domain wiring function.
`HandlersConfig` has `storage: StorageAdapter` (required), `subscribeAuthState` (required), `getSession()`,
`chainProvider()`, plus callbacks.

**`host.ts`**: `featureSupported` (config callback or chainProvider check), `navigateTo` (delegates to callback, no-op
if not configured), `pushNotification` (callback or `console.warn`).

**`permissions.ts`**: `devicePermission` and `permission` return `false` by default.

**`storage.ts`**: Delegates to the `StorageAdapter` in `config.storage`. The adapter handles key scoping, encoding, and
persistence — the handler is storage-backend-agnostic.

**`accounts.ts`**: `accountGet` derives product-specific public key via HDKD from session. `getNonProductAccounts`
returns root account. `connectionStatusSubscribe` pushes connected/disconnected. `getAlias`/`createProof` are stubs.

**`signing.ts`**: `signPayload`/`signRaw` delegate to config callbacks via `ResultAsync.fromPromise`. Return
`errAsync({tag: 'PermissionDenied', ...})` if no session. `createTransaction`/`createTransactionWithNonProductAccount`
delegate to config callbacks, returning `errAsync({tag: 'NotSupported', ...})` when the callback is not configured.

**`chain.ts`**: Wires `protocolHandler.handleChainConnection(config.chainProvider)`.

**`chat.ts`**, **`statementStore.ts`**, **`preimage.ts`**: Stubs returning `errAsync(...)` with plain error objects
(e.g. `{tag: 'PermissionDenied', value: undefined}`).

### 2.2 Chain

**`chain/rateLimiter.ts`**: Token-bucket rate limiter. Two strategies: `drop` (reject immediately) and `queue` (buffer
up to max, process as tokens refill).

### 2.3 Storage Adapters (`storage/`)

`StorageAdapter` interface: async `read(key)`, `write(key, value)`, `clear(key)` for Uint8Array values.

`ReactiveStorageAdapter` extends `StorageAdapter` with `subscribe(key, callback)` for per-key change notifications.
Listeners fire synchronously on `write` (with the new value) and `clear` (with `undefined`). Used by the SSO session
manager to watch for session changes.

- `createMemoryStorageAdapter()`: Map-backed, for testing. Returns `ReactiveStorageAdapter`.
- `createLocalStorageAdapter(prefix)`: browser localStorage, base64, prefix-scoped. Returns `ReactiveStorageAdapter`.

### 2.4 Auth (`auth/`)

**`authManager.ts`**: State machine: `idle -> pairing -> attesting -> authenticated -> idle` (back to idle via
`clearSession()`). Any state can go to `error`. Pub-sub via `subscribe(callback)`. `getSession()` returns session if
authenticated. `AuthStatus` type (`AuthState['status']`) is derived from the `AuthState` union, giving
`'idle' | 'pairing' | 'attesting' | 'authenticated' | 'error'`. Used by `subscribeAuthStatus` and
`HandlersConfig.subscribeAuthState`.

**`hdkd.ts`**: Sr25519 hierarchical deterministic key derivation, wrapping `@polkadot-labs/hdkd-helpers`' `createDerive`
for path parsing and chain code encoding. Two functions: `sr25519DeriveSecret(miniSecret, path)` for secret-key
derivation (hard + soft junctions) and `sr25519DerivePublicKey(publicKey, path)` for public-key derivation (soft only).

**`crypto.ts`**: `deriveProductPublicKey(rootPublicKey, productId, derivationIndex)`: thin wrapper that builds the soft
derivation path `/product/{productId}/{derivationIndex}` and delegates to `sr25519DerivePublicKey`.

**`pappAdapter.ts`**: Stub interface for QR-code pairing (to be ported from old host-papp).

**`sso/transport.ts`**: SSO adapter interfaces:

- `SsoSigner`: sr25519 signing for statement proofs (`publicKey`, `sign(message)`).
- `SsoSessionStore`: persistence for session metadata (`save`, `load`, `clear`, `subscribe`).
- `PersistedSessionMeta`: minimal session data surviving page reloads (sessionId, address, displayName, remote keys).

The statement store transport is now in `statementStore/` (section 2.5) as a unified adapter serving both SSO and the
host API statement store handlers.

**`sso/sessionStore.ts`**: `createSsoSessionStore(storage)` — backed by a `ReactiveStorageAdapter`. Serializes
`PersistedSessionMeta` to JSON bytes. Subscriptions delegate to the underlying reactive storage.

**`sso/manager.ts`**: `createSsoManager(config)` — drives the QR-based pairing lifecycle:

- State machine: `idle` -> `pairing` -> `awaiting_scan` -> `paired`, with `failed` on error.
- `pair()`: delegates to an injected `PairingExecutor` which handles the cryptographic handshake.
- `cancelPairing()`: aborts in-progress pairing via `AbortController`.
- `unpair()`: clears persisted session and transitions to `idle`.
- `restoreSession()`: loads a persisted session and transitions directly to `paired`.
- `subscribe(callback)`: fires on every state transition.
- `PairingExecutor` is the pluggable crypto protocol — implementations handle mnemonic generation, P-256 ECDH,
  statement-store key exchange, and attestation. The manager only drives the state machine and persistence.

**`sso/signing.ts`**: `createRemoteSigner(config)` — routes sign requests through the SSO transport to the paired mobile
wallet:

- `signPayload(request)` / `signRaw(request)`: guards that the manager is paired, delegates to an injected
  `SignRequestExecutor` (which handles AES encryption, statement framing, and response correlation), and applies a
  configurable timeout (default 90s).
- `SignRequestExecutor` is the pluggable crypto layer — implementations encrypt the payload with the session key,
  publish to the statement-store topic, wait for the wallet's signed response, and decrypt it.
- `RemoteSigner` can be wired as the `onSignPayload`/`onSignRaw` callbacks in `HandlersConfig`.

**`sso/crypto.ts`**: SSO cryptographic primitives — all wire-compatible with triangle-js-sdks:

- `createEncryption(sharedSecret)`: AES-GCM with HKDF-SHA256 key derivation (32-byte key, 12-byte nonce, wire format
  `[nonce || ciphertext]`).
- `khash(secret, message)`: blake2b-256 with key — used for topic and session ID derivation.
- `createSr25519Secret(entropy, derivation?)`: sr25519 key from BIP-39 entropy with optional HDKD path.
- `createP256Secret(entropy)`, `getP256PublicKey(secret)`, `createP256SharedSecret(secret, publicKey)`: P-256 ECDH for
  the pairing handshake. Shared secret = x-coordinate only (32 bytes).
- `createAccountId(publicKey)`: blake2b-256 of sr25519 public key.
- `deriveHandshakeTopic(accountId, encrPublicKey)`: derives the statement-store topic for pairing.

**`sso/codecs.ts`**: SCALE codecs for SSO messages — must be byte-identical to triangle-js-sdks:

- `HandshakeData` / `HandshakeResponsePayload` / `HandshakeResponseSensitiveData`: pairing handshake messages.
- `SigningPayloadRequestCodec` / `SigningRawRequestCodec` / `SigningResponseCodec`: signing request/response.
- `RemoteMessageCodec`: versioned envelope `{ messageId, data: v1 { Disconnected | SignRequest | SignResponse } }`.

**`sso/attestation.ts`**: `runAttestation(candidate, getUnsafeApi, signal)` — registers a lite person on the People
pallet. Lazy-loads `verifiablejs` WASM (5.8 MB Bandersnatch ring-VRF), derives VRF key and proof-of-ownership, builds
consumer registration signature, submits `PeopleLite.attest` extrinsic with custom signed extensions
(`VerifyMultiSignature`, `AsPerson`). Uses a hardcoded sudo Alice verifier (testnet only).

**`sso/pairingExecutor.ts`**: `createPairingExecutor(config)` — concrete `PairingExecutor` implementing the full QR-code
handshake: generates mnemonic, derives sr25519 at `//wallet//sso` + P-256 keys, builds SCALE-encoded `HandshakeData`,
publishes to statement-store topic, waits for mobile response, performs P-256 ECDH to decrypt session credentials. When
`config.getUnsafeApi` is provided, runs attestation in parallel with the handshake — both must complete before the
session is returned.

**`sso/signRequestExecutor.ts`**: `createSignRequestExecutor(config)` — concrete `SignRequestExecutor` implementing
encrypted sign request round-trips: SCALE-encodes `RemoteMessage` with `SignRequest`, encrypts with AES-GCM session key,
publishes to session topic, waits for `SignResponse` matching the message ID, decrypts and returns signature.

**`identity/types.ts`**: `IdentityProvider` interface (`getIdentity(accountIdHex)`) and `ResolvedIdentity` type
(liteUsername, fullUsername, chainIdentity). Implementations query a chain (e.g. People parachain's
`Resources.Consumers` storage) and return structured identity data.

**`identity/resolver.ts`**: `createIdentityResolver(provider)` — wraps an `IdentityProvider` with in-memory caching and
concurrent-request deduplication. Failed requests are not cached so transient errors are retried. Supports
`invalidate(accountId)` and `invalidateAll()` for cache control.

### 2.5 Statement Store (`statementStore/`)

Unified statement-store parachain adapter used by both SSO (pairing/signing) and the host API statement store handlers.

**`statementStore/types.ts`**: `StatementStoreAdapter` interface with `subscribe(topics, callback)`,
`submit(statement)`, and `query(topics)`. `Statement` and `SignedStatement` types with tagged `StatementProof` union
(sr25519/ed25519/ecdsa).

**`statementStore/chainClient.ts`**: `createChainClient(provider)` — creates a lazy polkadot-api client from any
`JsonRpcProvider`. The provider is transport-agnostic: it can be a WebSocket connection (via `getWsProvider`) or a
Smoldot light client (via `getSmProvider`). The polkadot-api client is created on first use. Returns `ChainClient` with:

- `statementStore`: the `StatementStoreAdapter` (for SSO and host API handlers)
- `getUnsafeApi()`: polkadot-api unsafe API (for identity resolution via `Resources.Consumers`)
- `dispose()`: tears down the connection

Uses `polkadot-api`'s `_request`/`_subscribe` escape hatches for direct `statement_submit` and
`statement_subscribeStatement` RPC access, and the same client's typed/untyped API for storage queries.

**`statementStore/codec.ts`**: SCALE encode/decode for Substrate statements. Statements are encoded as a `Vector` of
`Variant` fields in strictly ascending index order (proof=0, decryptionKey=1, expiry=2, channel=3, topic1–4=4–7,
data=8). Only present fields are included. Topics are expanded from an array into individual `topic1`..`topic4` entries.

**`testing/memoryStatementStore.ts`**: `createMemoryStatementStore()` — in-memory `StatementStoreAdapter` for testing.
All adapters created from the same factory share a single in-memory bus.

### 2.6 Webview Port

`acquireWebviewPort({ webview, openDevTools? })` acquires a `MessagePort` by creating a `MessageChannel`, injecting one
end into an Electron `<webview>` via `executeJavaScript` on `dom-ready`, and returning the other end. The returned port
is passed to `createHostFacade` via `messaging: { type: 'messagePort', port }`.

### 2.6 Nested Bridge (`nested/`)

**`detector.ts`**: `setupNestedBridgeDetector()`: listens for postMessage from windows OTHER than the primary iframe.
Auto-creates `createHostFacade` + `wireAllHandlers` bridge for each nested dApp.

### 2.7 SDK Entry Point (`sdk.ts`)

```typescript
const sdk = createHostSdk({
  appId: 'dot.li',
  statementStoreProvider: getWsProvider(PEOPLE_PARACHAIN_ENDPOINTS),
  pairingMetadata: 'https://dot.li/metadata.json',
  chainProvider: genesisHash => getSmoldotProvider(genesisHash),
});

const product = sdk.embed(iframeElement, 'https://dapp.example.com');
product.dispose();
sdk.dispose();
```

When `statementStoreProvider` is provided, `createHostSdk` internally creates:

- `ChainClient` from the provider (transport-agnostic — works with WebSocket or Smoldot)
- `SsoManager` with `PairingExecutor`, `SsoSessionStore`, and `SecretStore` (for session reconnection)
- `IdentityResolver` backed by `createChainIdentityProvider` (queries `Resources.Consumers`)
- Statement store handlers are wired to the `ChainClient`'s adapter

The SSO manager auto-restores persisted sessions on creation. SSO state changes are synced to the `AuthManager`.

On pairing success or session restore, the SDK builds a `RemoteSigner` from the persisted secrets (derives sr25519
signer from `ssSecret`, uses the persisted `sessionKey` as the AES session key). If the host app does not provide
`onSignPayload` / `onSignRaw` callbacks, the SDK defaults to routing sign requests through the `RemoteSigner` →
`SignRequestExecutor` → encrypted statement-store channel → mobile wallet.

Statement store `handleStatementStoreCreateProof` is wired to sign with the sr25519 key when available.

`clearSession()` calls `ssoManager.unpair()` to clear both session metadata and secrets.

**`types.ts`**: `HostSdkConfig` with all options: `appId`, `statementStoreProvider`, `pairingMetadata`, `chainProvider`,
signing callbacks, permission callbacks, UI callbacks.

**`constants.ts`**: `PEOPLE_PARACHAIN_ENDPOINTS` — default WebSocket endpoints for the People parachain (POP3 testnet).

**`sso/secretStore.ts`**: `createSecretStore(storage)` — persists `{ ssSecret, encrSecret, entropy }` keyed by session
ID. Used by the manager to persist secrets on pairing and load them on `restoreSession()`.

**`identity/chainProvider.ts`**: `createChainIdentityProvider(getUnsafeApi)` — concrete `IdentityProvider` that queries
`Resources.Consumers` on the People parachain via polkadot-api's unsafe API.

---

## Part 3: `@polkadot/product`

Domain modules that run inside the iframe. Every module takes a required `ProductFacade` parameter (from
`@polkadot/api-protocol`). No module imports `Transport` directly.

**Product logger** (`logger.ts`): `productLogger` is a standalone singleton that any product code imports directly.
`setProductLogger(logger)` swaps the backing implementation -- useful for routing log output to a debug UI overlay
instead of the console.

### 3.1 Accounts (`accounts.ts`)

`createAccountsProvider(hostApi)`:

- `getProductAccount(dotNsIdentifier, derivationIndex?)` -> `hostApi.accountGet`
- `getProductAccountAlias(dotNsIdentifier, derivationIndex?)` -> `hostApi.accountGetAlias`
- `getNonProductAccounts()`
- `createRingVRFProof(dotNsIdentifier, derivationIndex, location, message)` -> `hostApi.accountCreateProof`
- `getProductAccountSigner(account)` -> returns signer routing signing through `hostApi`
- `getNonProductAccountSigner(account)` -> same signing interface for non-product accounts
- `subscribeAccountConnectionStatus(callback)`

### 3.2 Chain (`chain.ts`)

The most complex file (~580 lines). `createPapiProvider(genesisHash, hostApi, fallback?)` returns a standard
`JsonRpcProvider` compatible with Polkadot API (PAPI). Uses `hostApi.whenReady()` for lifecycle and `productLogger` for
diagnostics.

When PAPI calls `send('{"method":"chainHead_v1_follow",...}')`: parses JSON-RPC, maps to `hostApi` method, converts
parameters, converts response back to JSON-RPC. Handles all `chainHead_v1_*`, `chainSpec_v1_*`, `transaction_v1_*`
methods.

### 3.3 Storage (`storage.ts`)

```typescript
const storage = createLocalStorage(hostApi);
await storage.writeString('key', 'value');
await storage.writeJSON('settings', { theme: 'dark' });
const val = await storage.readString('key');
```

`createLocalStorage(hostApi)` wraps `hostApi.localStorageWrite/Read/Clear` with convenience methods (`readBytes`,
`writeBytes`, `clear`, `readString`, `writeString`, `readJSON`, `writeJSON`).

### 3.4 Chat, Statement Store, Preimage

**`chat.ts`**: three exports:

- `createProductChatManager(hostApi)`: pure client -- `registerRoom`, `registerBot`, `sendMessage`, `subscribeChatList`,
  `subscribeAction`.
- `handleCustomMessageRendering(callback, hostApi)`: standalone function that registers the product-side handler for
  custom chat message rendering -- the one protocol method where the product is the handler rather than the initiator.
  Uses `hostApi.handleHostSubscription()` so it does not need a `Transport` reference. Separated from the chat manager
  because handler registration is a setup-time concern, not a domain operation.
- `matchChatCustomRenderers(map)`: utility that dispatches to a specific renderer based on the `messageType` field.

**`statementStore.ts`**: `createStatementStore(hostApi)`: subscribe to topics, create proofs, submit statements.

**`preimage.ts`**: `createPreimageManager(hostApi)`: lookup subscriptions, submit preimages.

All domain modules take a required `ProductFacade` parameter. None import `Transport` directly.

### 3.5 Extension (`extension.ts`)

`createNonProductExtensionEnableFactory(hostApi)` creates an `enable` function that returns a polkadot-js compatible
`Injected` object for **non-product accounts**. Provides `accounts.get()` (via `hostApi.getNonProductAccounts`),
`signer.signPayload()`, `signer.signRaw()`, and `signer.createTransaction()` (via
`hostApi.createTransactionWithNonProductAccount`). Returns `undefined` if the transport is not ready.

`injectSpektrExtension(hostApi)` uses the factory above to inject the extension into the global polkadot-js registry.
Any dApp using `@polkadot/extension-dapp` discovers it as `"spektr"`. Returns `true` if injection succeeded, `false`
otherwise.

### 3.6 Constants (`constants.ts`)

`WellKnownChain` (genesis hashes for Polkadot relay + asset hub, Kusama relay + asset hub, Westend relay + asset hub,
and Rococo relay), `SpektrExtensionName = 'spektr'`.

---

## Part 4: Tests

### 4.1 Unit Tests (22 files, 299 tests)

**Test helper** (`test/helpers/mockProvider.ts`): creates connected mock Provider pairs (async and sync variants).

**Shared** (6 files):

- `transport.spec.ts` (22 tests): handshake, request/response correlation, subscriptions, multiplexing, connection
  status, destroy, codec swap, not-supported catch-all (request rejection, subscription interrupt, handler
  deregistration), auto-detect codec (SCALE decode, structured clone decode, outgoing auto-upgrade)
- `negotiation.spec.ts` (5 tests): upgrade succeeds, fails gracefully, picks best intersection, requests work after
  upgrade, not-supported fast path (near-instant rejection instead of 1s timeout)
- `messagePortProvider.spec.ts` (16 tests): sync/async port delivery, message validation (protocol messages, Uint8Array,
  rejection of invalid data), postMessage with/without buffer transfer, subscribe/unsubscribe, dispose lifecycle
- `codec.spec.ts` (6 tests): structured clone round-trips, rejects Uint8Array, nested objects
- `protocol.spec.ts` (18 tests): all methods present in hostApiProtocol, correct types, error type construction
- `util.spec.ts` (24 tests): logger, createIdFactory, delay, promiseWithResolvers, composeAction, toHexString

**Host** (10 files):

- `handlers.spec.ts` (12 tests): featureSupported, navigateTo, pushNotification, permissions, storage adapter delegation
- `authManager.spec.ts` (14 tests): full state machine, subscribe/unsubscribe
- `storage.spec.ts` (19 tests): memory adapter CRUD, prefix isolation, reactive subscriptions (write/clear
  notifications, unsubscribe, multiple listeners, key isolation)
- `rateLimiter.spec.ts` (10 tests): drop/queue strategies
- `sdk.spec.ts` (7 tests): construction, session management
- `ssoTransport.spec.ts` (15 tests): memory transport bus (topic matching, cross-transport delivery, unsubscribe,
  multi-subscriber), session store (CRUD, round-trip serialization, reactive subscriptions, Uint8Array preservation)
- `ssoManager.spec.ts` (17 tests): state machine lifecycle (idle -> pairing -> awaiting_scan -> paired), cancellation,
  failure handling, session persistence, session restore, dispose, subscribe/unsubscribe
- `ssoSigning.spec.ts` (9 tests): paired guard, signPayload/signRaw delegation, timeout, executor error propagation,
  signedTransaction passthrough
- `identityResolver.spec.ts` (10 tests): delegation, caching (hit/miss/undefined), invalidation (single/all), concurrent
  deduplication, error propagation, transient error retry
- `ssoCrypto.spec.ts` (26 tests): AES-GCM encryption round-trip (empty/large/wrong key), khash determinism, accountId
  derivation, handshake topic, sr25519 key derivation (base/derived paths), P-256 ECDH symmetry, mnemonic generation,
  SCALE codec round-trips (HandshakeData, RemoteMessage, disconnect)

**Product** (4 files):

- `hostApi.spec.ts` (3 tests): ProductFacade transport proxy methods via real MessageChannel: whenReady,
  handleHostSubscription registration and unsubscribe
- `chat.spec.ts` (3 tests): handleCustomMessageRendering via real MessageChannel: handler registration, render function
  delivery, unsubscribe deregistration
- `constants.spec.ts` (13 tests): all chains present, hex format
- `storage.spec.ts` (3 tests): API shape verification

### 4.2 E2E Tests (1 file, 51 tests)

Playwright + headless Chromium. A Vite dev server serves two pages: host (creates `createHostFacade` + `wireAllHandlers`
with mock implementations) and product (inside iframe with its own Transport). Real `postMessage` across the iframe
boundary.

Every test runs three times via `?codec=` query parameter:

- **`structured_clone`**: host registers codec upgrade support, product auto-upgrades after handshake, all requests run
  over structured clone
- **`scale`**: host does not register codec upgrade support, product's upgrade attempt fails (not-supported catch-all),
  both sides stay on SCALE
- **`upgrade`**: same as `structured_clone` but the product explicitly calls `requestCodecUpgrade` after handshake to
  trigger the negotiation flow

**Happy-path tests** (12 per codec): handshake, feature check (known chain true + unknown chain false), account get,
non-product accounts, sign payload, sign raw, localStorage write/read/clear, connection status subscription, navigate,
device permission, multiple sequential requests.

**Error-path tests** (5 per codec): sign payload rejected (`Rejected` tag, no value), create transaction not supported
(`NotSupported` tag with string value), account get alias unknown (`Unknown` tag with `{reason}` struct), navigate to
permission denied (`PermissionDenied` tag, no value), storage write full (`Full` tag, no value). These verify that
`Result` error envelopes (`success: false`) with plain `{tag, value}` discriminated unions survive the round-trip
through encoding, iframe boundary, and decoding across all three codec modes.

---

## Part 5: Data Flow Example

**Product requests an account:**

```
Product: accounts.getProductAccount('myApp', 0)
  -> hostApi.accountGet({ tag: 'v1', value: ['myApp', 0] })
  -> transport.request('host_account_get', payload)
    -> nextId() -> "p:1"
    -> codecAdapter.encode({
         requestId: "p:1",
         payload: { tag: "host_account_get_request", value: {tag:'v1', value:['myApp',0]} }
       })
    -> provider.postMessage(data)  // Uint8Array if SCALE, plain object if structured clone
    -> window.top.postMessage(data, '*')

       -- crosses iframe boundary --

Host: windowProvider receives MessageEvent
  -> validates source === iframe.contentWindow
  -> decodeIncoming(data)  // auto-detects: Uint8Array → SCALE, object → structured clone
  -> transport dispatches: tag matches "host_account_get_request", requestId "p:1"
  -> protocolHandler.wireRequest unwraps v1 -> ['myApp', 0]
  -> handleAccountGet(['myApp', 0]) runs
    -> derives product public key via HDKD
    -> okAsync({ publicKey: <derived>, name: 'Alice' })
  -> protocolHandler wraps -> { tag:'v1', value: { success: true, value: {publicKey, name} } }
  -> transport.postMessage("p:1", { tag: "host_account_get_response", value: ... })
  -> codecAdapter.encode -> iframe.contentWindow.postMessage

       -- crosses back --

Product: provider receives
  -> decodeIncoming(data)  // auto-detects format
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
   |--- codec_upgrade_request -------->|  (SCALE encoded)
   |    { supportedFormats:            |
   |      ['structured_clone','scale'] }|
   |                                   |  host swaps outgoing to struct clone
   |<-- codec_upgrade_response --------|  (struct clone encoded!)
   |    { selectedFormat:              |
   |      'structured_clone' }         |
   |                                   |
   |  product decodeIncoming detects   |
   |  struct clone -> auto-upgrades    |
   |  outgoing codec                   |
   |                                   |
   |--- account_get (struct clone) --->|
   |<-- account_response (struct) -----|
```

The host swaps its outgoing codec BEFORE sending the response, so the response itself arrives as structured clone. The
product's `decodeIncoming` detects the format change and auto-upgrades. Even if the product's 1s timeout fired first,
the auto-detect ensures both sides converge.

If the host is old (`triangle-js-sdks`), it silently ignores the upgrade request. With our transport, the not-supported
catch-all responds immediately with `MethodNotSupportedError` so the product doesn't wait the full timeout. With
`triangle-js-sdks` hosts (no catch-all), the request times out after 1 second. Either way, both sides stay on SCALE.
