# @polkadot/host-api

The Host API package defines the protocol layer for host-product communication. It contains everything needed to
establish a connection between a host application and an embedded product (dApp), exchange typed messages, and negotiate
codecs.

## Structure

The package is organised into three layers:

### `shared/` -- Protocol, codecs, transport, utilities

The foundation that both sides depend on:

- **Protocol codecs** (`codec/`) -- SCALE and structured clone encoders/decoders, codec negotiation logic, and the
  `hostApiProtocol` registry that defines all ~44 versioned protocol methods.
- **Transport** (`transport/`) -- The `Transport` engine (request/response correlation, subscription multiplexing,
  handshake, not-supported catch-all) and two neutral `Provider` implementations: `createWindowProvider` (postMessage to
  a Window) and `createMessagePortProvider` (communicate over a MessagePort).
- **Protocol types** (`protocol/`) -- TypeScript types derived from the SCALE codec definitions. Single source of truth
  for all handler signatures.
- **Utilities** (`util/`) -- Logger, ID factory, helpers.

### `host/` -- Host-side protocol handler

Code that runs on the host page to bridge protocol messages to handler implementations:

- **`protocolHandler.ts`** -- Creates a `Transport`, wires the `wireRequest`/`wireSubscription` version-dispatch
  helpers, and exposes the `ProtocolHandler` interface with ~40 `handle*()` methods.
- **`types.ts`** -- The `ProtocolHandler` type definition, with handler signatures derived from the protocol codecs.
- **`webviewProvider.ts`** -- `createHostWebviewProvider`: acquires a MessagePort by injecting into an Electron webview,
  then delegates to `createMessagePortProvider`.
- **`connectionManager.ts`** -- Manages real JSON-RPC connections per chain (connection pooling, follow multiplexing,
  request correlation).

### `product/` -- Product-side facade

Code that runs inside the embedded iframe/webview:

- **`hostApi.ts`** -- The `HostApi` facade: wraps every protocol method with version tagging/untagging, returns
  `ResultAsync` for requests and `Subscription` for subscriptions. Also proxies transport lifecycle (`isReady`,
  `isCorrectEnvironment`, `logger`, `handleHostSubscription`) so that downstream domain modules never need a `Transport`
  reference.
- **`sandboxTransport.ts`** -- Detects the environment (iframe or webview), creates the appropriate provider from shared
  building blocks, and sets up the transport singleton with automatic codec upgrade after handshake.

## Relationship to other packages

- **`@polkadot/host`** imports from `@polkadot/host-api` and adds the SDK entry point (`createHostSdk`), handler
  implementations, auth, storage adapters, and the nested bridge.
- **`@polkadot/product`** imports from `@polkadot/host-api` and adds domain modules (accounts, chain, chat, storage,
  etc.) that consume the `HostApi` facade exclusively.
