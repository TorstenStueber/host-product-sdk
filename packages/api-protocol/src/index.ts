/**
 * @polkadot/api-protocol -- Main entry point.
 *
 * The API protocol package defines the protocol, codecs, transport, and
 * facades for host-product communication.  It is organised into three
 * layers:
 *
 * - `shared/`   -- protocol types, codecs, transport, utilities
 * - `host/`     -- host-side facade (creates transport, wires handlers)
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
} from './api/types.js';

// ===========================================================================
// API protocol definition
// ===========================================================================

export { hostApiProtocol, Message, MessagePayload } from './api/protocol.js';
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
} from './api/protocol.js';

// ===========================================================================
// Shared: codec adapters
// ===========================================================================

export type { CodecAdapter, PostMessageData, ProtocolMessage } from './shared/codec/adapter.js';
export { createScaleCodecAdapter, scaleCodecAdapter } from './shared/codec/scale/adapter.js';
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
export type { Messaging } from './shared/transport/provider.js';

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

export { createHostFacade } from './host-facade/protocolHandler.js';
export type { CreateHostFacadeOptions } from './host-facade/protocolHandler.js';
export type { HostFacade } from './host-facade/types.js';

// ===========================================================================
// Product: facade
// ===========================================================================

export { createProductFacade } from './product-facade/hostApi.js';
export type { ProductFacade, CreateProductFacadeOptions } from './product-facade/hostApi.js';
