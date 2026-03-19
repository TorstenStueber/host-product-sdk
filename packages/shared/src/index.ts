/**
 * @polkadot/shared -- Main entry point.
 */

// ---------------------------------------------------------------------------
// Protocol domain types (derived from SCALE codecs via CodecType<>)
// ---------------------------------------------------------------------------

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
  CreateTransactionRequest,
  CreateTransactionWithNonProductRequest,

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
  ChainHeadFollowParams,
  ChainHeadRequestParams,
  ChainHeadStorageParams,
  ChainHeadCallParams,
  ChainHeadUnpinParams,
  ChainHeadOperationParams,
  TransactionBroadcastParams,
  TransactionStopParams,

  // Permissions
  DevicePermissionRequest,
  RemotePermissionRequest,

  // Navigation
  NavigateToRequest,

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
} from './protocol/types.js';

// ---------------------------------------------------------------------------
// Codec
// ---------------------------------------------------------------------------

export type { CodecAdapter, PostMessageData, ProtocolMessage } from './codec/adapter.js';
export { createScaleCodecAdapter, scaleCodecAdapter, Message, MessagePayload, hostApiProtocol } from './codec/scale/protocol.js';
export type {
  RequestMethod, SubscriptionMethod, ActionString,
  RequestVersions, ResponseVersions, StartVersions, ReceiveVersions,
  RequestParams, ResponseOk, ResponseErr,
  SubscriptionParams, SubscriptionPayload,
} from './codec/scale/protocol.js';
export { structuredCloneCodecAdapter } from './codec/structured/index.js';
export { UPGRADE_TIMEOUT, requestCodecUpgrade, handleCodecUpgrade } from './codec/negotiation.js';
export type {
  CodecFormat,
  CodecAdapterMap,
  CodecUpgradeRequest,
  CodecUpgradeResponse,
} from './codec/negotiation.js';

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

export {
  createTransport,
  HANDSHAKE_INTERVAL,
  HANDSHAKE_TIMEOUT,
} from './transport/transport.js';

export type {
  ConnectionStatus,
  CreateTransportOptions,
  RequestHandler,
  Subscription,
  SubscriptionHandler,
  Transport,
} from './transport/transport.js';

export type { Provider } from './transport/provider.js';

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

export { createDefaultLogger } from './util/logger.js';
export type { Logger } from './util/logger.js';

export { createIdFactory } from './util/idFactory.js';
export {
  delay,
  promiseWithResolvers,
  composeAction,
  extractErrorMessage,
} from './util/helpers.js';

// ---------------------------------------------------------------------------
// Common types
// ---------------------------------------------------------------------------

export type { HexString } from './codec/scale/primitives.js';
export { toHexString } from './codec/scale/primitives.js';

export { ok, err, Result, ResultAsync } from 'neverthrow';
export type { Ok, Err } from 'neverthrow';
