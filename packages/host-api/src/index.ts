/**
 * @polkadot/host-api -- Main entry point.
 *
 * The Host API package defines the protocol, codecs, transport, and
 * facades for host-product communication.  It is organised into three
 * layers:
 *
 * - `shared/`   -- protocol types, codecs, transport, utilities
 * - `host/`     -- host-side protocol handler (creates transport, wires handlers)
 * - `product/`  -- product-side facade (creates transport, wraps methods)
 */

// ===========================================================================
// Shared: protocol domain types (derived from SCALE codecs via CodecType<>)
// ===========================================================================

export type {
  // Accounts
  AccountId,
  PublicKey,
  DotNsIdentifier,
  DerivationIndex,
  ProductAccountId,
  RingVrfProof,
  RingVrfAlias,
  Account,
  ContextualAlias,
  RingLocationHint,
  RingLocation,
  AccountConnectionStatus,

  // Signing
  SigningResult,
  RawPayload,
  SigningRawRequest,
  SigningPayloadRequest,

  // Transactions
  TxPayloadExtension,
  TxPayloadContext,
  TxPayloadV1,
  VersionedTxPayload,

  // Storage
  StorageKey,
  StorageValue,

  // Chat
  ChatRoomRequest,
  ChatRoomRegistrationStatus,
  ChatRoomRegistrationResult,
  ChatBotRequest,
  ChatBotRegistrationStatus,
  ChatBotRegistrationResult,
  ChatRoomParticipation,
  ChatRoom,
  ChatAction,
  ChatActionLayout,
  ChatActions,
  ChatMedia,
  ChatRichText,
  ChatFile,
  ChatReaction,
  ChatCustomMessage,
  ChatMessageContent,
  ChatPostMessageResult,
  ActionTrigger,
  ChatCommand,
  ChatActionPayload,
  ReceivedChatAction,

  // Chain
  BlockHash,
  OperationId,
  RuntimeApi,
  RuntimeSpec,
  RuntimeType,
  StorageQueryType,
  StorageQueryItem,
  StorageResultItem,
  OperationStartedResult,
  ChainHeadEvent,

  // Permissions
  DevicePermissionRequest,
  RemotePermissionRequest,

  // Notification
  PushNotification,

  // Statement store
  Topic,
  Channel,
  DecryptionKey,
  Sr25519StatementProof,
  Ed25519StatementProof,
  EcdsaStatementProof,
  OnChainStatementProof,
  StatementProof,
  Statement,
  SignedStatement,

  // Preimage
  PreimageKey,
  PreimageValue,

  // Custom renderer
  CustomRendererNode,

  // Feature
  Feature,
} from './shared/protocol/types.js';

// ===========================================================================
// Shared: codec
// ===========================================================================

export type { CodecAdapter, PostMessageData, ProtocolMessage } from './shared/codec/adapter.js';
export {
  createScaleCodecAdapter,
  scaleCodecAdapter,
  Message,
  MessagePayload,
  hostApiProtocol,
} from './shared/codec/scale/protocol.js';
export type {
  RequestMethod,
  SubscriptionMethod,
  ActionString,
  RequestVersions,
  ResponseVersions,
  StartVersions,
  ReceiveVersions,
  RequestCodecType,
  ResponseCodecType,
  StartCodecType,
  ReceiveCodecType,
  RequestParams,
  ResponseOk,
  ResponseErr,
  SubscriptionParams,
  SubscriptionPayload,
} from './shared/codec/scale/protocol.js';
export { structuredCloneCodecAdapter } from './shared/codec/structured/index.js';
export { UPGRADE_TIMEOUT, requestCodecUpgrade, handleCodecUpgrade } from './shared/codec/negotiation.js';
export type {
  CodecFormat,
  CodecAdapterMap,
  CodecUpgradeRequest,
  CodecUpgradeResponse,
} from './shared/codec/negotiation.js';

// ===========================================================================
// Shared: transport
// ===========================================================================

export {
  createTransport,
  HANDSHAKE_INTERVAL,
  HANDSHAKE_TIMEOUT,
  MethodNotSupportedError,
} from './shared/transport/transport.js';

export type {
  ConnectionStatus,
  CreateTransportOptions,
  Subscription,
  Transport,
} from './shared/transport/transport.js';

export type { Provider } from './shared/transport/provider.js';

export { createWindowProvider } from './shared/transport/windowProvider.js';
export type { WindowRef } from './shared/transport/windowProvider.js';

export { createMessagePortProvider } from './shared/transport/messagePortProvider.js';

// ===========================================================================
// Shared: utilities
// ===========================================================================

export { createDefaultLogger } from './shared/util/logger.js';
export type { Logger } from './shared/util/logger.js';

export { createIdFactory } from './shared/util/idFactory.js';
export { delay, promiseWithResolvers, composeAction, extractErrorMessage } from './shared/util/helpers.js';

// ===========================================================================
// Shared: common types
// ===========================================================================

export type { HexString } from './shared/codec/scale/primitives.js';
export { toHexString } from './shared/codec/scale/primitives.js';

export { ok, err, okAsync, errAsync, Result, ResultAsync } from 'neverthrow';
export type { Ok, Err } from 'neverthrow';

// ===========================================================================
// Host: protocol handler
// ===========================================================================

export { createProtocolHandler } from './host/protocolHandler.js';
export type { CreateProtocolHandlerOptions } from './host/protocolHandler.js';
export type { ProtocolHandler } from './host/types.js';

export { createHostWebviewProvider } from './host/webviewProvider.js';
export type { CreateHostWebviewProviderParams, WebviewTag } from './host/webviewProvider.js';

export { createChainConnectionManager } from './host/connectionManager.js';
export type { ChainConnectionManager } from './host/connectionManager.js';

// ===========================================================================
// Product: facade
// ===========================================================================

export { createHostApi } from './product/hostApi.js';
export type { HostApi, CreateHostApiOptions } from './product/hostApi.js';
