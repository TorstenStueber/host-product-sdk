/**
 * API protocol definition.
 *
 * This is the core of the entire project: the definition of what methods
 * exist in the host-product API and what their argument/return types are.
 *
 * `hostApiProtocol` is the registry of all protocol methods with their
 * versioned SCALE codec pairs. Types are defined as SCALE codecs (not just
 * TypeScript types) so the wire format is the single source of truth.
 * TypeScript types are derived from the codecs via `CodecType<>`.
 *
 * `MessagePayload` and `Message` define the top-level wire envelope.
 *
 * The derived mapped types (`RequestMethod`, `RequestCodecType<M>`,
 * `RequestParams<M,V>`, `ResponseOk<M,V>`, etc.) are used by both
 * facades and the transport layer for end-to-end type safety.
 */

import { Enum, Hex } from '../shared/codec/scale/primitives.js';
import type { Codec, CodecType, StringRecord } from 'scale-ts';
import { Bytes, Option, Result, Struct, Tuple, Vector, bool, str, u8, _void } from 'scale-ts';

// -- v1 building-block codec imports ------------------------------------------

import { GenesisHash, GenericErr } from '../shared/codec/scale/v1/commonCodecs.js';
import { HandshakeErr } from '../shared/codec/scale/v1/handshake.js';
import { Feature } from '../shared/codec/scale/v1/feature.js';
import { PushNotification } from '../shared/codec/scale/v1/notification.js';
import { NavigateToErr } from '../shared/codec/scale/v1/navigation.js';
import { DevicePermissionRequest } from '../shared/codec/scale/v1/devicePermission.js';
import { RemotePermissionRequest } from '../shared/codec/scale/v1/remotePermission.js';
import { StorageKey, StorageValue, StorageErr } from '../shared/codec/scale/v1/localStorage.js';
import {
  ProductAccountId,
  Account,
  ContextualAlias,
  RingLocation,
  RingVrfProof,
  RequestCredentialsErr,
  CreateProofErr,
  AccountConnectionStatus,
} from '../shared/codec/scale/v1/accounts.js';
import { CreateTransactionErr, VersionedTxPayload } from '../shared/codec/scale/v1/createTransaction.js';
import { SigningRawPayload, SigningPayload, SigningResult, SigningErr } from '../shared/codec/scale/v1/sign.js';
import {
  ChatRoomRequest,
  ChatRoomRegistrationResult,
  ChatRoomRegistrationErr,
  ChatBotRequest,
  ChatBotRegistrationResult,
  ChatBotRegistrationErr,
  ChatRoom,
  ChatMessageContent,
  ChatPostMessageResult,
  ChatMessagePostingErr,
  ReceivedChatAction,
} from '../shared/codec/scale/v1/chat.js';
import { CustomRendererNode } from '../shared/codec/scale/v1/customRenderer.js';
import {
  Topic,
  SignedStatement,
  Statement,
  StatementProof,
  StatementProofErr,
} from '../shared/codec/scale/v1/statementStore.js';
import { PreimageKey, PreimageValue, PreimageSubmitErr } from '../shared/codec/scale/v1/preimage.js';
import {
  BlockHash,
  OperationId,
  StorageQueryItem,
  OperationStartedResult,
  ChainHeadEvent,
} from '../shared/codec/scale/v1/chainInteraction.js';

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
    _request: Enum({ v1: u8 }),
    _response: Enum({ v1: Result(_void, HandshakeErr) }),
  },
  host_feature_supported: {
    _request: Enum({ v1: Feature }),
    _response: Enum({ v1: Result(bool, GenericErr) }),
  },
  host_push_notification: {
    _request: Enum({ v1: PushNotification }),
    _response: Enum({ v1: Result(_void, GenericErr) }),
  },
  host_navigate_to: {
    _request: Enum({ v1: str }),
    _response: Enum({ v1: Result(_void, NavigateToErr) }),
  },

  // Permissions
  host_device_permission: {
    _request: Enum({ v1: DevicePermissionRequest }),
    _response: Enum({ v1: Result(bool, GenericErr) }),
  },
  remote_permission: {
    _request: Enum({ v1: RemotePermissionRequest }),
    _response: Enum({ v1: Result(bool, GenericErr) }),
  },

  // Local storage
  host_local_storage_read: {
    _request: Enum({ v1: StorageKey }),
    _response: Enum({ v1: Result(Option(StorageValue), StorageErr) }),
  },
  host_local_storage_write: {
    _request: Enum({ v1: Tuple(StorageKey, StorageValue) }),
    _response: Enum({ v1: Result(_void, StorageErr) }),
  },
  host_local_storage_clear: {
    _request: Enum({ v1: StorageKey }),
    _response: Enum({ v1: Result(_void, StorageErr) }),
  },

  // Accounts
  host_account_connection_status_subscribe: {
    _start: Enum({ v1: _void }),
    _receive: Enum({ v1: AccountConnectionStatus }),
  },
  host_account_get: {
    _request: Enum({ v1: ProductAccountId }),
    _response: Enum({ v1: Result(Account, RequestCredentialsErr) }),
  },
  host_account_get_alias: {
    _request: Enum({ v1: ProductAccountId }),
    _response: Enum({ v1: Result(ContextualAlias, RequestCredentialsErr) }),
  },
  host_account_create_proof: {
    _request: Enum({ v1: Tuple(ProductAccountId, RingLocation, Bytes()) }),
    _response: Enum({ v1: Result(RingVrfProof, CreateProofErr) }),
  },
  host_get_non_product_accounts: {
    _request: Enum({ v1: _void }),
    _response: Enum({ v1: Result(Vector(Account), RequestCredentialsErr) }),
  },

  // Transactions
  host_create_transaction: {
    _request: Enum({ v1: Tuple(ProductAccountId, VersionedTxPayload) }),
    _response: Enum({ v1: Result(Hex(), CreateTransactionErr) }),
  },
  host_create_transaction_with_non_product_account: {
    _request: Enum({ v1: VersionedTxPayload }),
    _response: Enum({ v1: Result(Hex(), CreateTransactionErr) }),
  },

  // Signing
  host_sign_raw: {
    _request: Enum({ v1: SigningRawPayload }),
    _response: Enum({ v1: Result(SigningResult, SigningErr) }),
  },
  host_sign_payload: {
    _request: Enum({ v1: SigningPayload }),
    _response: Enum({ v1: Result(SigningResult, SigningErr) }),
  },

  // Chat
  host_chat_create_room: {
    _request: Enum({ v1: ChatRoomRequest }),
    _response: Enum({ v1: Result(ChatRoomRegistrationResult, ChatRoomRegistrationErr) }),
  },
  host_chat_register_bot: {
    _request: Enum({ v1: ChatBotRequest }),
    _response: Enum({ v1: Result(ChatBotRegistrationResult, ChatBotRegistrationErr) }),
  },
  host_chat_list_subscribe: {
    _start: Enum({ v1: _void }),
    _receive: Enum({ v1: Vector(ChatRoom) }),
  },
  host_chat_post_message: {
    _request: Enum({ v1: Struct({ roomId: str, payload: ChatMessageContent }) }),
    _response: Enum({ v1: Result(ChatPostMessageResult, ChatMessagePostingErr) }),
  },
  host_chat_action_subscribe: {
    _start: Enum({ v1: _void }),
    _receive: Enum({ v1: ReceivedChatAction }),
  },
  product_chat_custom_message_render_subscribe: {
    _start: Enum({ v1: Struct({ messageId: str, messageType: str, payload: Bytes() }) }),
    _receive: Enum({ v1: CustomRendererNode }),
  },

  // Statement store
  remote_statement_store_subscribe: {
    _start: Enum({ v1: Vector(Topic) }),
    _receive: Enum({ v1: Vector(SignedStatement) }),
  },
  remote_statement_store_create_proof: {
    _request: Enum({ v1: Tuple(ProductAccountId, Statement) }),
    _response: Enum({ v1: Result(StatementProof, StatementProofErr) }),
  },
  remote_statement_store_submit: {
    _request: Enum({ v1: SignedStatement }),
    _response: Enum({ v1: Result(_void, GenericErr) }),
  },

  // Preimage
  remote_preimage_lookup_subscribe: {
    _start: Enum({ v1: PreimageKey }),
    _receive: Enum({ v1: Option(PreimageValue) }),
  },
  remote_preimage_submit: {
    _request: Enum({ v1: PreimageValue }),
    _response: Enum({ v1: Result(PreimageKey, PreimageSubmitErr) }),
  },

  // JSON-RPC bridge
  host_jsonrpc_message_send: {
    _request: Enum({ v1: Tuple(GenesisHash, str) }),
    _response: Enum({ v1: Result(_void, GenericErr) }),
  },
  host_jsonrpc_message_subscribe: {
    _start: Enum({ v1: GenesisHash }),
    _receive: Enum({ v1: str }),
  },

  // Remote chain
  remote_chain_head_follow: {
    _start: Enum({ v1: Struct({ genesisHash: GenesisHash, withRuntime: bool }) }),
    _receive: Enum({ v1: ChainHeadEvent }),
  },
  remote_chain_head_header: {
    _request: Enum({ v1: Struct({ genesisHash: GenesisHash, followSubscriptionId: str, hash: BlockHash }) }),
    _response: Enum({ v1: Result(Option(Hex()), GenericErr) }),
  },
  remote_chain_head_body: {
    _request: Enum({ v1: Struct({ genesisHash: GenesisHash, followSubscriptionId: str, hash: BlockHash }) }),
    _response: Enum({ v1: Result(OperationStartedResult, GenericErr) }),
  },
  remote_chain_head_storage: {
    _request: Enum({
      v1: Struct({
        genesisHash: GenesisHash,
        followSubscriptionId: str,
        hash: BlockHash,
        items: Vector(StorageQueryItem),
        childTrie: Option(Hex()),
      }),
    }),
    _response: Enum({ v1: Result(OperationStartedResult, GenericErr) }),
  },
  remote_chain_head_call: {
    _request: Enum({
      v1: Struct({
        genesisHash: GenesisHash,
        followSubscriptionId: str,
        hash: BlockHash,
        function: str,
        callParameters: Hex(),
      }),
    }),
    _response: Enum({ v1: Result(OperationStartedResult, GenericErr) }),
  },
  remote_chain_head_unpin: {
    _request: Enum({ v1: Struct({ genesisHash: GenesisHash, followSubscriptionId: str, hashes: Vector(BlockHash) }) }),
    _response: Enum({ v1: Result(_void, GenericErr) }),
  },
  remote_chain_head_continue: {
    _request: Enum({ v1: Struct({ genesisHash: GenesisHash, followSubscriptionId: str, operationId: OperationId }) }),
    _response: Enum({ v1: Result(_void, GenericErr) }),
  },
  remote_chain_head_stop_operation: {
    _request: Enum({ v1: Struct({ genesisHash: GenesisHash, followSubscriptionId: str, operationId: OperationId }) }),
    _response: Enum({ v1: Result(_void, GenericErr) }),
  },
  remote_chain_spec_genesis_hash: {
    _request: Enum({ v1: GenesisHash }),
    _response: Enum({ v1: Result(Hex(), GenericErr) }),
  },
  remote_chain_spec_chain_name: {
    _request: Enum({ v1: GenesisHash }),
    _response: Enum({ v1: Result(str, GenericErr) }),
  },
  remote_chain_spec_properties: {
    _request: Enum({ v1: GenesisHash }),
    _response: Enum({ v1: Result(str, GenericErr) }),
  },
  remote_chain_transaction_broadcast: {
    _request: Enum({ v1: Struct({ genesisHash: GenesisHash, transaction: Hex() }) }),
    _response: Enum({ v1: Result(Option(str), GenericErr) }),
  },
  remote_chain_transaction_stop: {
    _request: Enum({ v1: Struct({ genesisHash: GenesisHash, operationId: str }) }),
    _response: Enum({ v1: Result(_void, GenericErr) }),
  },

  // Codec upgrade (our extension -- not in original triangle-js-sdks)
  host_codec_upgrade: {
    _request: Enum({ v1: Struct({ supportedFormats: Vector(str) }) }),
    _response: Enum({ v1: Struct({ selectedFormat: str }) }),
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
export type ActionString = `${RequestMethod}_${RequestSuffix}` | `${SubscriptionMethod}_${SubscriptionSuffix}`;

// -- Derived per-method per-version types -------------------------------------

/** Full decoded type of a request method's _request codec (versioned envelope). */
export type RequestCodecType<M extends RequestMethod> = CodecType<Protocol[M]['_request']>;

/** Full decoded type of a request method's _response codec (versioned envelope). */
export type ResponseCodecType<M extends RequestMethod> = CodecType<Protocol[M]['_response']>;

/** Full decoded type of a subscription method's _start codec (versioned envelope). */
export type StartCodecType<M extends SubscriptionMethod> = CodecType<Protocol[M]['_start']>;

/** Full decoded type of a subscription method's _receive codec (versioned envelope). */
export type ReceiveCodecType<M extends SubscriptionMethod> = CodecType<Protocol[M]['_receive']>;

/** Available version tags for a request method's _request codec. */
export type RequestVersions<M extends RequestMethod> = RequestCodecType<M>['tag'];

/** Available version tags for a request method's _response codec. */
export type ResponseVersions<M extends RequestMethod> = ResponseCodecType<M>['tag'];

/** Available version tags for a subscription method's _start codec. */
export type StartVersions<M extends SubscriptionMethod> = StartCodecType<M>['tag'];

/** Available version tags for a subscription method's _receive codec. */
export type ReceiveVersions<M extends SubscriptionMethod> = ReceiveCodecType<M>['tag'];

/** Extract the inner value type for a specific version tag from a versioned enum type. */
type VersionValue<T, V extends string> = Extract<T, { tag: V }> extends { value: infer U } ? U : never;

/** Request params type for method M at version V. */
export type RequestParams<M extends RequestMethod, V extends string> = VersionValue<RequestCodecType<M>, V>;

/** The full Result type for method M's response at version V. */
type ResponseResultType<M extends RequestMethod, V extends string> = VersionValue<ResponseCodecType<M>, V>;

/** Ok type from a request method's response Result at version V. */
export type ResponseOk<M extends RequestMethod, V extends string> =
  Extract<ResponseResultType<M, V>, { success: true }> extends { value: infer U } ? U : never;

/** Err type from a request method's response Result at version V. */
export type ResponseErr<M extends RequestMethod, V extends string> =
  Extract<ResponseResultType<M, V>, { success: false }> extends { value: infer U } ? U : never;

/** Subscription start params type for method M at version V. */
export type SubscriptionParams<M extends SubscriptionMethod, V extends string> = VersionValue<StartCodecType<M>, V>;

/** Subscription receive payload type for method M at version V. */
export type SubscriptionPayload<M extends SubscriptionMethod, V extends string> = VersionValue<ReceiveCodecType<M>, V>;

// -- Wire envelope ------------------------------------------------------------

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
