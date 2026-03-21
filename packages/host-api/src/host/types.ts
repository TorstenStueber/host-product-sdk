/**
 * ProtocolHandler types.
 *
 * The ProtocolHandler is the central type that bridges a host application with
 * an embedded product via the transport layer. It exposes handler
 * registration methods for every protocol method, translating between
 * the versioned wire format (v1 tagged enums) and plain TypeScript types.
 *
 * Handler param/ok/err types are derived from the SCALE codec definitions
 * in `hostApiProtocol` via `RequestParams`, `ResponseOk`, `ResponseErr`,
 * `SubscriptionParams`, and `SubscriptionPayload`.
 */

import type { ConnectionStatus, Transport, Subscription } from '../shared/transport/transport.js';
import type { HexString } from '../shared/codec/scale/primitives.js';
import type {
  RequestParams,
  ResponseOk,
  ResponseErr,
  SubscriptionParams,
  SubscriptionPayload,
  RequestMethod,
  SubscriptionMethod,
} from '../shared/codec/scale/protocol.js';
import type { ResultAsync } from 'neverthrow';
import type { JsonRpcProvider } from '@polkadot-api/json-rpc-provider';

// ---------------------------------------------------------------------------
// Protocol-derived handler types
// ---------------------------------------------------------------------------

/** Request handler type derived from protocol codecs for method M at version V. */
type RequestHandler<M extends RequestMethod, V extends string = 'v1'> = (
  params: RequestParams<M, V>,
) => ResultAsync<ResponseOk<M, V>, ResponseErr<M, V>>;

/** Subscription handler type derived from protocol codecs for method M. */
type SubscriptionHandlerFn<M extends SubscriptionMethod, SV extends string = 'v1', RV extends string = 'v1'> = (
  params: SubscriptionParams<M, SV>,
  send: (payload: SubscriptionPayload<M, RV>) => void,
  interrupt: () => void,
) => () => void;

// ---------------------------------------------------------------------------
// ProtocolHandler interface
// ---------------------------------------------------------------------------

export type ProtocolHandler = {
  // -- Core / lifecycle -----------------------------------------------------
  handleFeatureSupported(handler: RequestHandler<'host_feature_supported'>): () => void;
  handleDevicePermission(handler: RequestHandler<'host_device_permission'>): () => void;
  handlePermission(handler: RequestHandler<'remote_permission'>): () => void;
  handlePushNotification(handler: RequestHandler<'host_push_notification'>): () => void;
  handleNavigateTo(handler: RequestHandler<'host_navigate_to'>): () => void;

  // -- Local storage --------------------------------------------------------
  handleLocalStorageRead(handler: RequestHandler<'host_local_storage_read'>): () => void;
  handleLocalStorageWrite(handler: RequestHandler<'host_local_storage_write'>): () => void;
  handleLocalStorageClear(handler: RequestHandler<'host_local_storage_clear'>): () => void;

  // -- Accounts -------------------------------------------------------------
  handleAccountGet(handler: RequestHandler<'host_account_get'>): () => void;
  handleAccountGetAlias(handler: RequestHandler<'host_account_get_alias'>): () => void;
  handleAccountCreateProof(handler: RequestHandler<'host_account_create_proof'>): () => void;
  handleGetNonProductAccounts(handler: RequestHandler<'host_get_non_product_accounts'>): () => void;
  handleAccountConnectionStatusSubscribe(
    handler: SubscriptionHandlerFn<'host_account_connection_status_subscribe'>,
  ): () => void;

  // -- Signing --------------------------------------------------------------
  handleSignPayload(handler: RequestHandler<'host_sign_payload'>): () => void;
  handleSignRaw(handler: RequestHandler<'host_sign_raw'>): () => void;
  handleCreateTransaction(handler: RequestHandler<'host_create_transaction'>): () => void;
  handleCreateTransactionWithNonProductAccount(
    handler: RequestHandler<'host_create_transaction_with_non_product_account'>,
  ): () => void;

  // -- Chat -----------------------------------------------------------------
  handleChatCreateRoom(handler: RequestHandler<'host_chat_create_room'>): () => void;
  handleChatRegisterBot(handler: RequestHandler<'host_chat_register_bot'>): () => void;
  handleChatListSubscribe(handler: SubscriptionHandlerFn<'host_chat_list_subscribe'>): () => void;
  handleChatPostMessage(handler: RequestHandler<'host_chat_post_message'>): () => void;
  handleChatActionSubscribe(handler: SubscriptionHandlerFn<'host_chat_action_subscribe'>): () => void;

  /**
   * Initiate a custom message rendering subscription to the product.
   *
   * Unlike other container methods (which handle incoming requests from the
   * product), this method is host-initiated: the host subscribes to the
   * product and receives rendered UI nodes back.
   */
  renderChatCustomMessage(
    params: SubscriptionParams<'product_chat_custom_message_render_subscribe', 'v1'>,
    callback: (payload: SubscriptionPayload<'product_chat_custom_message_render_subscribe', 'v1'>) => void,
  ): Subscription;

  // -- Statement store ------------------------------------------------------
  handleStatementStoreSubscribe(handler: SubscriptionHandlerFn<'remote_statement_store_subscribe'>): () => void;
  handleStatementStoreCreateProof(handler: RequestHandler<'remote_statement_store_create_proof'>): () => void;
  handleStatementStoreSubmit(handler: RequestHandler<'remote_statement_store_submit'>): () => void;

  // -- Preimage -------------------------------------------------------------
  handlePreimageLookupSubscribe(handler: SubscriptionHandlerFn<'remote_preimage_lookup_subscribe'>): () => void;
  handlePreimageSubmit(handler: RequestHandler<'remote_preimage_submit'>): () => void;

  // -- Chain ----------------------------------------------------------------
  handleChainHeadFollow(handler: SubscriptionHandlerFn<'remote_chain_head_follow'>): () => void;
  handleChainHeadHeader(handler: RequestHandler<'remote_chain_head_header'>): () => void;
  handleChainHeadBody(handler: RequestHandler<'remote_chain_head_body'>): () => void;
  handleChainHeadStorage(handler: RequestHandler<'remote_chain_head_storage'>): () => void;
  handleChainHeadCall(handler: RequestHandler<'remote_chain_head_call'>): () => void;
  handleChainHeadUnpin(handler: RequestHandler<'remote_chain_head_unpin'>): () => void;
  handleChainHeadContinue(handler: RequestHandler<'remote_chain_head_continue'>): () => void;
  handleChainHeadStopOperation(handler: RequestHandler<'remote_chain_head_stop_operation'>): () => void;
  handleChainSpecGenesisHash(handler: RequestHandler<'remote_chain_spec_genesis_hash'>): () => void;
  handleChainSpecChainName(handler: RequestHandler<'remote_chain_spec_chain_name'>): () => void;
  handleChainSpecProperties(handler: RequestHandler<'remote_chain_spec_properties'>): () => void;
  handleChainTransactionBroadcast(handler: RequestHandler<'remote_chain_transaction_broadcast'>): () => void;
  handleChainTransactionStop(handler: RequestHandler<'remote_chain_transaction_stop'>): () => void;

  // -- High-level chain connection (wraps all chain_* methods) ---------------
  handleChainConnection(factory: (genesisHash: HexString) => JsonRpcProvider | undefined): () => void;

  // -- Transport lifecycle ---------------------------------------------------
  readonly transport: Transport;

  whenReady(): Promise<void>;
  subscribeProductConnectionStatus(callback: (status: ConnectionStatus) => void): () => void;
  dispose(): void;
};
