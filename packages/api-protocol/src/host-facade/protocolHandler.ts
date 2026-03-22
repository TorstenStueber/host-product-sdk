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

import type { HexString } from '../shared/codec/scale/primitives.js';
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
import { createTransport } from '../shared/transport/transport.js';
import { createWindowProvider } from '../shared/transport/windowProvider.js';
import type { WindowRef } from '../shared/transport/windowProvider.js';
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
function unwrap<M extends { tag: string; value: unknown }>(
  message: M,
  version: string,
): { ok: true; value: M['value'] } | { ok: false } {
  if (message.tag === version) {
    return { ok: true, value: message.value };
  }
  return { ok: false };
}

function genericError(reason: string) {
  return { reason };
}

// ---------------------------------------------------------------------------
// HostFacade options
// ---------------------------------------------------------------------------

export type CreateHostFacadeOptions = {
  /** How the host communicates with the product. */
  messaging: { type: 'window'; target: WindowRef } | { type: 'messagePort'; port: MessagePort | Promise<MessagePort> };

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
        const tagged = data as { tag: string; value: unknown };
        if (tagged.tag === 'v1') {
          callback(tagged.value as Parameters<typeof callback>[0]);
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

      // Follow subscription
      cleanups.push(
        transport.handleSubscription('remote_chain_head_follow', (params, send, interrupt) => {
          const unwrapped = unwrap(params, version);
          if (!unwrapped.ok) {
            interrupt();
            return () => {};
          }
          const { genesisHash, withRuntime } = unwrapped.value as { genesisHash: HexString; withRuntime: boolean };

          const entry = manager.getOrCreateChain(genesisHash);
          if (!entry) {
            interrupt();
            return () => {};
          }

          const { followId } = manager.startFollow(genesisHash, withRuntime, (event: unknown) => {
            const typedEvent = manager.convertJsonRpcEventToTyped(event as Record<string, unknown>);
            send(wrap(version, typedEvent) as ReceiveCodecType<'remote_chain_head_follow'>);
          });

          return () => {
            manager.stopFollow(genesisHash, followId);
            manager.releaseChain(genesisHash);
          };
        }),
      );

      /**
       * Wire a chain request handler. The handler receives the unwrapped v1
       * params and returns a versioned response built with wrapOk/wrapErr.
       *
       * Chain handlers interface with the JSON-RPC connection manager which
       * returns dynamically-typed results, so a single `as ResponseCodecType<M>`
       * cast at the boundary bridges the untyped JSON-RPC world to the
       * typed protocol world.
       */
      function wireChainRequest<M extends RequestMethod>(
        method: M,
        handler: (value: unknown) => Promise<unknown>,
      ): void {
        cleanups.push(
          transport.handleRequest(method, async (message): Promise<ResponseCodecType<M>> => {
            const unwrapped = unwrap(message, version);
            if (!unwrapped.ok) {
              return errorResult(UNSUPPORTED_MESSAGE_FORMAT_ERROR) as ResponseCodecType<M>;
            }
            try {
              return (await handler(unwrapped.value)) as ResponseCodecType<M>;
            } catch (e) {
              return errorResult(String(e)) as ResponseCodecType<M>;
            }
          }),
        );
      }

      // Header
      wireChainRequest('remote_chain_head_header', async value => {
        const { genesisHash, hash } = value as { genesisHash: HexString; hash: HexString };
        const realSubId = manager.getChainFollowSubId(genesisHash);
        if (!realSubId) return errorResult('No active follow for this chain');
        const result = await manager.sendRequest(genesisHash, 'chainHead_v1_header', [realSubId, hash]);
        return wrapOk(version, result);
      });

      // Body
      wireChainRequest('remote_chain_head_body', async value => {
        const { genesisHash, hash } = value as { genesisHash: HexString; hash: HexString };
        const realSubId = manager.getChainFollowSubId(genesisHash);
        if (!realSubId) return errorResult('No active follow for this chain');
        const result = await manager.sendRequest(genesisHash, 'chainHead_v1_body', [realSubId, hash]);
        return wrapOk(version, manager.convertOperationStartedResult(result));
      });

      // Storage
      wireChainRequest('remote_chain_head_storage', async value => {
        const { genesisHash, hash, items, childTrie } = value as {
          genesisHash: HexString;
          hash: HexString;
          items: { key: HexString; type: string }[];
          childTrie: HexString | undefined;
        };
        const realSubId = manager.getChainFollowSubId(genesisHash);
        if (!realSubId) return errorResult('No active follow for this chain');

        const jsonRpcItems = items.map(item => ({
          key: item.key,
          type: manager.convertStorageQueryTypeToJsonRpc(item.type),
        }));

        const result = await manager.sendRequest(genesisHash, 'chainHead_v1_storage', [
          realSubId,
          hash,
          jsonRpcItems,
          childTrie,
        ]);
        return wrapOk(version, manager.convertOperationStartedResult(result));
      });

      // Call
      wireChainRequest('remote_chain_head_call', async value => {
        const params = value as {
          genesisHash: HexString;
          hash: HexString;
          function: string;
          callParameters: HexString;
        };
        const realSubId = manager.getChainFollowSubId(params.genesisHash);
        if (!realSubId) return errorResult('No active follow for this chain');
        const result = await manager.sendRequest(params.genesisHash, 'chainHead_v1_call', [
          realSubId,
          params.hash,
          params.function,
          params.callParameters,
        ]);
        return wrapOk(version, manager.convertOperationStartedResult(result));
      });

      // Unpin
      wireChainRequest('remote_chain_head_unpin', async value => {
        const { genesisHash, hashes } = value as { genesisHash: HexString; hashes: HexString[] };
        const realSubId = manager.getChainFollowSubId(genesisHash);
        if (!realSubId) return errorResult('No active follow for this chain');
        await manager.sendRequest(genesisHash, 'chainHead_v1_unpin', [realSubId, hashes]);
        return wrapOk(version, undefined);
      });

      // Continue
      wireChainRequest('remote_chain_head_continue', async value => {
        const { genesisHash, operationId } = value as { genesisHash: HexString; operationId: string };
        const realSubId = manager.getChainFollowSubId(genesisHash);
        if (!realSubId) return errorResult('No active follow for this chain');
        await manager.sendRequest(genesisHash, 'chainHead_v1_continue', [realSubId, operationId]);
        return wrapOk(version, undefined);
      });

      // StopOperation
      wireChainRequest('remote_chain_head_stop_operation', async value => {
        const { genesisHash, operationId } = value as { genesisHash: HexString; operationId: string };
        const realSubId = manager.getChainFollowSubId(genesisHash);
        if (!realSubId) return errorResult('No active follow for this chain');
        await manager.sendRequest(genesisHash, 'chainHead_v1_stopOperation', [realSubId, operationId]);
        return wrapOk(version, undefined);
      });

      // ChainSpec: genesis hash
      wireChainRequest('remote_chain_spec_genesis_hash', async value => {
        const genesisHash = value as HexString;
        const entry = manager.getOrCreateChain(genesisHash);
        if (!entry) return errorResult('Chain not supported');
        try {
          const result = await manager.sendRequest(genesisHash, 'chainSpec_v1_genesisHash', []);
          manager.releaseChain(genesisHash);
          return wrapOk(version, result);
        } catch (e) {
          manager.releaseChain(genesisHash);
          throw e;
        }
      });

      // ChainSpec: chain name
      wireChainRequest('remote_chain_spec_chain_name', async value => {
        const genesisHash = value as HexString;
        const entry = manager.getOrCreateChain(genesisHash);
        if (!entry) return errorResult('Chain not supported');
        try {
          const result = await manager.sendRequest(genesisHash, 'chainSpec_v1_chainName', []);
          manager.releaseChain(genesisHash);
          return wrapOk(version, result);
        } catch (e) {
          manager.releaseChain(genesisHash);
          throw e;
        }
      });

      // ChainSpec: properties
      wireChainRequest('remote_chain_spec_properties', async value => {
        const genesisHash = value as HexString;
        const entry = manager.getOrCreateChain(genesisHash);
        if (!entry) return errorResult('Chain not supported');
        try {
          const result = await manager.sendRequest(genesisHash, 'chainSpec_v1_properties', []);
          manager.releaseChain(genesisHash);
          return wrapOk(version, typeof result === 'string' ? result : JSON.stringify(result));
        } catch (e) {
          manager.releaseChain(genesisHash);
          throw e;
        }
      });

      // Transaction broadcast
      wireChainRequest('remote_chain_transaction_broadcast', async value => {
        const { genesisHash, transaction } = value as { genesisHash: HexString; transaction: HexString };
        const entry = manager.getOrCreateChain(genesisHash);
        if (!entry) return errorResult('Chain not supported');
        try {
          const result = await manager.sendRequest(genesisHash, 'transaction_v1_broadcast', [transaction]);
          manager.releaseChain(genesisHash);
          return wrapOk(version, (result as string) ?? undefined);
        } catch (e) {
          manager.releaseChain(genesisHash);
          throw e;
        }
      });

      // Transaction stop
      wireChainRequest('remote_chain_transaction_stop', async value => {
        const { genesisHash, operationId } = value as { genesisHash: HexString; operationId: string };
        const entry = manager.getOrCreateChain(genesisHash);
        if (!entry) return errorResult('Chain not supported');
        try {
          await manager.sendRequest(genesisHash, 'transaction_v1_stop', [operationId]);
          manager.releaseChain(genesisHash);
          return wrapOk(version, undefined);
        } catch (e) {
          manager.releaseChain(genesisHash);
          throw e;
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
