/**
 * Public types for the @polkadot/product package.
 *
 * These are plain TypeScript types (no SCALE codec dependencies) that
 * mirror the protocol domain types from @polkadot/host-api. Consumers
 * of this package should use these types directly.
 */

import type { ConnectionStatus, HexString, Subscription, Transport } from '@polkadot/host-api';

// Re-export shared types that are part of our public API
export type { ConnectionStatus, HexString, Subscription, Transport };

// ---------------------------------------------------------------------------
// Versioned envelope
// ---------------------------------------------------------------------------

/**
 * A versioned tagged envelope used across all protocol methods.
 * The `tag` is typically `'v1'`, and `value` carries the actual payload.
 */
export type Versioned<T> = { tag: string; value: T };

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

export type ProductAccount = {
  dotNsIdentifier: string;
  derivationIndex: number;
  publicKey: Uint8Array;
};

export type AccountConnectionStatus = 'disconnected' | 'connected';

export type RingLocationHint = {
  palletInstance: number | undefined;
};

export type RingLocation = {
  genesisHash: HexString;
  ringRootHash: HexString;
  hints: RingLocationHint | undefined;
};

export type NonProductAccount = {
  publicKey: Uint8Array;
  name: string | undefined;
};

// ---------------------------------------------------------------------------
// Signing
// ---------------------------------------------------------------------------

export type SigningResult = {
  signature: HexString;
  signedTransaction: HexString | undefined;
};

export type RawPayload = { tag: 'Bytes'; value: Uint8Array } | { tag: 'Payload'; value: string };

export type SigningRawRequest = {
  address: string;
  data: RawPayload;
};

export type SigningPayloadRequest = {
  address: string;
  blockHash: HexString;
  blockNumber: HexString;
  era: HexString;
  genesisHash: HexString;
  method: HexString;
  nonce: HexString;
  specVersion: HexString;
  tip: HexString;
  transactionVersion: HexString;
  signedExtensions: string[];
  version: number;
  assetId: HexString | undefined;
  metadataHash: HexString | undefined;
  mode: number | undefined;
  withSignedTransaction: boolean | undefined;
};

// ---------------------------------------------------------------------------
// Transaction
// ---------------------------------------------------------------------------

export type TxPayloadExtension = {
  id: string;
  extra: HexString;
  additionalSigned: HexString;
};

export type TxPayloadContext = {
  metadata: HexString;
  tokenSymbol: string;
  tokenDecimals: number;
  bestBlockHeight: number;
};

export type TxPayloadV1 = {
  signer: string | null;
  callData: HexString;
  extensions: TxPayloadExtension[];
  txExtVersion: number;
  context: TxPayloadContext;
};

export type VersionedTxPayload = { tag: 'v1'; value: TxPayloadV1 };

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

export type ChatRoomRegistrationStatus = 'New' | 'Exists';
export type ChatBotRegistrationStatus = 'New' | 'Exists';

export type ChatRoom = {
  roomId: string;
  participatingAs: 'RoomHost' | 'Bot';
};

export type ChatAction = {
  actionId: string;
  title: string;
};

export type ChatActionLayout = 'Column' | 'Grid';

export type ChatActions = {
  text: string | undefined;
  actions: ChatAction[];
  layout: ChatActionLayout;
};

export type ChatMedia = { url: string };

export type ChatRichText = {
  text: string | undefined;
  media: ChatMedia[];
};

export type ChatFile = {
  url: string;
  fileName: string;
  mimeType: string;
  sizeBytes: bigint;
  text: string | undefined;
};

export type ChatReaction = {
  messageId: string;
  emoji: string;
};

export type ChatCustomMessage = {
  messageType: string;
  payload: Uint8Array;
};

export type ChatMessageContent =
  | { tag: 'Text'; value: string }
  | { tag: 'RichText'; value: ChatRichText }
  | { tag: 'Actions'; value: ChatActions }
  | { tag: 'File'; value: ChatFile }
  | { tag: 'Reaction'; value: ChatReaction }
  | { tag: 'ReactionRemoved'; value: ChatReaction }
  | { tag: 'Custom'; value: ChatCustomMessage };

export type ActionTrigger = {
  messageId: string;
  actionId: string;
  payload: Uint8Array | undefined;
};

export type ChatCommand = {
  command: string;
  payload: string;
};

export type ChatActionPayload =
  | { tag: 'MessagePosted'; value: ChatMessageContent }
  | { tag: 'ActionTriggered'; value: ActionTrigger }
  | { tag: 'Command'; value: ChatCommand };

export type ReceivedChatAction = {
  roomId: string;
  peer: string;
  payload: ChatActionPayload;
};

// ---------------------------------------------------------------------------
// Custom Renderer (subset re-exported for chat custom messages)
// ---------------------------------------------------------------------------

export type CustomRendererNode = {
  tag: string;
  value: unknown;
};

// ---------------------------------------------------------------------------
// Chat custom message renderer
// ---------------------------------------------------------------------------

export type ChatCustomMessageRendererParams<T = Uint8Array> = {
  messageId: string;
  messageType: string;
  payload: T;
  subscribeActions(callback: (actionId: string, payload: Uint8Array | undefined) => void): VoidFunction;
};

export type ChatCustomMessageRenderer = (
  params: ChatCustomMessageRendererParams,
  render: (node: CustomRendererNode) => void,
) => VoidFunction;

// ---------------------------------------------------------------------------
// Statement store
// ---------------------------------------------------------------------------

export type Topic = Uint8Array;
export type Channel = Uint8Array;
export type DecryptionKey = Uint8Array;
export type ProductAccountId = [string, number]; // [dotNsIdentifier, derivationIndex]

export type StatementProof =
  | { tag: 'Sr25519'; value: { signature: Uint8Array; signer: Uint8Array } }
  | { tag: 'Ed25519'; value: { signature: Uint8Array; signer: Uint8Array } }
  | { tag: 'Ecdsa'; value: { signature: Uint8Array; signer: Uint8Array } }
  | { tag: 'OnChain'; value: { who: Uint8Array; blockHash: Uint8Array; event: bigint } };

export type Statement = {
  proof: StatementProof | undefined;
  decryptionKey: DecryptionKey | undefined;
  expiry: bigint | undefined;
  channel: Channel | undefined;
  topics: Topic[];
  data: Uint8Array | undefined;
};

export type SignedStatement = {
  proof: StatementProof;
  decryptionKey: DecryptionKey | undefined;
  expiry: bigint | undefined;
  channel: Channel | undefined;
  topics: Topic[];
  data: Uint8Array | undefined;
};

// ---------------------------------------------------------------------------
// Feature
// ---------------------------------------------------------------------------

export type Feature = { tag: 'Chain'; value: HexString };

// ---------------------------------------------------------------------------
// HostApi type
// ---------------------------------------------------------------------------

export type { HostApi } from '@polkadot/host-api';
