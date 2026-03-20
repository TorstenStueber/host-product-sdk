/**
 * Container types.
 *
 * The Container is the central type that bridges a host application with
 * an embedded product via the transport layer. It exposes handler
 * registration methods for every protocol method, translating between
 * the versioned wire format (v1 tagged enums) and plain TypeScript types.
 *
 * Handler param/ok/err types are derived from the SCALE codec definitions
 * in `hostApiProtocol` via `RequestParams`, `ResponseOk`, `ResponseErr`,
 * `SubscriptionParams`, and `SubscriptionPayload`.
 */

import type {
  ConnectionStatus,
  Transport,
  Subscription,
  HexString,
  RequestParams,
  ResponseOk,
  ResponseErr,
  SubscriptionParams,
  SubscriptionPayload,
  RequestMethod,
  SubscriptionMethod,
} from '@polkadot/shared';
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
) => VoidFunction;

// ---------------------------------------------------------------------------
// Container interface
// ---------------------------------------------------------------------------

export type Container = {
  // -- Core / lifecycle -----------------------------------------------------
  handleFeatureSupported(handler: RequestHandler<'host_feature_supported'>): VoidFunction;
  handleDevicePermission(handler: RequestHandler<'host_device_permission'>): VoidFunction;
  handlePermission(handler: RequestHandler<'remote_permission'>): VoidFunction;
  handlePushNotification(handler: RequestHandler<'host_push_notification'>): VoidFunction;
  handleNavigateTo(handler: RequestHandler<'host_navigate_to'>): VoidFunction;

  // -- Local storage --------------------------------------------------------
  handleLocalStorageRead(handler: RequestHandler<'host_local_storage_read'>): VoidFunction;
  handleLocalStorageWrite(handler: RequestHandler<'host_local_storage_write'>): VoidFunction;
  handleLocalStorageClear(handler: RequestHandler<'host_local_storage_clear'>): VoidFunction;

  // -- Accounts -------------------------------------------------------------
  handleAccountGet(handler: RequestHandler<'host_account_get'>): VoidFunction;
  handleAccountGetAlias(handler: RequestHandler<'host_account_get_alias'>): VoidFunction;
  handleAccountCreateProof(handler: RequestHandler<'host_account_create_proof'>): VoidFunction;
  handleGetNonProductAccounts(handler: RequestHandler<'host_get_non_product_accounts'>): VoidFunction;
  handleAccountConnectionStatusSubscribe(handler: SubscriptionHandlerFn<'host_account_connection_status_subscribe'>): VoidFunction;

  // -- Signing --------------------------------------------------------------
  handleSignPayload(handler: RequestHandler<'host_sign_payload'>): VoidFunction;
  handleSignRaw(handler: RequestHandler<'host_sign_raw'>): VoidFunction;
  handleCreateTransaction(handler: RequestHandler<'host_create_transaction'>): VoidFunction;
  handleCreateTransactionWithNonProductAccount(handler: RequestHandler<'host_create_transaction_with_non_product_account'>): VoidFunction;

  // -- Chat -----------------------------------------------------------------
  handleChatCreateRoom(handler: RequestHandler<'host_chat_create_room'>): VoidFunction;
  handleChatRegisterBot(handler: RequestHandler<'host_chat_register_bot'>): VoidFunction;
  handleChatListSubscribe(handler: SubscriptionHandlerFn<'host_chat_list_subscribe'>): VoidFunction;
  handleChatPostMessage(handler: RequestHandler<'host_chat_post_message'>): VoidFunction;
  handleChatActionSubscribe(handler: SubscriptionHandlerFn<'host_chat_action_subscribe'>): VoidFunction;

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
  handleStatementStoreSubscribe(handler: SubscriptionHandlerFn<'remote_statement_store_subscribe'>): VoidFunction;
  handleStatementStoreCreateProof(handler: RequestHandler<'remote_statement_store_create_proof'>): VoidFunction;
  handleStatementStoreSubmit(handler: RequestHandler<'remote_statement_store_submit'>): VoidFunction;

  // -- Preimage -------------------------------------------------------------
  handlePreimageLookupSubscribe(handler: SubscriptionHandlerFn<'remote_preimage_lookup_subscribe'>): VoidFunction;
  handlePreimageSubmit(handler: RequestHandler<'remote_preimage_submit'>): VoidFunction;

  // -- Chain ----------------------------------------------------------------
  handleChainHeadFollow(handler: SubscriptionHandlerFn<'remote_chain_head_follow'>): VoidFunction;
  handleChainHeadHeader(handler: RequestHandler<'remote_chain_head_header'>): VoidFunction;
  handleChainHeadBody(handler: RequestHandler<'remote_chain_head_body'>): VoidFunction;
  handleChainHeadStorage(handler: RequestHandler<'remote_chain_head_storage'>): VoidFunction;
  handleChainHeadCall(handler: RequestHandler<'remote_chain_head_call'>): VoidFunction;
  handleChainHeadUnpin(handler: RequestHandler<'remote_chain_head_unpin'>): VoidFunction;
  handleChainHeadContinue(handler: RequestHandler<'remote_chain_head_continue'>): VoidFunction;
  handleChainHeadStopOperation(handler: RequestHandler<'remote_chain_head_stop_operation'>): VoidFunction;
  handleChainSpecGenesisHash(handler: RequestHandler<'remote_chain_spec_genesis_hash'>): VoidFunction;
  handleChainSpecChainName(handler: RequestHandler<'remote_chain_spec_chain_name'>): VoidFunction;
  handleChainSpecProperties(handler: RequestHandler<'remote_chain_spec_properties'>): VoidFunction;
  handleChainTransactionBroadcast(handler: RequestHandler<'remote_chain_transaction_broadcast'>): VoidFunction;
  handleChainTransactionStop(handler: RequestHandler<'remote_chain_transaction_stop'>): VoidFunction;

  // -- High-level chain connection (wraps all chain_* methods) ---------------
  handleChainConnection(
    factory: (genesisHash: HexString) => JsonRpcProvider | null,
  ): VoidFunction;

  // -- Transport lifecycle ---------------------------------------------------
  readonly transport: Transport;

  isReady(): Promise<boolean>;
  subscribeProductConnectionStatus(callback: (status: ConnectionStatus) => void): VoidFunction;
  dispose(): void;
};
