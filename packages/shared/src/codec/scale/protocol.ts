/**
 * Protocol codec registry.
 *
 * Assembles all v1 SCALE codecs into the MessagePayload enum and
 * the top-level Message struct used on the wire.
 *
 * Each method's request/response (or start/receive) codecs are wrapped
 * in a versioned enum: `Enum({ v1: codec })`. This matches the original
 * triangle-js-sdks wire format. When a v2 is added for a method, it
 * becomes `Enum({ v1: codec1, v2: codec2 })` — each method versions
 * its types independently.
 *
 * Subscriptions may omit `_stop` and `_interrupt` — they default to
 * `_void` in the MessagePayload enum.
 */

import { Enum } from './primitives.js';
import type { Codec, StringRecord } from 'scale-ts';
import { Struct, _void, str } from 'scale-ts';

// -- v1 codec imports ---------------------------------------------------------

import { HandshakeV1_request, HandshakeV1_response } from './v1/handshake.js';
import { FeatureV1_request, FeatureV1_response } from './v1/feature.js';
import { PushNotificationV1_request, PushNotificationV1_response } from './v1/notification.js';
import { NavigateToV1_request, NavigateToV1_response } from './v1/navigation.js';
import { DevicePermissionV1_request, DevicePermissionV1_response } from './v1/devicePermission.js';
import { RemotePermissionV1_request, RemotePermissionV1_response } from './v1/remotePermission.js';
import {
  StorageReadV1_request, StorageReadV1_response,
  StorageWriteV1_request, StorageWriteV1_response,
  StorageClearV1_request, StorageClearV1_response,
} from './v1/localStorage.js';
import {
  AccountGetV1_request, AccountGetV1_response,
  AccountGetAliasV1_request, AccountGetAliasV1_response,
  AccountCreateProofV1_request, AccountCreateProofV1_response,
  GetNonProductAccountsV1_request, GetNonProductAccountsV1_response,
  AccountConnectionStatusV1_start, AccountConnectionStatusV1_receive,
} from './v1/accounts.js';
import {
  CreateTransactionV1_request, CreateTransactionV1_response,
  CreateTransactionWithNonProductV1_request, CreateTransactionWithNonProductV1_response,
} from './v1/createTransaction.js';
import {
  SignRawV1_request, SignRawV1_response,
  SignPayloadV1_request, SignPayloadV1_response,
} from './v1/sign.js';
import {
  ChatCreateRoomV1_request, ChatCreateRoomV1_response,
  ChatRegisterBotV1_request, ChatRegisterBotV1_response,
  ChatListV1_start, ChatListV1_receive,
  ChatPostMessageV1_request, ChatPostMessageV1_response,
  ChatActionSubscribeV1_start, ChatActionSubscribeV1_receive,
  ChatCustomMessageRenderV1_start, ChatCustomMessageRenderV1_receive,
} from './v1/chat.js';
import {
  StatementStoreV1_start, StatementStoreV1_receive,
  StatementStoreCreateProofV1_request, StatementStoreCreateProofV1_response,
  StatementStoreSubmitV1_request, StatementStoreSubmitV1_response,
} from './v1/statementStore.js';
import {
  PreimageLookupV1_start, PreimageLookupV1_receive,
  PreimageSubmitV1_request, PreimageSubmitV1_response,
} from './v1/preimage.js';
import {
  JsonRpcMessageSendV1_request, JsonRpcMessageSendV1_response,
  JsonRpcMessageSubscribeV1_start, JsonRpcMessageSubscribeV1_receive,
} from './v1/jsonRpc.js';
import {
  ChainHeadFollowV1_start, ChainHeadFollowV1_receive,
  ChainHeadHeaderV1_request, ChainHeadHeaderV1_response,
  ChainHeadBodyV1_request, ChainHeadBodyV1_response,
  ChainHeadStorageV1_request, ChainHeadStorageV1_response,
  ChainHeadCallV1_request, ChainHeadCallV1_response,
  ChainHeadUnpinV1_request, ChainHeadUnpinV1_response,
  ChainHeadContinueV1_request, ChainHeadContinueV1_response,
  ChainHeadStopOperationV1_request, ChainHeadStopOperationV1_response,
  ChainSpecGenesisHashV1_request, ChainSpecGenesisHashV1_response,
  ChainSpecChainNameV1_request, ChainSpecChainNameV1_response,
  ChainSpecPropertiesV1_request, ChainSpecPropertiesV1_response,
  TransactionBroadcastV1_request, TransactionBroadcastV1_response,
  TransactionStopV1_request, TransactionStopV1_response,
} from './v1/chainInteraction.js';

// -- Protocol registry --------------------------------------------------------

/**
 * All protocol methods with their versioned codec pairs.
 *
 * Request methods have `_request` and `_response` keys.
 * Subscription methods have `_start` and `_receive` keys
 * (`_stop` and `_interrupt` are inferred as `_void`).
 *
 * Each key is a versioned enum: `Enum({ v1: codec })`.
 * When adding a v2, extend the enum: `Enum({ v1: codec1, v2: codec2 })`.
 */
export const hostApiProtocol = {
  // Core / lifecycle
  host_handshake: {
    _request: Enum({ v1: HandshakeV1_request }),
    _response: Enum({ v1: HandshakeV1_response }),
  },
  host_feature_supported: {
    _request: Enum({ v1: FeatureV1_request }),
    _response: Enum({ v1: FeatureV1_response }),
  },
  host_push_notification: {
    _request: Enum({ v1: PushNotificationV1_request }),
    _response: Enum({ v1: PushNotificationV1_response }),
  },
  host_navigate_to: {
    _request: Enum({ v1: NavigateToV1_request }),
    _response: Enum({ v1: NavigateToV1_response }),
  },

  // Permissions
  host_device_permission: {
    _request: Enum({ v1: DevicePermissionV1_request }),
    _response: Enum({ v1: DevicePermissionV1_response }),
  },
  remote_permission: {
    _request: Enum({ v1: RemotePermissionV1_request }),
    _response: Enum({ v1: RemotePermissionV1_response }),
  },

  // Local storage
  host_local_storage_read: {
    _request: Enum({ v1: StorageReadV1_request }),
    _response: Enum({ v1: StorageReadV1_response }),
  },
  host_local_storage_write: {
    _request: Enum({ v1: StorageWriteV1_request }),
    _response: Enum({ v1: StorageWriteV1_response }),
  },
  host_local_storage_clear: {
    _request: Enum({ v1: StorageClearV1_request }),
    _response: Enum({ v1: StorageClearV1_response }),
  },

  // Accounts
  host_account_connection_status_subscribe: {
    _start: Enum({ v1: AccountConnectionStatusV1_start }),
    _receive: Enum({ v1: AccountConnectionStatusV1_receive }),
  },
  host_account_get: {
    _request: Enum({ v1: AccountGetV1_request }),
    _response: Enum({ v1: AccountGetV1_response }),
  },
  host_account_get_alias: {
    _request: Enum({ v1: AccountGetAliasV1_request }),
    _response: Enum({ v1: AccountGetAliasV1_response }),
  },
  host_account_create_proof: {
    _request: Enum({ v1: AccountCreateProofV1_request }),
    _response: Enum({ v1: AccountCreateProofV1_response }),
  },
  host_get_non_product_accounts: {
    _request: Enum({ v1: GetNonProductAccountsV1_request }),
    _response: Enum({ v1: GetNonProductAccountsV1_response }),
  },

  // Transactions
  host_create_transaction: {
    _request: Enum({ v1: CreateTransactionV1_request }),
    _response: Enum({ v1: CreateTransactionV1_response }),
  },
  host_create_transaction_with_non_product_account: {
    _request: Enum({ v1: CreateTransactionWithNonProductV1_request }),
    _response: Enum({ v1: CreateTransactionWithNonProductV1_response }),
  },

  // Signing
  host_sign_raw: {
    _request: Enum({ v1: SignRawV1_request }),
    _response: Enum({ v1: SignRawV1_response }),
  },
  host_sign_payload: {
    _request: Enum({ v1: SignPayloadV1_request }),
    _response: Enum({ v1: SignPayloadV1_response }),
  },

  // Chat
  host_chat_create_room: {
    _request: Enum({ v1: ChatCreateRoomV1_request }),
    _response: Enum({ v1: ChatCreateRoomV1_response }),
  },
  host_chat_register_bot: {
    _request: Enum({ v1: ChatRegisterBotV1_request }),
    _response: Enum({ v1: ChatRegisterBotV1_response }),
  },
  host_chat_list_subscribe: {
    _start: Enum({ v1: ChatListV1_start }),
    _receive: Enum({ v1: ChatListV1_receive }),
  },
  host_chat_post_message: {
    _request: Enum({ v1: ChatPostMessageV1_request }),
    _response: Enum({ v1: ChatPostMessageV1_response }),
  },
  host_chat_action_subscribe: {
    _start: Enum({ v1: ChatActionSubscribeV1_start }),
    _receive: Enum({ v1: ChatActionSubscribeV1_receive }),
  },
  product_chat_custom_message_render_subscribe: {
    _start: Enum({ v1: ChatCustomMessageRenderV1_start }),
    _receive: Enum({ v1: ChatCustomMessageRenderV1_receive }),
  },

  // Statement store
  remote_statement_store_subscribe: {
    _start: Enum({ v1: StatementStoreV1_start }),
    _receive: Enum({ v1: StatementStoreV1_receive }),
  },
  remote_statement_store_create_proof: {
    _request: Enum({ v1: StatementStoreCreateProofV1_request }),
    _response: Enum({ v1: StatementStoreCreateProofV1_response }),
  },
  remote_statement_store_submit: {
    _request: Enum({ v1: StatementStoreSubmitV1_request }),
    _response: Enum({ v1: StatementStoreSubmitV1_response }),
  },

  // Preimage
  remote_preimage_lookup_subscribe: {
    _start: Enum({ v1: PreimageLookupV1_start }),
    _receive: Enum({ v1: PreimageLookupV1_receive }),
  },
  remote_preimage_submit: {
    _request: Enum({ v1: PreimageSubmitV1_request }),
    _response: Enum({ v1: PreimageSubmitV1_response }),
  },

  // JSON-RPC bridge
  host_jsonrpc_message_send: {
    _request: Enum({ v1: JsonRpcMessageSendV1_request }),
    _response: Enum({ v1: JsonRpcMessageSendV1_response }),
  },
  host_jsonrpc_message_subscribe: {
    _start: Enum({ v1: JsonRpcMessageSubscribeV1_start }),
    _receive: Enum({ v1: JsonRpcMessageSubscribeV1_receive }),
  },

  // Remote chain
  remote_chain_head_follow: {
    _start: Enum({ v1: ChainHeadFollowV1_start }),
    _receive: Enum({ v1: ChainHeadFollowV1_receive }),
  },
  remote_chain_head_header: {
    _request: Enum({ v1: ChainHeadHeaderV1_request }),
    _response: Enum({ v1: ChainHeadHeaderV1_response }),
  },
  remote_chain_head_body: {
    _request: Enum({ v1: ChainHeadBodyV1_request }),
    _response: Enum({ v1: ChainHeadBodyV1_response }),
  },
  remote_chain_head_storage: {
    _request: Enum({ v1: ChainHeadStorageV1_request }),
    _response: Enum({ v1: ChainHeadStorageV1_response }),
  },
  remote_chain_head_call: {
    _request: Enum({ v1: ChainHeadCallV1_request }),
    _response: Enum({ v1: ChainHeadCallV1_response }),
  },
  remote_chain_head_unpin: {
    _request: Enum({ v1: ChainHeadUnpinV1_request }),
    _response: Enum({ v1: ChainHeadUnpinV1_response }),
  },
  remote_chain_head_continue: {
    _request: Enum({ v1: ChainHeadContinueV1_request }),
    _response: Enum({ v1: ChainHeadContinueV1_response }),
  },
  remote_chain_head_stop_operation: {
    _request: Enum({ v1: ChainHeadStopOperationV1_request }),
    _response: Enum({ v1: ChainHeadStopOperationV1_response }),
  },
  remote_chain_spec_genesis_hash: {
    _request: Enum({ v1: ChainSpecGenesisHashV1_request }),
    _response: Enum({ v1: ChainSpecGenesisHashV1_response }),
  },
  remote_chain_spec_chain_name: {
    _request: Enum({ v1: ChainSpecChainNameV1_request }),
    _response: Enum({ v1: ChainSpecChainNameV1_response }),
  },
  remote_chain_spec_properties: {
    _request: Enum({ v1: ChainSpecPropertiesV1_request }),
    _response: Enum({ v1: ChainSpecPropertiesV1_response }),
  },
  remote_chain_transaction_broadcast: {
    _request: Enum({ v1: TransactionBroadcastV1_request }),
    _response: Enum({ v1: TransactionBroadcastV1_response }),
  },
  remote_chain_transaction_stop: {
    _request: Enum({ v1: TransactionStopV1_request }),
    _response: Enum({ v1: TransactionStopV1_response }),
  },

  // Codec upgrade (our extension -- not in original triangle-js-sdks)
  host_codec_upgrade: {
    _request: Enum({ v1: _void }),
    _response: Enum({ v1: _void }),
  },
} as const;

// -- Derived method name types ------------------------------------------------

type Protocol = typeof hostApiProtocol;

/** Union of all request method names (entries with `_request` / `_response`). */
export type RequestMethod = {
  [K in keyof Protocol]: '_request' extends keyof Protocol[K] ? K : never;
}[keyof Protocol];

/** Union of all subscription method names (entries with `_start` / `_receive`). */
export type SubscriptionMethod = {
  [K in keyof Protocol]: '_start' extends keyof Protocol[K] ? K : never;
}[keyof Protocol];

/** Action string suffixes for request methods. */
type RequestSuffix = 'request' | 'response';

/** Action string suffixes for subscription methods. */
type SubscriptionSuffix = 'start' | 'receive' | 'stop' | 'interrupt';

/** Union of all valid action strings on the wire. */
export type ActionString =
  | `${RequestMethod}_${RequestSuffix}`
  | `${SubscriptionMethod}_${SubscriptionSuffix}`;

// -- Derived per-method per-version types -------------------------------------
//
// These utility types extract the inner request params, response Ok/Err, and
// subscription params/payload types from hostApiProtocol, parameterized by
// method name and version tag (e.g. 'v1').

import type { CodecType } from 'scale-ts';

/** Full decoded type of a request method's _request codec. */
type RequestCodecType<M extends RequestMethod> = CodecType<Protocol[M]['_request']>;

/** Full decoded type of a request method's _response codec. */
type ResponseCodecType<M extends RequestMethod> = CodecType<Protocol[M]['_response']>;

/** Full decoded type of a subscription method's _start codec. */
type StartCodecType<M extends SubscriptionMethod> = CodecType<Protocol[M]['_start']>;

/** Full decoded type of a subscription method's _receive codec. */
type ReceiveCodecType<M extends SubscriptionMethod> = CodecType<Protocol[M]['_receive']>;

/** Available version tags for a request method's _request codec. */
export type RequestVersions<M extends RequestMethod> = RequestCodecType<M>['tag'];

/** Available version tags for a request method's _response codec. */
export type ResponseVersions<M extends RequestMethod> = ResponseCodecType<M>['tag'];

/** Available version tags for a subscription method's _start codec. */
export type StartVersions<M extends SubscriptionMethod> = StartCodecType<M>['tag'];

/** Available version tags for a subscription method's _receive codec. */
export type ReceiveVersions<M extends SubscriptionMethod> = ReceiveCodecType<M>['tag'];

/** Extract the inner value type for a specific version tag from a versioned enum type. */
type VersionValue<T, V extends string> =
  Extract<T, { tag: V }> extends { value: infer U } ? U : never;

/** Request params type for method M at version V. */
export type RequestParams<M extends RequestMethod, V extends string> =
  VersionValue<RequestCodecType<M>, V>;

/** The full Result type for method M's response at version V. */
type ResponseResultType<M extends RequestMethod, V extends string> =
  VersionValue<ResponseCodecType<M>, V>;

/** Ok type from a request method's response Result at version V. */
export type ResponseOk<M extends RequestMethod, V extends string> =
  Extract<ResponseResultType<M, V>, { success: true }> extends { value: infer U } ? U : never;

/** Err type from a request method's response Result at version V. */
export type ResponseErr<M extends RequestMethod, V extends string> =
  Extract<ResponseResultType<M, V>, { success: false }> extends { value: infer U } ? U : never;

/** Subscription start params type for method M at version V. */
export type SubscriptionParams<M extends SubscriptionMethod, V extends string> =
  VersionValue<StartCodecType<M>, V>;

/** Subscription receive payload type for method M at version V. */
export type SubscriptionPayload<M extends SubscriptionMethod, V extends string> =
  VersionValue<ReceiveCodecType<M>, V>;

// -- Build MessagePayload enum ------------------------------------------------

function buildMessagePayload(): Codec<{ tag: string; value: unknown }> {
  const fields: Record<string, Codec<any>> = {};

  for (const [name, entries] of Object.entries(hostApiProtocol)) {
    for (const [suffix, codec] of Object.entries(entries)) {
      fields[`${name}${suffix}`] = codec;
    }
    // Subscriptions: infer _stop and _interrupt as _void if not explicit
    if ('_start' in entries) {
      if (!('_stop' in entries)) fields[`${name}_stop`] = _void;
      if (!('_interrupt' in entries)) fields[`${name}_interrupt`] = _void;
    }
  }

  return Enum(fields as StringRecord<Codec<any>>) as unknown as Codec<{ tag: string; value: unknown }>;
}

export const MessagePayload = buildMessagePayload();

export const Message: Codec<{ requestId: string; payload: { tag: string; value: unknown } }> = Struct({
  requestId: str,
  payload: MessagePayload,
}) as unknown as Codec<{ requestId: string; payload: { tag: string; value: unknown } }>;

// -- SCALE codec adapter ------------------------------------------------------

import type { CodecAdapter, PostMessageData, ProtocolMessage } from '../adapter.js';

export function createScaleCodecAdapter(
  messageCodec: Codec<{ requestId: string; payload: { tag: string; value: unknown } }>,
): CodecAdapter {
  return {
    encode(message: ProtocolMessage): PostMessageData {
      return messageCodec.enc(message) as Uint8Array;
    },
    decode(data: PostMessageData): ProtocolMessage {
      if (!(data instanceof Uint8Array)) {
        throw new Error('SCALE codec expects Uint8Array input');
      }
      return messageCodec.dec(data);
    },
  };
}

/** Ready-to-use SCALE codec adapter for the full protocol. */
export const scaleCodecAdapter = createScaleCodecAdapter(Message);
