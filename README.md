# host-product-sdk

This project is experimental. It serves as a playground for exploring the architecture of the Product SDK and Host SDK in interaction with the Host API.

The three packages in this repo map to the three layers of the Host-Product architecture:

- `packages/shared`: Host API definition (versioned, SCALE-encoded)
- `packages/host`: Host SDK
- `packages/product`: Product SDK

For a detailed walkthrough of the code in this repo, see [ARCHITECTURE.md](./ARCHITECTURE.md).

## Host API Differences from [triangle-js-sdks](https://github.com/paritytech/triangle-js-sdks)

This project reimplements the same Host API with a different set of architectural choices. The wire format is identical and the two implementations are compatible. The main differences:

### Fewer, larger packages

triangle-js-sdks splits the codebase into ~11 packages (host-api, host-container, host-chat, host-papp, product-sdk, scale, statement-store, storage-adapter, etc.). This project consolidates everything into three packages that map directly to the three architectural layers. Domain-specific code (chat, statement store, chain interaction) lives as modules within the appropriate package rather than as separate packages.

### Pluggable codec with runtime negotiation

triangle-js-sdks hard-codes SCALE as the wire codec in the transport layer. This project introduces a `CodecAdapter` abstraction that decouples encoding from transport. Two adapters exist: SCALE (binary) and structured clone (pass-through, letting the browser's built-in `postMessage` serialization do the work instead of encoding/decoding SCALE). After the handshake, the product can request a codec upgrade; both sides negotiate the best common format and hot-swap the adapter at runtime. Old hosts that do not support negotiation simply time out and both sides stay on SCALE.

### Inlined codec primitives

triangle-js-sdks depends on `@novasamatech/scale` for codec helpers like `ErrEnum`, `Err`, and various utilities. This project inlines those primitives (~170 lines in `codec/scale/primitives.ts`), removing the external dependency. The inlined versions produce plain `{tag, value}` discriminated unions rather than `CodecError` class instances.

### Plain error objects instead of error classes

triangle-js-sdks uses `ErrEnum()` and `Err()` to create Error subclasses with `.name`, `.instance`, and `.payload` properties. Error messages are baked into the codec definition. Errors are class instances that support `instanceof` checks. This project uses plain `{tag, value}` discriminated unions for errors. They work naturally with `neverthrow`'s `.match()` and survive structured clone (which strips custom Error properties). TypeScript narrows the `value` type when the `tag` is checked, so type safety is preserved without a class hierarchy.

### Explicit protocol registry

triangle-js-sdks uses factory functions (`versionedRequest()`, `versionedSubscription()`) to build the protocol registry from `[request, response]` tuples. This project writes out the registry as a plain object literal with explicit `_request`/`_response` and `_start`/`_receive` keys. More verbose, but the structure is visible without jumping to helper function definitions.

### Prefix-based request IDs

triangle-js-sdks generates random request IDs using `nanoid`. This project uses a prefix-based counter (`createIdFactory('p:')` produces `'p:1'`, `'p:2'`, etc.). The host uses prefix `'h:'`, the product uses `'p:'`, so IDs never collide on the shared postMessage channel. This is more deterministic and easier to trace in logs.

### Richer provider interface

triangle-js-sdks defines a minimal provider (just `postMessage` and `subscribe`). This project adds a scoped `logger` instance and an explicit `dispose()` method for lifecycle cleanup.

### Self-contained handshake

triangle-js-sdks requires the handshake handler to be registered externally. This project auto-registers the handshake handler inside the transport when it detects it is on the host side, making the transport more self-contained.

### Stronger end-to-end type safety

In this project, the `hostApiProtocol` object (declared `as const`) is the single source from which mapped types like `RequestParams<M, V>`, `ResponseOk<M, V>`, and `ResponseErr<M, V>` are extracted. These same types are used for container handler signatures on the host side and for the facade return types on the product side. This means the types that flow through the SCALE codec are mechanically the same types that the handler receives and that the product facade returns. If a codec definition changes, TypeScript catches mismatches everywhere.

triangle-js-sdks has no such mechanism. The SCALE codec definitions exist, but handler functions are not typed against them. A handler can accept one shape while the codec actually produces a different shape, and nothing catches this at compile time. The wiring between what the codec encodes/decodes and what the handler expects is based on convention, not enforced by the type system.

### Version dispatch via handler map

In this project, `wireRequest` and `wireSubscription` accept a version handler map: `{ v1: handlerV1, v2: handlerV2 }`. The transport extracts the version tag from the incoming message, looks up the matching handler, unwraps the versioned envelope before calling it, and re-wraps the response with the same version tag. Adding a v2 means adding an entry to the map; existing v1 handlers remain untouched. If no handler matches the version, a default error is returned.

In triangle-js-sdks, version handling is hardcoded. Each handler is registered with an inline `guardVersion(message, 'v1', error)` call that checks for a specific version string literal. There is no version handler map. Adding a v2 would require duplicating the handler registration and dispatch logic for each method. The version tag is also manually re-wrapped on every response using `enumValue('v1', ...)`.

On the product (receiving) side the difference is similar. In this project, the product facade strips the version envelope entirely: callers get clean unwrapped values, and for subscriptions the version tag is verified before the callback is invoked. In triangle-js-sdks, the version tag is passed through to the caller as a `{ tag, value }` wrapper. The caller has to deal with versioned envelopes themselves. Neither requests nor subscriptions verify that the response version matches what was sent.

### Not-supported catch-all

The transport tracks which actions have registered handlers. Unhandled `_request` messages receive an immediate `NOT_SUPPORTED` response (the sender's `request()` rejects with `MethodNotSupportedError`). Unhandled `_start` messages receive an immediate `_interrupt`. In triangle-js-sdks, requests or subscriptions to unhandled methods hang silently with no response, potentially blocking the caller forever.

### Simpler handler dispatch

triangle-js-sdks dispatches handlers through monadic chains (`guardVersion().asyncMap().andThen().orElse().unwrapOr()`). Handlers receive a context object `(params, ctx) => ctx.ok(value)` where `ctx.ok` and `ctx.err` are typed as `any`, erasing type safety at the handler boundary. This project's handlers return `ResultAsync` directly: `(params) => okAsync(value)`. The return type is fully constrained by the protocol codecs, so there is no context object and no type erasure. The container wiring uses `result.match()` with explicit `wrapOk`/`wrapErr` helpers instead of monadic chains.
