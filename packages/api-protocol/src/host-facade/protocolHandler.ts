/**
 * HostFacade factory.
 *
 * Creates a HostFacade that bridges host and product via a Transport.
 * Each handler method translates between the versioned wire format
 * (v1 tagged enums with Ok/Err results) and plain TypeScript types.
 *
 * Ported from triangle-js-sdks host-container/createHostFacade.ts,
 * simplified to use plain Result objects instead of neverthrow.
 */

import type {
  RequestMethod,
  SubscriptionMethod,
  RequestVersions,
  StartVersions,
  RequestCodecType,
  ResponseCodecType,
  StartCodecType,
  ReceiveCodecType,
  RequestParams,
  ResponseOk,
  ResponseErr,
  SubscriptionParams,
  SubscriptionPayload,
} from '../api/protocol.js';
import type { GenericErr } from '../api/types.js';
import type { Messaging } from '../shared/transport/provider.js';
import { createTransport } from '../shared/transport/transport.js';
import { createWindowProvider } from '../shared/transport/windowProvider.js';
import { createMessagePortProvider } from '../shared/transport/messagePortProvider.js';
import { handleCodecUpgrade } from '../shared/codec/negotiation.js';
import { scaleCodecAdapter } from '../shared/codec/scale/adapter.js';
import { structuredCloneCodecAdapter } from '../shared/codec/structured/index.js';
import type { ResultAsync } from 'neverthrow';

import { createChainConnectionManager } from './connectionManager.js';
import type { HostFacade } from './types.js';

// ---------------------------------------------------------------------------
// Wire format helpers
// ---------------------------------------------------------------------------

const UNSUPPORTED_MESSAGE_FORMAT_ERROR = 'Unsupported message format';

/** Wraps a value in a versioned envelope with Ok result. */
function wrapOk<V extends string, T>(version: V, value: T): { tag: V; value: { success: true; value: T } } {
  return { tag: version, value: { success: true, value } };
}

/** Wraps an error in a versioned envelope with Err result. */
function wrapErr<V extends string, E>(version: V, error: E): { tag: V; value: { success: false; value: E } } {
  return { tag: version, value: { success: false, value: error } };
}

/** Wraps a value in a versioned envelope (no result wrapping, for subscriptions). */
function wrap<V extends string, T>(version: V, value: T): { tag: V; value: T } {
  return { tag: version, value };
}

/** Extract the inner value from a versioned envelope for a specific version tag. */
function unwrap<M extends { tag: string; value: unknown }, V extends M['tag']>(
  message: M,
  version: V,
): { ok: true; value: Extract<M, { tag: V }>['value'] } | { ok: false } {
  if (message.tag === version) {
    return { ok: true, value: message.value as Extract<M, { tag: V }>['value'] };
  }
  return { ok: false };
}

function genericError(reason: string): GenericErr {
  return { reason };
}

// ---------------------------------------------------------------------------
// HostFacade options
// ---------------------------------------------------------------------------

export type CreateHostFacadeOptions = {
  /** How the host communicates with the product. */
  messaging: Messaging;

  /**
   * Whether to allow the product to upgrade the codec after handshake.
   * When `true` (the default), the host registers a codec upgrade handler
   * that negotiates structured clone as the preferred format.
   */
  allowCodecUpgrade?: boolean;
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createHostFacade(options: CreateHostFacadeOptions): HostFacade {
  const { messaging, allowCodecUpgrade = true } = options;

  const provider =
    messaging.type === 'window' ? createWindowProvider(messaging.target) : createMessagePortProvider(messaging.port);

  const transport = createTransport({
    provider,
    handshake: 'respond',
    idPrefix: 'h:',
  });

  // Auto-register codec upgrade handler.
  let cleanupCodecUpgrade: (() => void) | undefined;
  if (allowCodecUpgrade) {
    cleanupCodecUpgrade = handleCodecUpgrade(transport, {
      scale: scaleCodecAdapter,
      structured_clone: structuredCloneCodecAdapter,
    });
  }

  // -- Request handler wiring helper ----------------------------------------

  /**
   * Handler type for a request method at a specific version.
   * Version V governs both the request params and the response ok/err types.
   */
  type RequestVersionHandler<M extends RequestMethod, V extends string> = (
    params: RequestParams<M, V>,
  ) => ResultAsync<ResponseOk<M, V>, ResponseErr<M, V>>;

  /**
   * Map of version tag -> handler. Each entry handles requests at that version.
   * The version tag governs both incoming params and outgoing response types.
   */
  type RequestVersionHandlers<M extends RequestMethod> = {
    [V in RequestVersions<M>]?: RequestVersionHandler<M, V>;
  };

  function wireRequest<M extends RequestMethod>(
    method: M,
    handlers: RequestVersionHandlers<M>,
    defaultError: ResponseErr<M, 'v1'>,
  ): () => void {
    /** Dispatch a single version — generic over V so types flow through. */
    async function dispatchVersion<V extends RequestVersions<M>>(
      version: V,
      handler: RequestVersionHandler<M, V>,
      message: RequestCodecType<M>,
    ): Promise<ResponseCodecType<M>> {
      const unwrapped = unwrap(message, version);
      if (!unwrapped.ok) {
        return wrapErr('v1', defaultError) as ResponseCodecType<M>;
      }

      const result = await handler(unwrapped.value as RequestParams<M, V>);
      return result.match(
        ok => wrapOk(version, ok) as ResponseCodecType<M>,
        err => wrapErr(version, err) as ResponseCodecType<M>,
      );
    }

    return transport.handleRequest(method, async (message): Promise<ResponseCodecType<M>> => {
      const version = message.tag as RequestVersions<M>;

      if (version in handlers) {
        const handler = handlers[version];
        if (handler) {
          return dispatchVersion(version, handler, message);
        }
      }

      return wrapErr('v1', defaultError) as ResponseCodecType<M>;
    });
  }

  // -- Subscription handler wiring helper -----------------------------------

  /**
   * Handler type for a subscription method at a specific version.
   * Version V governs both the start params and the receive payload types.
   */
  type SubscriptionVersionHandler<M extends SubscriptionMethod, V extends string> = (
    params: SubscriptionParams<M, V>,
    send: (payload: SubscriptionPayload<M, V>) => void,
    interrupt: () => void,
  ) => () => void;

  /**
   * Map of version tag -> handler. Each entry handles subscriptions at that version.
   */
  type SubscriptionVersionHandlers<M extends SubscriptionMethod> = {
    [V in StartVersions<M>]?: SubscriptionVersionHandler<M, V>;
  };

  function wireSubscription<M extends SubscriptionMethod>(
    method: M,
    handlers: SubscriptionVersionHandlers<M>,
  ): () => void {
    /** Dispatch a single version — generic over V so types flow through. */
    function dispatchVersion<V extends StartVersions<M>>(
      version: V,
      handler: SubscriptionVersionHandler<M, V>,
      params: StartCodecType<M>,
      send: (value: ReceiveCodecType<M>) => void,
      interrupt: () => void,
    ): () => void {
      const unwrapped = unwrap(params, version);
      if (!unwrapped.ok) {
        interrupt();
        return () => {};
      }

      return handler(
        unwrapped.value as SubscriptionParams<M, V>,
        payload => send(wrap(version, payload) as ReceiveCodecType<M>),
        interrupt,
      );
    }

    return transport.handleSubscription(method, (params, send, interrupt) => {
      const version = params.tag as StartVersions<M>;

      if (version in handlers) {
        const handler = handlers[version];
        if (handler) {
          return dispatchVersion(version, handler, params, send, interrupt);
        }
      }

      interrupt();
      return () => {};
    });
  }

  // -- HostFacade implementation ---------------------------------------------

  const container: HostFacade = {
    transport,

    // -- Core / lifecycle ---------------------------------------------------

    handleFeatureSupported(handler) {
      return wireRequest('host_feature_supported', { v1: handler }, genericError(UNSUPPORTED_MESSAGE_FORMAT_ERROR));
    },

    handleDevicePermission(handler) {
      return wireRequest('host_device_permission', { v1: handler }, genericError(UNSUPPORTED_MESSAGE_FORMAT_ERROR));
    },

    handlePermission(handler) {
      return wireRequest('remote_permission', { v1: handler }, genericError(UNSUPPORTED_MESSAGE_FORMAT_ERROR));
    },

    handlePushNotification(handler) {
      return wireRequest('host_push_notification', { v1: handler }, genericError(UNSUPPORTED_MESSAGE_FORMAT_ERROR));
    },

    handleNavigateTo(handler) {
      return wireRequest(
        'host_navigate_to',
        { v1: handler },
        { tag: 'Unknown', value: { reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR } },
      );
    },

    // -- Local storage ------------------------------------------------------

    handleLocalStorageRead(handler) {
      return wireRequest(
        'host_local_storage_read',
        { v1: handler },
        { tag: 'Unknown', value: { reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR } },
      );
    },

    handleLocalStorageWrite(handler) {
      return wireRequest(
        'host_local_storage_write',
        { v1: handler },
        { tag: 'Unknown', value: { reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR } },
      );
    },

    handleLocalStorageClear(handler) {
      return wireRequest(
        'host_local_storage_clear',
        { v1: handler },
        { tag: 'Unknown', value: { reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR } },
      );
    },

    // -- Accounts -----------------------------------------------------------

    handleAccountGet(handler) {
      return wireRequest(
        'host_account_get',
        { v1: handler },
        { tag: 'Unknown', value: { reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR } },
      );
    },

    handleAccountGetAlias(handler) {
      return wireRequest(
        'host_account_get_alias',
        { v1: handler },
        { tag: 'Unknown', value: { reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR } },
      );
    },

    handleAccountCreateProof(handler) {
      return wireRequest(
        'host_account_create_proof',
        { v1: handler },
        { tag: 'Unknown', value: { reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR } },
      );
    },

    handleGetNonProductAccounts(handler) {
      return wireRequest(
        'host_get_non_product_accounts',
        { v1: handler },
        { tag: 'Unknown', value: { reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR } },
      );
    },

    handleAccountConnectionStatusSubscribe(handler) {
      return wireSubscription('host_account_connection_status_subscribe', { v1: handler });
    },

    // -- Signing ------------------------------------------------------------

    handleSignPayload(handler) {
      return wireRequest(
        'host_sign_payload',
        { v1: handler },
        { tag: 'Unknown', value: { reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR } },
      );
    },

    handleSignRaw(handler) {
      return wireRequest(
        'host_sign_raw',
        { v1: handler },
        { tag: 'Unknown', value: { reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR } },
      );
    },

    handleCreateTransaction(handler) {
      return wireRequest(
        'host_create_transaction',
        { v1: handler },
        { tag: 'Unknown', value: { reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR } },
      );
    },

    handleCreateTransactionWithNonProductAccount(handler) {
      return wireRequest(
        'host_create_transaction_with_non_product_account',
        { v1: handler },
        { tag: 'Unknown', value: { reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR } },
      );
    },

    // -- Chat ---------------------------------------------------------------

    handleChatCreateRoom(handler) {
      return wireRequest(
        'host_chat_create_room',
        { v1: handler },
        { tag: 'Unknown', value: { reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR } },
      );
    },

    handleChatRegisterBot(handler) {
      return wireRequest(
        'host_chat_register_bot',
        { v1: handler },
        { tag: 'Unknown', value: { reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR } },
      );
    },

    handleChatListSubscribe(handler) {
      return wireSubscription('host_chat_list_subscribe', { v1: handler });
    },

    handleChatPostMessage(handler) {
      return wireRequest(
        'host_chat_post_message',
        { v1: handler },
        { tag: 'Unknown', value: { reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR } },
      );
    },

    handleChatActionSubscribe(handler) {
      return wireSubscription('host_chat_action_subscribe', { v1: handler });
    },

    renderChatCustomMessage(params, callback) {
      return transport.subscribe('product_chat_custom_message_render_subscribe', { tag: 'v1', value: params }, data => {
        if (data.tag === 'v1') {
          callback(data.value);
        }
      });
    },

    // -- Statement store ----------------------------------------------------

    handleStatementStoreSubscribe(handler) {
      return wireSubscription('remote_statement_store_subscribe', { v1: handler });
    },

    handleStatementStoreCreateProof(handler) {
      return wireRequest(
        'remote_statement_store_create_proof',
        { v1: handler },
        { tag: 'Unknown', value: { reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR } },
      );
    },

    handleStatementStoreSubmit(handler) {
      return wireRequest(
        'remote_statement_store_submit',
        { v1: handler },
        genericError(UNSUPPORTED_MESSAGE_FORMAT_ERROR),
      );
    },

    // -- Preimage -----------------------------------------------------------

    handlePreimageLookupSubscribe(handler) {
      return wireSubscription('remote_preimage_lookup_subscribe', { v1: handler });
    },

    handlePreimageSubmit(handler) {
      return wireRequest(
        'remote_preimage_submit',
        { v1: handler },
        { tag: 'Unknown', value: { reason: UNSUPPORTED_MESSAGE_FORMAT_ERROR } },
      );
    },

    // -- Chain (individual methods) -----------------------------------------

    handleChainHeadFollow(handler) {
      return wireSubscription('remote_chain_head_follow', { v1: handler });
    },

    handleChainHeadHeader(handler) {
      return wireRequest('remote_chain_head_header', { v1: handler }, genericError(UNSUPPORTED_MESSAGE_FORMAT_ERROR));
    },

    handleChainHeadBody(handler) {
      return wireRequest('remote_chain_head_body', { v1: handler }, genericError(UNSUPPORTED_MESSAGE_FORMAT_ERROR));
    },

    handleChainHeadStorage(handler) {
      return wireRequest('remote_chain_head_storage', { v1: handler }, genericError(UNSUPPORTED_MESSAGE_FORMAT_ERROR));
    },

    handleChainHeadCall(handler) {
      return wireRequest('remote_chain_head_call', { v1: handler }, genericError(UNSUPPORTED_MESSAGE_FORMAT_ERROR));
    },

    handleChainHeadUnpin(handler) {
      return wireRequest('remote_chain_head_unpin', { v1: handler }, genericError(UNSUPPORTED_MESSAGE_FORMAT_ERROR));
    },

    handleChainHeadContinue(handler) {
      return wireRequest('remote_chain_head_continue', { v1: handler }, genericError(UNSUPPORTED_MESSAGE_FORMAT_ERROR));
    },

    handleChainHeadStopOperation(handler) {
      return wireRequest(
        'remote_chain_head_stop_operation',
        { v1: handler },
        genericError(UNSUPPORTED_MESSAGE_FORMAT_ERROR),
      );
    },

    handleChainSpecGenesisHash(handler) {
      return wireRequest(
        'remote_chain_spec_genesis_hash',
        { v1: handler },
        genericError(UNSUPPORTED_MESSAGE_FORMAT_ERROR),
      );
    },

    handleChainSpecChainName(handler) {
      return wireRequest(
        'remote_chain_spec_chain_name',
        { v1: handler },
        genericError(UNSUPPORTED_MESSAGE_FORMAT_ERROR),
      );
    },

    handleChainSpecProperties(handler) {
      return wireRequest(
        'remote_chain_spec_properties',
        { v1: handler },
        genericError(UNSUPPORTED_MESSAGE_FORMAT_ERROR),
      );
    },

    handleChainTransactionBroadcast(handler) {
      return wireRequest(
        'remote_chain_transaction_broadcast',
        { v1: handler },
        genericError(UNSUPPORTED_MESSAGE_FORMAT_ERROR),
      );
    },

    handleChainTransactionStop(handler) {
      return wireRequest(
        'remote_chain_transaction_stop',
        { v1: handler },
        genericError(UNSUPPORTED_MESSAGE_FORMAT_ERROR),
      );
    },

    // -- High-level chain connection ----------------------------------------

    handleChainConnection(factory) {
      const manager = createChainConnectionManager(factory);
      const cleanups: (() => void)[] = [];

      const version = 'v1';
      const errorResult = (reason: string) => wrapErr(version, genericError(reason));

      // Follow subscription. The transport-level subscriptionId is the same
      // string the product embeds as `followSubscriptionId` on subsequent
      // chain-op requests, so we key the follow in the manager by it.
      cleanups.push(
        transport.handleSubscription('remote_chain_head_follow', (params, send, interrupt, subscriptionId) => {
          const unwrapped = unwrap(params, version);
          if (!unwrapped.ok) {
            interrupt();
            return () => {};
          }
          const { genesisHash, withRuntime } = unwrapped.value;

          const entry = manager.getOrCreateChain(genesisHash);
          if (!entry) {
            interrupt();
            return () => {};
          }

          const stopFollow = manager.startFollow(
            entry,
            subscriptionId,
            withRuntime,
            (event: unknown) => {
              const typedEvent = manager.convertJsonRpcEventToTyped(event as Record<string, unknown>);
              send(wrap(version, typedEvent) as ReceiveCodecType<'remote_chain_head_follow'>);
            },
            // Node-side or transport-level rejection of chainHead_v1_follow
            // — interrupt the TrUAPI subscription so the product sees a
            // clean termination. The transport interrupt callback is
            // idempotent and handles both the sync-during-handler path and
            // the async-after-handler-returned path.
            () => interrupt(),
          );

          return () => {
            stopFollow();
            manager.releaseChain(genesisHash);
          };
        }),
      );

      /**
       * Handler-level result for a chain-op request. Typed per method: `value`
       * must match `ResponseOk<M, 'v1'>` on success or `ResponseErr<M, 'v1'>`
       * on failure. Shape matches the inner `value` of `ResponseCodecType<M>`
       * so `wireChainRequest` only needs to wrap it in `{tag: 'v1', value}`.
       */
      type ChainRequestResult<M extends RequestMethod> =
        | { success: true; value: ResponseOk<M, 'v1'> }
        | { success: false; value: ResponseErr<M, 'v1'> };

      /**
       * Wire a chain request handler. The handler receives unwrapped v1 params
       * and returns a typed `ChainRequestResult<M>`; `wireChainRequest` wraps
       * it in the `{tag: 'v1', value: ...}` envelope. The sole untyped boundary
       * is the single `as ResponseCodecType<M>` cast -- TypeScript can't prove
       * `{tag: 'v1', value: ChainRequestResult<M>}` matches `ResponseCodecType<M>`
       * structurally in a generic context.
       *
       * Thrown exceptions are converted to a generic-reason error response --
       * useful for letting network/JSON-RPC rejections flow through without a
       * try/catch in every handler.
       */
      function wireChainRequest<M extends RequestMethod>(
        method: M,
        handler: (params: RequestParams<M, 'v1'>) => Promise<ChainRequestResult<M>>,
      ): void {
        cleanups.push(
          transport.handleRequest(method, async (message): Promise<ResponseCodecType<M>> => {
            const unwrapped = unwrap(message, version);
            if (!unwrapped.ok) {
              return errorResult(UNSUPPORTED_MESSAGE_FORMAT_ERROR) as ResponseCodecType<M>;
            }
            try {
              const result = await handler(unwrapped.value as RequestParams<M, 'v1'>);
              return { tag: version, value: result } as ResponseCodecType<M>;
            } catch (e) {
              return errorResult(String(e)) as ResponseCodecType<M>;
            }
          }),
        );
      }

      const noActiveFollow = {
        success: false,
        value: { reason: 'No active follow for this subscription id' },
      } as const;

      // Header
      wireChainRequest('remote_chain_head_header', async value => {
        const { genesisHash, followSubscriptionId, hash } = value;
        const follow = manager.resolveFollow(genesisHash, followSubscriptionId);
        if (!follow) return noActiveFollow;
        const result = (await manager.sendRequest(follow.entry, 'chainHead_v1_header', [
          follow.followId,
          hash,
        ])) as ResponseOk<'remote_chain_head_header', 'v1'>;
        return { success: true, value: result };
      });

      // Body
      wireChainRequest('remote_chain_head_body', async value => {
        const { genesisHash, followSubscriptionId, hash } = value;
        const follow = manager.resolveFollow(genesisHash, followSubscriptionId);
        if (!follow) return noActiveFollow;
        const result = await manager.sendRequest(follow.entry, 'chainHead_v1_body', [follow.followId, hash]);
        return { success: true, value: manager.convertOperationStartedResult(result) };
      });

      // Storage
      wireChainRequest('remote_chain_head_storage', async value => {
        const { genesisHash, followSubscriptionId, hash, items, childTrie } = value;
        const follow = manager.resolveFollow(genesisHash, followSubscriptionId);
        if (!follow) return noActiveFollow;

        const jsonRpcItems = items.map(item => ({
          key: item.key,
          type: manager.convertStorageQueryTypeToJsonRpc(item.type),
        }));

        const result = await manager.sendRequest(follow.entry, 'chainHead_v1_storage', [
          follow.followId,
          hash,
          jsonRpcItems,
          childTrie,
        ]);
        return { success: true, value: manager.convertOperationStartedResult(result) };
      });

      // Call
      wireChainRequest('remote_chain_head_call', async value => {
        const follow = manager.resolveFollow(value.genesisHash, value.followSubscriptionId);
        if (!follow) return noActiveFollow;
        const result = await manager.sendRequest(follow.entry, 'chainHead_v1_call', [
          follow.followId,
          value.hash,
          value.function,
          value.callParameters,
        ]);
        return { success: true, value: manager.convertOperationStartedResult(result) };
      });

      // Unpin
      wireChainRequest('remote_chain_head_unpin', async value => {
        const { genesisHash, followSubscriptionId, hashes } = value;
        const follow = manager.resolveFollow(genesisHash, followSubscriptionId);
        if (!follow) return noActiveFollow;
        await manager.sendRequest(follow.entry, 'chainHead_v1_unpin', [follow.followId, hashes]);
        return { success: true, value: undefined };
      });

      // Continue
      wireChainRequest('remote_chain_head_continue', async value => {
        const { genesisHash, followSubscriptionId, operationId } = value;
        const follow = manager.resolveFollow(genesisHash, followSubscriptionId);
        if (!follow) return noActiveFollow;
        await manager.sendRequest(follow.entry, 'chainHead_v1_continue', [follow.followId, operationId]);
        return { success: true, value: undefined };
      });

      // StopOperation
      wireChainRequest('remote_chain_head_stop_operation', async value => {
        const { genesisHash, followSubscriptionId, operationId } = value;
        const follow = manager.resolveFollow(genesisHash, followSubscriptionId);
        if (!follow) return noActiveFollow;
        await manager.sendRequest(follow.entry, 'chainHead_v1_stopOperation', [follow.followId, operationId]);
        return { success: true, value: undefined };
      });

      const chainNotSupported = { success: false, value: { reason: 'Chain not supported' } } as const;

      // ChainSpec: genesis hash
      wireChainRequest('remote_chain_spec_genesis_hash', async value => {
        const genesisHash = value;
        const entry = manager.getOrCreateChain(genesisHash);
        if (!entry) return chainNotSupported;
        try {
          const result = (await manager.sendRequest(entry, 'chainSpec_v1_genesisHash', [])) as ResponseOk<
            'remote_chain_spec_genesis_hash',
            'v1'
          >;
          return { success: true, value: result };
        } finally {
          manager.releaseChain(genesisHash);
        }
      });

      // ChainSpec: chain name
      wireChainRequest('remote_chain_spec_chain_name', async value => {
        const genesisHash = value;
        const entry = manager.getOrCreateChain(genesisHash);
        if (!entry) return chainNotSupported;
        try {
          const result = (await manager.sendRequest(entry, 'chainSpec_v1_chainName', [])) as ResponseOk<
            'remote_chain_spec_chain_name',
            'v1'
          >;
          return { success: true, value: result };
        } finally {
          manager.releaseChain(genesisHash);
        }
      });

      // ChainSpec: properties
      wireChainRequest('remote_chain_spec_properties', async value => {
        const genesisHash = value;
        const entry = manager.getOrCreateChain(genesisHash);
        if (!entry) return chainNotSupported;
        try {
          const result = await manager.sendRequest(entry, 'chainSpec_v1_properties', []);
          return { success: true, value: typeof result === 'string' ? result : JSON.stringify(result) };
        } finally {
          manager.releaseChain(genesisHash);
        }
      });

      // Transaction broadcast
      wireChainRequest('remote_chain_transaction_broadcast', async value => {
        const { genesisHash, transaction } = value;
        const entry = manager.getOrCreateChain(genesisHash);
        if (!entry) return chainNotSupported;
        try {
          const result = await manager.sendRequest(entry, 'transaction_v1_broadcast', [transaction]);
          return { success: true, value: (result as string) ?? undefined };
        } finally {
          manager.releaseChain(genesisHash);
        }
      });

      // Transaction stop
      wireChainRequest('remote_chain_transaction_stop', async value => {
        const { genesisHash, operationId } = value;
        const entry = manager.getOrCreateChain(genesisHash);
        if (!entry) return chainNotSupported;
        try {
          await manager.sendRequest(entry, 'transaction_v1_stop', [operationId]);
          return { success: true, value: undefined };
        } finally {
          manager.releaseChain(genesisHash);
        }
      });

      // Disposal
      let disposed = false;
      const dispose = (): void => {
        if (disposed) return;
        disposed = true;
        unsubscribeDestroy();
        for (const fn of cleanups) fn();
        manager.dispose();
      };

      const unsubscribeDestroy = transport.onDestroy(dispose);
      return dispose;
    },

    // -- Transport lifecycle ------------------------------------------------

    whenReady() {
      return transport.whenReady();
    },

    subscribeProductConnectionStatus(callback) {
      const unsubscribe = transport.onConnectionStatusChange(callback);

      return unsubscribe;
    },

    dispose() {
      cleanupCodecUpgrade?.();
      transport.destroy();
    },
  };

  return container;
}
