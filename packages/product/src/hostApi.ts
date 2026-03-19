/**
 * Product-side Host API facade.
 *
 * Wraps the low-level transport `request()` / `subscribe()` calls into a
 * typed, ergonomic API surface.  Every request method returns a
 * `ResultAsync<Tagged<V, Ok>, Tagged<V, Err>>` from neverthrow so callers can
 * chain with `.map()`, `.andThen()`, `.match()`, etc.
 *
 * Handler param/ok/err types are derived from the SCALE codec definitions
 * in `hostApiProtocol` via `RequestParams`, `ResponseOk`, `ResponseErr`,
 * `SubscriptionParams`, and `SubscriptionPayload`.
 */

import type {
  Subscription, Transport,
  RequestMethod, SubscriptionMethod,
  RequestParams, ResponseOk, ResponseErr,
  SubscriptionParams, SubscriptionPayload,
} from '@polkadot/shared';
import {
  ResultAsync,
  extractErrorMessage,
} from '@polkadot/shared';

import { sandboxTransport } from './transport/sandboxTransport.js';

// ---------------------------------------------------------------------------
// Versioned envelope helper
// ---------------------------------------------------------------------------

type Tagged<V extends string, T> = { tag: V; value: T };

/**
 * Construct a versioned tagged envelope.
 */
function versioned<V extends string, T>(tag: V, value: T): Tagged<V, T> {
  return { tag, value };
}

// ---------------------------------------------------------------------------
// Internal: generic request / subscribe wrappers
// ---------------------------------------------------------------------------

/**
 * Wrap a transport.request call into a ResultAsync that splits the
 * versioned success/error envelope.
 *
 * The wire response shape is:
 * ```
 * { tag: 'v1', value: { success: true, value: T } | { success: false, value: E } }
 * ```
 */
function makeRequest<M extends RequestMethod, V extends string>(
  transport: Transport,
  method: M,
  payload: Tagged<V, RequestParams<M, V>>,
): ResultAsync<Tagged<V, ResponseOk<M, V>>, Tagged<V, ResponseErr<M, V>>> {
  type Ok = ResponseOk<M, V>;
  type Err = ResponseErr<M, V>;

  const response = ResultAsync.fromPromise(
    transport.request(method, payload) as Promise<{
      tag: V;
      value: { success: boolean; value: unknown };
    }>,
    (e: unknown) => versioned(payload.tag, { tag: 'Unknown', value: { reason: extractErrorMessage(e) } } as Err),
  );

  return response.andThen(
    (
      resp: { tag: V; value: { success: boolean; value: unknown } },
    ): ResultAsync<Tagged<V, Ok>, Tagged<V, Err>> => {
      if (resp.value.success) {
        return ResultAsync.fromSafePromise(
          Promise.resolve(versioned(resp.tag, resp.value.value as Ok)),
        );
      }
      return ResultAsync.fromPromise(
        Promise.reject(versioned(resp.tag, resp.value.value as Err)),
        (e) => e as Tagged<V, Err>,
      );
    },
  );
}

/**
 * Wrap a transport.subscribe call.
 */
function makeSubscription<M extends SubscriptionMethod, SV extends string, RV extends string>(
  transport: Transport,
  method: M,
  payload: Tagged<SV, SubscriptionParams<M, SV>>,
  callback: (payload: Tagged<RV, SubscriptionPayload<M, RV>>) => void,
): Subscription {
  return transport.subscribe(method, payload, (data) => {
    callback(data as Tagged<RV, SubscriptionPayload<M, RV>>);
  });
}

// ---------------------------------------------------------------------------
// Error class imports (for hydration in per-method wrappers)
// ---------------------------------------------------------------------------

import {
  GenericError,
  HandshakeErr, RequestCredentialsErr, CreateProofErr,
  SigningErr, CreateTransactionErr, StorageErr, NavigateToErr,
  ChatRoomRegistrationErr, ChatBotRegistrationErr, ChatMessagePostingErr,
  StatementProofErr, PreimageSubmitErr,
} from '@polkadot/shared';

/** Hydrate a plain error and re-wrap in a versioned Tagged envelope. */
function hydrate<V extends string, E>(
  tagged: Tagged<V, { tag: string; value: unknown }>,
  fromPlain: (plain: { tag: string; value: unknown }) => E,
): Tagged<V, E> {
  return versioned(tagged.tag, fromPlain(tagged.value as { tag: string; value: unknown }));
}

/** Hydrate a GenericError (not a tagged enum — just `{ reason: string }`). */
function hydrateGeneric<V extends string>(
  tagged: Tagged<V, { reason: string }>,
): Tagged<V, GenericError> {
  return versioned(tagged.tag, new GenericError(tagged.value as { reason: string }));
}

// ---------------------------------------------------------------------------
// HostApi factory
// ---------------------------------------------------------------------------

/**
 * Versioned payload helper — constructs `{ tag: V, value: T }`.
 * Exported for use by consumers (accounts, chain, etc.).
 */
export function enumValue<V extends string, T>(tag: V, value: T): Tagged<V, T> {
  return versioned(tag, value);
}

/**
 * Create a product-side HostApi facade bound to a given transport.
 *
 * Every method corresponds to a protocol method defined in
 * `@polkadot/shared/codec/scale/protocol`. Request methods return
 * `ResultAsync` with versioned success/error envelopes. Subscription
 * methods return a `Subscription` handle.
 */
export function createHostApi(transport: Transport) {
  return {
    // -- Core / lifecycle ---------------------------------------------------

    handshake(payload: Tagged<'v1', RequestParams<'host_handshake', 'v1'>>) {
      return makeRequest(transport, 'host_handshake', payload)
        .mapErr(e => hydrate(e, HandshakeErr.fromPlain));
    },

    featureSupported(payload: Tagged<'v1', RequestParams<'host_feature_supported', 'v1'>>) {
      return makeRequest(transport, 'host_feature_supported', payload)
        .mapErr(hydrateGeneric);
    },

    pushNotification(payload: Tagged<'v1', RequestParams<'host_push_notification', 'v1'>>) {
      return makeRequest(transport, 'host_push_notification', payload)
        .mapErr(hydrateGeneric);
    },

    navigateTo(payload: Tagged<'v1', RequestParams<'host_navigate_to', 'v1'>>) {
      return makeRequest(transport, 'host_navigate_to', payload)
        .mapErr(e => hydrate(e, NavigateToErr.fromPlain));
    },

    // -- Permissions --------------------------------------------------------

    devicePermission(payload: Tagged<'v1', RequestParams<'host_device_permission', 'v1'>>) {
      return makeRequest(transport, 'host_device_permission', payload)
        .mapErr(hydrateGeneric);
    },

    permission(payload: Tagged<'v1', RequestParams<'remote_permission', 'v1'>>) {
      return makeRequest(transport, 'remote_permission', payload)
        .mapErr(hydrateGeneric);
    },

    // -- Local storage ------------------------------------------------------

    localStorageRead(payload: Tagged<'v1', RequestParams<'host_local_storage_read', 'v1'>>) {
      return makeRequest(transport, 'host_local_storage_read', payload)
        .mapErr(e => hydrate(e, StorageErr.fromPlain));
    },

    localStorageWrite(payload: Tagged<'v1', RequestParams<'host_local_storage_write', 'v1'>>) {
      return makeRequest(transport, 'host_local_storage_write', payload)
        .mapErr(e => hydrate(e, StorageErr.fromPlain));
    },

    localStorageClear(payload: Tagged<'v1', RequestParams<'host_local_storage_clear', 'v1'>>) {
      return makeRequest(transport, 'host_local_storage_clear', payload)
        .mapErr(e => hydrate(e, StorageErr.fromPlain));
    },

    // -- Accounts -----------------------------------------------------------

    accountConnectionStatusSubscribe(
      args: Tagged<'v1', SubscriptionParams<'host_account_connection_status_subscribe', 'v1'>>,
      callback: (payload: Tagged<'v1', SubscriptionPayload<'host_account_connection_status_subscribe', 'v1'>>) => void,
    ): Subscription {
      return makeSubscription(transport, 'host_account_connection_status_subscribe', args, callback);
    },

    accountGet(payload: Tagged<'v1', RequestParams<'host_account_get', 'v1'>>) {
      return makeRequest(transport, 'host_account_get', payload)
        .mapErr(e => hydrate(e, RequestCredentialsErr.fromPlain));
    },

    accountGetAlias(payload: Tagged<'v1', RequestParams<'host_account_get_alias', 'v1'>>) {
      return makeRequest(transport, 'host_account_get_alias', payload)
        .mapErr(e => hydrate(e, RequestCredentialsErr.fromPlain));
    },

    accountCreateProof(payload: Tagged<'v1', RequestParams<'host_account_create_proof', 'v1'>>) {
      return makeRequest(transport, 'host_account_create_proof', payload)
        .mapErr(e => hydrate(e, CreateProofErr.fromPlain));
    },

    getNonProductAccounts(payload: Tagged<'v1', RequestParams<'host_get_non_product_accounts', 'v1'>>) {
      return makeRequest(transport, 'host_get_non_product_accounts', payload)
        .mapErr(e => hydrate(e, RequestCredentialsErr.fromPlain));
    },

    // -- Transactions -------------------------------------------------------

    createTransaction(payload: Tagged<'v1', RequestParams<'host_create_transaction', 'v1'>>) {
      return makeRequest(transport, 'host_create_transaction', payload)
        .mapErr(e => hydrate(e, CreateTransactionErr.fromPlain));
    },

    createTransactionWithNonProductAccount(payload: Tagged<'v1', RequestParams<'host_create_transaction_with_non_product_account', 'v1'>>) {
      return makeRequest(transport, 'host_create_transaction_with_non_product_account', payload)
        .mapErr(e => hydrate(e, CreateTransactionErr.fromPlain));
    },

    // -- Signing ------------------------------------------------------------

    signRaw(payload: Tagged<'v1', RequestParams<'host_sign_raw', 'v1'>>) {
      return makeRequest(transport, 'host_sign_raw', payload)
        .mapErr(e => hydrate(e, SigningErr.fromPlain));
    },

    signPayload(payload: Tagged<'v1', RequestParams<'host_sign_payload', 'v1'>>) {
      return makeRequest(transport, 'host_sign_payload', payload)
        .mapErr(e => hydrate(e, SigningErr.fromPlain));
    },

    // -- Chat ---------------------------------------------------------------

    chatListSubscribe(
      args: Tagged<'v1', SubscriptionParams<'host_chat_list_subscribe', 'v1'>>,
      callback: (payload: Tagged<'v1', SubscriptionPayload<'host_chat_list_subscribe', 'v1'>>) => void,
    ): Subscription {
      return makeSubscription(transport, 'host_chat_list_subscribe', args, callback);
    },

    chatCreateRoom(payload: Tagged<'v1', RequestParams<'host_chat_create_room', 'v1'>>) {
      return makeRequest(transport, 'host_chat_create_room', payload)
        .mapErr(e => hydrate(e, ChatRoomRegistrationErr.fromPlain));
    },

    chatRegisterBot(payload: Tagged<'v1', RequestParams<'host_chat_register_bot', 'v1'>>) {
      return makeRequest(transport, 'host_chat_register_bot', payload)
        .mapErr(e => hydrate(e, ChatBotRegistrationErr.fromPlain));
    },

    chatPostMessage(payload: Tagged<'v1', RequestParams<'host_chat_post_message', 'v1'>>) {
      return makeRequest(transport, 'host_chat_post_message', payload)
        .mapErr(e => hydrate(e, ChatMessagePostingErr.fromPlain));
    },

    chatActionSubscribe(
      args: Tagged<'v1', SubscriptionParams<'host_chat_action_subscribe', 'v1'>>,
      callback: (payload: Tagged<'v1', SubscriptionPayload<'host_chat_action_subscribe', 'v1'>>) => void,
    ): Subscription {
      return makeSubscription(transport, 'host_chat_action_subscribe', args, callback);
    },

    productChatCustomMessageRenderSubscribe(
      args: Tagged<'v1', SubscriptionParams<'product_chat_custom_message_render_subscribe', 'v1'>>,
      callback: (payload: Tagged<'v1', SubscriptionPayload<'product_chat_custom_message_render_subscribe', 'v1'>>) => void,
    ): Subscription {
      return makeSubscription(transport, 'product_chat_custom_message_render_subscribe', args, callback);
    },

    // -- Statement store ----------------------------------------------------

    statementStoreSubscribe(
      args: Tagged<'v1', SubscriptionParams<'remote_statement_store_subscribe', 'v1'>>,
      callback: (payload: Tagged<'v1', SubscriptionPayload<'remote_statement_store_subscribe', 'v1'>>) => void,
    ): Subscription {
      return makeSubscription(transport, 'remote_statement_store_subscribe', args, callback);
    },

    statementStoreCreateProof(payload: Tagged<'v1', RequestParams<'remote_statement_store_create_proof', 'v1'>>) {
      return makeRequest(transport, 'remote_statement_store_create_proof', payload)
        .mapErr(e => hydrate(e, StatementProofErr.fromPlain));
    },

    statementStoreSubmit(payload: Tagged<'v1', RequestParams<'remote_statement_store_submit', 'v1'>>) {
      return makeRequest(transport, 'remote_statement_store_submit', payload)
        .mapErr(hydrateGeneric);
    },

    // -- Preimage -----------------------------------------------------------

    preimageLookupSubscribe(
      args: Tagged<'v1', SubscriptionParams<'remote_preimage_lookup_subscribe', 'v1'>>,
      callback: (payload: Tagged<'v1', SubscriptionPayload<'remote_preimage_lookup_subscribe', 'v1'>>) => void,
    ): Subscription {
      return makeSubscription(transport, 'remote_preimage_lookup_subscribe', args, callback);
    },

    preimageSubmit(payload: Tagged<'v1', RequestParams<'remote_preimage_submit', 'v1'>>) {
      return makeRequest(transport, 'remote_preimage_submit', payload)
        .mapErr(e => hydrate(e, PreimageSubmitErr.fromPlain));
    },

    // -- JSON-RPC bridge ----------------------------------------------------

    jsonrpcMessageSend(payload: Tagged<'v1', RequestParams<'host_jsonrpc_message_send', 'v1'>>) {
      return makeRequest(transport, 'host_jsonrpc_message_send', payload)
        .mapErr(hydrateGeneric);
    },

    jsonrpcMessageSubscribe(
      args: Tagged<'v1', SubscriptionParams<'host_jsonrpc_message_subscribe', 'v1'>>,
      callback: (payload: Tagged<'v1', SubscriptionPayload<'host_jsonrpc_message_subscribe', 'v1'>>) => void,
    ): Subscription {
      return makeSubscription(transport, 'host_jsonrpc_message_subscribe', args, callback);
    },

    // -- Remote chain (new JSON-RPC spec) -----------------------------------

    chainHeadFollow(
      args: Tagged<'v1', SubscriptionParams<'remote_chain_head_follow', 'v1'>>,
      callback: (payload: Tagged<'v1', SubscriptionPayload<'remote_chain_head_follow', 'v1'>>) => void,
    ): Subscription {
      return makeSubscription(transport, 'remote_chain_head_follow', args, callback);
    },

    chainHeadHeader(payload: Tagged<'v1', RequestParams<'remote_chain_head_header', 'v1'>>) {
      return makeRequest(transport, 'remote_chain_head_header', payload).mapErr(hydrateGeneric);
    },

    chainHeadBody(payload: Tagged<'v1', RequestParams<'remote_chain_head_body', 'v1'>>) {
      return makeRequest(transport, 'remote_chain_head_body', payload).mapErr(hydrateGeneric);
    },

    chainHeadStorage(payload: Tagged<'v1', RequestParams<'remote_chain_head_storage', 'v1'>>) {
      return makeRequest(transport, 'remote_chain_head_storage', payload).mapErr(hydrateGeneric);
    },

    chainHeadCall(payload: Tagged<'v1', RequestParams<'remote_chain_head_call', 'v1'>>) {
      return makeRequest(transport, 'remote_chain_head_call', payload).mapErr(hydrateGeneric);
    },

    chainHeadUnpin(payload: Tagged<'v1', RequestParams<'remote_chain_head_unpin', 'v1'>>) {
      return makeRequest(transport, 'remote_chain_head_unpin', payload).mapErr(hydrateGeneric);
    },

    chainHeadContinue(payload: Tagged<'v1', RequestParams<'remote_chain_head_continue', 'v1'>>) {
      return makeRequest(transport, 'remote_chain_head_continue', payload).mapErr(hydrateGeneric);
    },

    chainHeadStopOperation(payload: Tagged<'v1', RequestParams<'remote_chain_head_stop_operation', 'v1'>>) {
      return makeRequest(transport, 'remote_chain_head_stop_operation', payload).mapErr(hydrateGeneric);
    },

    chainSpecGenesisHash(payload: Tagged<'v1', RequestParams<'remote_chain_spec_genesis_hash', 'v1'>>) {
      return makeRequest(transport, 'remote_chain_spec_genesis_hash', payload).mapErr(hydrateGeneric);
    },

    chainSpecChainName(payload: Tagged<'v1', RequestParams<'remote_chain_spec_chain_name', 'v1'>>) {
      return makeRequest(transport, 'remote_chain_spec_chain_name', payload).mapErr(hydrateGeneric);
    },

    chainSpecProperties(payload: Tagged<'v1', RequestParams<'remote_chain_spec_properties', 'v1'>>) {
      return makeRequest(transport, 'remote_chain_spec_properties', payload).mapErr(hydrateGeneric);
    },

    chainTransactionBroadcast(payload: Tagged<'v1', RequestParams<'remote_chain_transaction_broadcast', 'v1'>>) {
      return makeRequest(transport, 'remote_chain_transaction_broadcast', payload).mapErr(hydrateGeneric);
    },

    chainTransactionStop(payload: Tagged<'v1', RequestParams<'remote_chain_transaction_stop', 'v1'>>) {
      return makeRequest(transport, 'remote_chain_transaction_stop', payload).mapErr(hydrateGeneric);
    },
  };
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

/**
 * Default HostApi instance bound to the default sandbox transport.
 */
export const hostApi = createHostApi(sandboxTransport);

/**
 * Return type of `createHostApi`.
 */
export type HostApi = ReturnType<typeof createHostApi>;
