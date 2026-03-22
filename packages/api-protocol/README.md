# @polkadot/api-protocol

The protocol package defines the API between host and product, the transport layer for exchanging typed messages, and a
facade for each side. It is the shared foundation that both `@polkadot/host` and `@polkadot/product` depend on.

## Structure

### `api/` — API definition

The core of the project. Defines _what_ the protocol is:

- **`protocol.ts`** — `hostApiProtocol`: the registry of all 45 versioned protocol methods, each with SCALE codec pairs
  (`_request`/`_response` or `_start`/`_receive`). Also defines `MessagePayload`, `Message` (the wire envelope), and all
  derived mapped types (`RequestMethod`, `RequestCodecType<M>`, `RequestParams<M,V>`, `ResponseOk<M,V>`, etc.) that
  provide end-to-end type safety.
- **`types.ts`** — Domain types (Account, SigningResult, ChainHeadEvent, etc.) derived from the SCALE codecs via
  `CodecType<>`. The single source of truth for all handler and facade signatures.

### `shared/` — Transport and codec infrastructure

The machinery that moves messages between host and product:

- **Codec adapters** (`codec/`) — `CodecAdapter` interface, SCALE adapter (`codec/scale/adapter.ts`), structured clone
  adapter (`codec/structured/`), and codec negotiation logic (`codec/negotiation.ts`).
- **SCALE primitives** (`codec/scale/primitives.ts`) — Inlined codec helpers (`Hex`, `Status`, `lazy`, `OptionBool`).
- **V1 building-block codecs** (`codec/scale/v1/`) — 16 files defining the domain-specific SCALE codecs that
  `api/protocol.ts` composes into the protocol registry.
- **Transport** (`transport/`) — The `Transport` engine (request/response correlation, subscription multiplexing,
  handshake with `'initiate'`/`'respond'` roles, not-supported catch-all) and two `Provider` implementations:
  `createWindowProvider` (postMessage to a Window) and `createMessagePortProvider` (MessagePort).
- **Utilities** (`util/`) — Logger, ID factory, helpers.

### `host-facade/` — Host-side facade

`createHostFacade(options)` builds the host-side communication stack. Takes a `messaging` option
(`{ type: 'window', target }` or `{ type: 'messagePort', port }`) and an optional `allowCodecUpgrade` boolean. Returns a
`HostFacade` with ~40 `handle*()` methods for product-initiated requests/subscriptions, plus `renderChatCustomMessage`
for the one host-initiated subscription.

Internally creates a provider, transport (`handshake: 'respond'`, `idPrefix: 'h:'`), and wires version dispatch via
`wireRequest`/`wireSubscription` helpers. Also includes `connectionManager.ts` for managing real JSON-RPC connections
per chain.

### `product-facade/` — Product-side facade

`createProductFacade(options)` builds the product-side communication stack. Takes the same `messaging` option. Returns a
`ProductFacade` that wraps every protocol method with version tagging/untagging, returns `ResultAsync` for requests and
`Subscription` for subscriptions. `whenReady()` resolves when the handshake and codec upgrade are complete.

Internally creates a provider, transport (`handshake: 'initiate'`, `idPrefix: 'p:'`), and automatically attempts a codec
upgrade to structured clone after the handshake.

## Relationship to other packages

- **`@polkadot/host`** imports from `@polkadot/api-protocol` and adds the SDK entry point (`createHostSdk`), handler
  implementations, auth, storage adapters, webview port acquisition, and the nested bridge.
- **`@polkadot/product`** imports from `@polkadot/api-protocol` and adds domain modules (accounts, chain, chat, storage,
  extension) that consume the `ProductFacade` exclusively.
