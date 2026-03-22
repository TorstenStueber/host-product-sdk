/**
 * Product-side Host API facade.
 *
 * `createProductFacade` builds the full product-side communication stack:
 * provider → transport (with handshake and codec upgrade) → typed facade.
 *
 * Every request method returns a `ResultAsync<Ok, Err>` from neverthrow
 * so callers can chain with `.map()`, `.andThen()`, `.match()`, etc.
 *
 * Handler param/ok/err types are derived from the SCALE codec definitions
 * in `hostApiProtocol` via `RequestParams`, `ResponseOk`, `ResponseErr`,
 * `SubscriptionParams`, and `SubscriptionPayload`.
 */

import type { Subscription, Transport } from '../shared/transport/transport.js';
import type {
  RequestMethod,
  SubscriptionMethod,
  RequestCodecType,
  StartCodecType,
  ReceiveCodecType,
  RequestParams,
  ResponseOk,
  ResponseErr,
  SubscriptionParams,
  SubscriptionPayload,
} from '../api/protocol.js';
import { scaleCodecAdapter } from '../shared/codec/scale/adapter.js';
import { structuredCloneCodecAdapter } from '../shared/codec/structured/index.js';
import { requestCodecUpgrade } from '../shared/codec/negotiation.js';
import type { Messaging } from '../shared/transport/provider.js';
import { createTransport } from '../shared/transport/transport.js';
import { createWindowProvider } from '../shared/transport/windowProvider.js';
import { createMessagePortProvider } from '../shared/transport/messagePortProvider.js';
import { ResultAsync } from 'neverthrow';
import { extractErrorMessage } from '../shared/util/helpers.js';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export type CreateProductFacadeOptions = {
  /** How the product communicates with the host. */
  messaging: Messaging;

  /** Protocol version for handshake validation. Defaults to 1. */
  protocolVersionId?: number;
};

// ---------------------------------------------------------------------------
// Internal: generic request / subscribe wrappers
// ---------------------------------------------------------------------------

function makeRequest<M extends RequestMethod, V extends string>(
  transport: Transport,
  method: M,
  version: V,
  payload: RequestParams<M, V>,
): ResultAsync<ResponseOk<M, V>, ResponseErr<M, V>> {
  type Ok = ResponseOk<M, V>;
  type Err = ResponseErr<M, V>;

  const response = ResultAsync.fromPromise(
    transport.request(method, { tag: version, value: payload } as RequestCodecType<M>) as Promise<{
      tag: string;
      value: { success: boolean; value: unknown };
    }>,
    (e: unknown) => ({ tag: 'Unknown', value: { reason: extractErrorMessage(e) } }) as Err,
  );

  return response.andThen((resp): ResultAsync<Ok, Err> => {
    if (resp.value.success) {
      return ResultAsync.fromSafePromise(Promise.resolve(resp.value.value as Ok));
    }
    return ResultAsync.fromPromise(Promise.reject(resp.value.value as Err), e => e as Err);
  });
}

function makeSubscription<M extends SubscriptionMethod, V extends string>(
  transport: Transport,
  method: M,
  version: V,
  payload: SubscriptionParams<M, V>,
  callback: (payload: SubscriptionPayload<M, V>) => void,
): Subscription {
  return transport.subscribe(method, { tag: version, value: payload } as StartCodecType<M>, data => {
    const tagged = data as { tag: string; value: unknown };
    if (tagged.tag === version) {
      callback(tagged.value as SubscriptionPayload<M, V>);
    }
  });
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a product-side ProductFacade.
 *
 * Builds the full stack internally: creates the appropriate provider from
 * `messaging`, creates a transport with `handshake: 'initiate'`, and wraps
 * it with automatic codec upgrade negotiation.
 */
export function createProductFacade(options: CreateProductFacadeOptions) {
  const { messaging, protocolVersionId } = options;

  // Build provider from messaging option.
  const provider =
    messaging.type === 'window' ? createWindowProvider(messaging.target) : createMessagePortProvider(messaging.port);

  // Build transport with eager handshake.
  const transport = createTransport({
    provider,
    handshake: 'initiate',
    idPrefix: 'p:',
    protocolVersionId,
  });

  // Auto-upgrade codec after handshake.
  const readyPromise = transport.whenReady().then(async () => {
    await requestCodecUpgrade(transport, {
      scale: scaleCodecAdapter,
      structured_clone: structuredCloneCodecAdapter,
    });
  });
  // Suppress unhandled rejection if no one awaits whenReady().
  readyPromise.catch(() => {});

  return {
    // -- Transport proxies --------------------------------------------------

    /** Resolves when the handshake and codec negotiation are complete. */
    whenReady(): Promise<void> {
      return readyPromise;
    },

    /**
     * Register a handler for a host-initiated subscription.
     *
     * This is the product-side counterpart to `transport.handleSubscription`.
     * Used for the one protocol method where the product is the handler
     * rather than the initiator (`product_chat_custom_message_render_subscribe`).
     */
    handleHostSubscription<M extends SubscriptionMethod>(
      method: M,
      handler: (
        params: StartCodecType<M>,
        send: (value: ReceiveCodecType<M>) => void,
        interrupt: () => void,
      ) => () => void,
    ): () => void {
      return transport.handleSubscription(method, handler);
    },

    // -- Core / lifecycle ---------------------------------------------------

    featureSupported(payload: RequestParams<'host_feature_supported', 'v1'>) {
      return makeRequest(transport, 'host_feature_supported', 'v1', payload);
    },

    pushNotification(payload: RequestParams<'host_push_notification', 'v1'>) {
      return makeRequest(transport, 'host_push_notification', 'v1', payload);
    },

    navigateTo(payload: RequestParams<'host_navigate_to', 'v1'>) {
      return makeRequest(transport, 'host_navigate_to', 'v1', payload);
    },

    // -- Permissions --------------------------------------------------------

    devicePermission(payload: RequestParams<'host_device_permission', 'v1'>) {
      return makeRequest(transport, 'host_device_permission', 'v1', payload);
    },

    permission(payload: RequestParams<'remote_permission', 'v1'>) {
      return makeRequest(transport, 'remote_permission', 'v1', payload);
    },

    // -- Local storage ------------------------------------------------------

    localStorageRead(payload: RequestParams<'host_local_storage_read', 'v1'>) {
      return makeRequest(transport, 'host_local_storage_read', 'v1', payload);
    },

    localStorageWrite(payload: RequestParams<'host_local_storage_write', 'v1'>) {
      return makeRequest(transport, 'host_local_storage_write', 'v1', payload);
    },

    localStorageClear(payload: RequestParams<'host_local_storage_clear', 'v1'>) {
      return makeRequest(transport, 'host_local_storage_clear', 'v1', payload);
    },

    // -- Accounts -----------------------------------------------------------

    accountConnectionStatusSubscribe(
      args: SubscriptionParams<'host_account_connection_status_subscribe', 'v1'>,
      callback: (payload: SubscriptionPayload<'host_account_connection_status_subscribe', 'v1'>) => void,
    ): Subscription {
      return makeSubscription(transport, 'host_account_connection_status_subscribe', 'v1', args, callback);
    },

    accountGet(payload: RequestParams<'host_account_get', 'v1'>) {
      return makeRequest(transport, 'host_account_get', 'v1', payload);
    },

    accountGetAlias(payload: RequestParams<'host_account_get_alias', 'v1'>) {
      return makeRequest(transport, 'host_account_get_alias', 'v1', payload);
    },

    accountCreateProof(payload: RequestParams<'host_account_create_proof', 'v1'>) {
      return makeRequest(transport, 'host_account_create_proof', 'v1', payload);
    },

    getNonProductAccounts(payload: RequestParams<'host_get_non_product_accounts', 'v1'>) {
      return makeRequest(transport, 'host_get_non_product_accounts', 'v1', payload);
    },

    // -- Transactions -------------------------------------------------------

    createTransaction(payload: RequestParams<'host_create_transaction', 'v1'>) {
      return makeRequest(transport, 'host_create_transaction', 'v1', payload);
    },

    createTransactionWithNonProductAccount(
      payload: RequestParams<'host_create_transaction_with_non_product_account', 'v1'>,
    ) {
      return makeRequest(transport, 'host_create_transaction_with_non_product_account', 'v1', payload);
    },

    // -- Signing ------------------------------------------------------------

    signRaw(payload: RequestParams<'host_sign_raw', 'v1'>) {
      return makeRequest(transport, 'host_sign_raw', 'v1', payload);
    },

    signPayload(payload: RequestParams<'host_sign_payload', 'v1'>) {
      return makeRequest(transport, 'host_sign_payload', 'v1', payload);
    },

    // -- Chat ---------------------------------------------------------------

    chatListSubscribe(
      args: SubscriptionParams<'host_chat_list_subscribe', 'v1'>,
      callback: (payload: SubscriptionPayload<'host_chat_list_subscribe', 'v1'>) => void,
    ): Subscription {
      return makeSubscription(transport, 'host_chat_list_subscribe', 'v1', args, callback);
    },

    chatCreateRoom(payload: RequestParams<'host_chat_create_room', 'v1'>) {
      return makeRequest(transport, 'host_chat_create_room', 'v1', payload);
    },

    chatRegisterBot(payload: RequestParams<'host_chat_register_bot', 'v1'>) {
      return makeRequest(transport, 'host_chat_register_bot', 'v1', payload);
    },

    chatPostMessage(payload: RequestParams<'host_chat_post_message', 'v1'>) {
      return makeRequest(transport, 'host_chat_post_message', 'v1', payload);
    },

    chatActionSubscribe(
      args: SubscriptionParams<'host_chat_action_subscribe', 'v1'>,
      callback: (payload: SubscriptionPayload<'host_chat_action_subscribe', 'v1'>) => void,
    ): Subscription {
      return makeSubscription(transport, 'host_chat_action_subscribe', 'v1', args, callback);
    },

    // -- Statement store ----------------------------------------------------

    statementStoreSubscribe(
      args: SubscriptionParams<'remote_statement_store_subscribe', 'v1'>,
      callback: (payload: SubscriptionPayload<'remote_statement_store_subscribe', 'v1'>) => void,
    ): Subscription {
      return makeSubscription(transport, 'remote_statement_store_subscribe', 'v1', args, callback);
    },

    statementStoreCreateProof(payload: RequestParams<'remote_statement_store_create_proof', 'v1'>) {
      return makeRequest(transport, 'remote_statement_store_create_proof', 'v1', payload);
    },

    statementStoreSubmit(payload: RequestParams<'remote_statement_store_submit', 'v1'>) {
      return makeRequest(transport, 'remote_statement_store_submit', 'v1', payload);
    },

    // -- Preimage -----------------------------------------------------------

    preimageLookupSubscribe(
      args: SubscriptionParams<'remote_preimage_lookup_subscribe', 'v1'>,
      callback: (payload: SubscriptionPayload<'remote_preimage_lookup_subscribe', 'v1'>) => void,
    ): Subscription {
      return makeSubscription(transport, 'remote_preimage_lookup_subscribe', 'v1', args, callback);
    },

    preimageSubmit(payload: RequestParams<'remote_preimage_submit', 'v1'>) {
      return makeRequest(transport, 'remote_preimage_submit', 'v1', payload);
    },

    // -- JSON-RPC bridge ----------------------------------------------------

    jsonrpcMessageSend(payload: RequestParams<'host_jsonrpc_message_send', 'v1'>) {
      return makeRequest(transport, 'host_jsonrpc_message_send', 'v1', payload);
    },

    jsonrpcMessageSubscribe(
      args: SubscriptionParams<'host_jsonrpc_message_subscribe', 'v1'>,
      callback: (payload: SubscriptionPayload<'host_jsonrpc_message_subscribe', 'v1'>) => void,
    ): Subscription {
      return makeSubscription(transport, 'host_jsonrpc_message_subscribe', 'v1', args, callback);
    },

    // -- Remote chain (new JSON-RPC spec) -----------------------------------

    chainHeadFollow(
      args: SubscriptionParams<'remote_chain_head_follow', 'v1'>,
      callback: (payload: SubscriptionPayload<'remote_chain_head_follow', 'v1'>) => void,
    ): Subscription {
      return makeSubscription(transport, 'remote_chain_head_follow', 'v1', args, callback);
    },

    chainHeadHeader(payload: RequestParams<'remote_chain_head_header', 'v1'>) {
      return makeRequest(transport, 'remote_chain_head_header', 'v1', payload);
    },

    chainHeadBody(payload: RequestParams<'remote_chain_head_body', 'v1'>) {
      return makeRequest(transport, 'remote_chain_head_body', 'v1', payload);
    },

    chainHeadStorage(payload: RequestParams<'remote_chain_head_storage', 'v1'>) {
      return makeRequest(transport, 'remote_chain_head_storage', 'v1', payload);
    },

    chainHeadCall(payload: RequestParams<'remote_chain_head_call', 'v1'>) {
      return makeRequest(transport, 'remote_chain_head_call', 'v1', payload);
    },

    chainHeadUnpin(payload: RequestParams<'remote_chain_head_unpin', 'v1'>) {
      return makeRequest(transport, 'remote_chain_head_unpin', 'v1', payload);
    },

    chainHeadContinue(payload: RequestParams<'remote_chain_head_continue', 'v1'>) {
      return makeRequest(transport, 'remote_chain_head_continue', 'v1', payload);
    },

    chainHeadStopOperation(payload: RequestParams<'remote_chain_head_stop_operation', 'v1'>) {
      return makeRequest(transport, 'remote_chain_head_stop_operation', 'v1', payload);
    },

    chainSpecGenesisHash(payload: RequestParams<'remote_chain_spec_genesis_hash', 'v1'>) {
      return makeRequest(transport, 'remote_chain_spec_genesis_hash', 'v1', payload);
    },

    chainSpecChainName(payload: RequestParams<'remote_chain_spec_chain_name', 'v1'>) {
      return makeRequest(transport, 'remote_chain_spec_chain_name', 'v1', payload);
    },

    chainSpecProperties(payload: RequestParams<'remote_chain_spec_properties', 'v1'>) {
      return makeRequest(transport, 'remote_chain_spec_properties', 'v1', payload);
    },

    chainTransactionBroadcast(payload: RequestParams<'remote_chain_transaction_broadcast', 'v1'>) {
      return makeRequest(transport, 'remote_chain_transaction_broadcast', 'v1', payload);
    },

    chainTransactionStop(payload: RequestParams<'remote_chain_transaction_stop', 'v1'>) {
      return makeRequest(transport, 'remote_chain_transaction_stop', 'v1', payload);
    },
  };
}

/**
 * Return type of `createProductFacade`.
 */
export type ProductFacade = ReturnType<typeof createProductFacade>;
