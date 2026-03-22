/**
 * Protocol domain types derived from SCALE codec definitions via CodecType<>.
 *
 * This file re-exports data types (params, results, structs) for use by
 * host handlers and product consumers. Error types are NOT exported here —
 * they are provided as proper Error classes from `codec/scale/errors.ts`.
 */

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

export type {
  AccountIdType as AccountId,
  PublicKeyType as PublicKey,
  DotNsIdentifierType as DotNsIdentifier,
  DerivationIndexType as DerivationIndex,
  ProductAccountIdType as ProductAccountId,
  AccountType as Account,
  ContextualAliasType as ContextualAlias,
  RingLocationHintType as RingLocationHint,
  RingLocationType as RingLocation,
  AccountConnectionStatusType as AccountConnectionStatus,
} from '../shared/codec/scale/v1/accounts.js';

// RingVrfProof and RingVrfAlias are plain Uint8Array aliases with no
// dedicated codec constant -- keep them as manual type aliases.
export type RingVrfProof = Uint8Array;
export type RingVrfAlias = Uint8Array;

// ---------------------------------------------------------------------------
// Signing
// ---------------------------------------------------------------------------

export type {
  SigningResultType as SigningResult,
  RawPayloadType as RawPayload,
  SigningRawPayloadType as SigningRawRequest,
  SigningPayloadType as SigningPayloadRequest,
} from '../shared/codec/scale/v1/sign.js';

// ---------------------------------------------------------------------------
// Create transaction
// ---------------------------------------------------------------------------

export type {
  TxPayloadExtensionType as TxPayloadExtension,
  TxPayloadContextType as TxPayloadContext,
  TxPayloadV1Type as TxPayloadV1,
  VersionedTxPayloadType as VersionedTxPayload,
} from '../shared/codec/scale/v1/createTransaction.js';

// ---------------------------------------------------------------------------
// Local storage
// ---------------------------------------------------------------------------

export type {
  StorageKeyType as StorageKey,
  StorageValueType as StorageValue,
} from '../shared/codec/scale/v1/localStorage.js';

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

export type {
  ChatRoomRequestType as ChatRoomRequest,
  ChatRoomRegistrationStatusType as ChatRoomRegistrationStatus,
  ChatRoomRegistrationResultType as ChatRoomRegistrationResult,
  ChatBotRequestType as ChatBotRequest,
  ChatBotRegistrationStatusType as ChatBotRegistrationStatus,
  ChatBotRegistrationResultType as ChatBotRegistrationResult,
  ChatRoomParticipationType as ChatRoomParticipation,
  ChatRoomType as ChatRoom,
  ChatActionType as ChatAction,
  ChatActionLayoutType as ChatActionLayout,
  ChatActionsType as ChatActions,
  ChatMediaType as ChatMedia,
  ChatRichTextType as ChatRichText,
  ChatFileType as ChatFile,
  ChatReactionType as ChatReaction,
  ChatCustomMessageType as ChatCustomMessage,
  ChatMessageContentType as ChatMessageContent,
  ChatPostMessageResultType as ChatPostMessageResult,
  ActionTriggerType as ActionTrigger,
  ChatCommandType as ChatCommand,
  ChatActionPayloadType as ChatActionPayload,
  ReceivedChatActionType as ReceivedChatAction,
} from '../shared/codec/scale/v1/chat.js';

// ---------------------------------------------------------------------------
// Chain interaction
// ---------------------------------------------------------------------------

export type {
  BlockHashType as BlockHash,
  OperationIdType as OperationId,
  RuntimeApiType as RuntimeApi,
  RuntimeSpecType as RuntimeSpec,
  RuntimeTypeType as RuntimeType,
  StorageQueryTypeType as StorageQueryType,
  StorageQueryItemType as StorageQueryItem,
  StorageResultItemType as StorageResultItem,
  OperationStartedResultType as OperationStartedResult,
  ChainHeadEventType as ChainHeadEvent,
} from '../shared/codec/scale/v1/chainInteraction.js';

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

export type { DevicePermissionRequestType as DevicePermissionRequest } from '../shared/codec/scale/v1/devicePermission.js';
export type { RemotePermissionRequestType as RemotePermissionRequest } from '../shared/codec/scale/v1/remotePermission.js';

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

// NavigateToRequestType was derived from a V1 request codec and has been removed.

// ---------------------------------------------------------------------------
// Notification
// ---------------------------------------------------------------------------

export type { PushNotificationType as PushNotification } from '../shared/codec/scale/v1/notification.js';

// ---------------------------------------------------------------------------
// Statement store
// ---------------------------------------------------------------------------

export type {
  TopicType as Topic,
  ChannelType as Channel,
  DecryptionKeyType as DecryptionKey,
  Sr25519StatementProofType as Sr25519StatementProof,
  Ed25519StatementProofType as Ed25519StatementProof,
  EcdsaStatementProofType as EcdsaStatementProof,
  OnChainStatementProofType as OnChainStatementProof,
  StatementProofType as StatementProof,
  StatementType as Statement,
  SignedStatementType as SignedStatement,
} from '../shared/codec/scale/v1/statementStore.js';

// ---------------------------------------------------------------------------
// Preimage
// ---------------------------------------------------------------------------

export type {
  PreimageKeyType as PreimageKey,
  PreimageValueType as PreimageValue,
} from '../shared/codec/scale/v1/preimage.js';

// ---------------------------------------------------------------------------
// Custom renderer
// ---------------------------------------------------------------------------

export type { CustomRendererNodeType as CustomRendererNode } from '../shared/codec/scale/v1/customRenderer.js';

// ---------------------------------------------------------------------------
// Feature
// ---------------------------------------------------------------------------

export type { FeatureType as Feature } from '../shared/codec/scale/v1/feature.js';
