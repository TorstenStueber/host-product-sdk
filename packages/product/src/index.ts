/**
 * @polkadot/product -- Product SDK entry point.
 *
 * Public API for products (apps) embedded in a Polkadot host.
 *
 * Usage:
 * ```ts
 * import { createHostApi, createPapiProvider, createAccountsProvider } from '@polkadot/product';
 * ```
 */

// -- Host API facade --------------------------------------------------------
export { hostApi, createHostApi } from '@polkadot/host-api';

// -- Chain / JSON-RPC provider ----------------------------------------------
export { createPapiProvider } from './chain.js';

// -- Accounts ---------------------------------------------------------------
export { createAccountsProvider } from './accounts.js';

// -- Local storage ----------------------------------------------------------
export { createLocalStorage } from './storage.js';

// -- Chat -------------------------------------------------------------------
export { createProductChatManager, handleCustomMessageRendering, matchChatCustomRenderers } from './chat.js';

// -- Statement store --------------------------------------------------------
export { createStatementStore } from './statementStore.js';

// -- Preimage ---------------------------------------------------------------
export { createPreimageManager } from './preimage.js';

// -- Extension injection (legacy polkadot-js compat) ------------------------
export { injectSpektrExtension, createNonProductExtensionEnableFactory } from './extension.js';

// -- Transport --------------------------------------------------------------
export { sandboxProvider, sandboxTransport } from '@polkadot/host-api';

// -- Constants --------------------------------------------------------------
export { WellKnownChain, SpektrExtensionName } from './constants.js';

// -- Types ------------------------------------------------------------------
export type {
  // Accounts
  ProductAccount,
  AccountConnectionStatus,
  RingLocation,
  RingLocationHint,
  NonProductAccount,

  // Signing
  SigningResult,
  RawPayload,
  SigningRawRequest,
  SigningPayloadRequest,

  // Transaction
  TxPayloadV1,
  TxPayloadExtension,
  TxPayloadContext,
  VersionedTxPayload,

  // Chat
  ChatMessageContent,
  ChatRoom,
  ChatRoomRegistrationStatus,
  ChatBotRegistrationStatus,
  ChatCustomMessageRenderer,
  ChatCustomMessageRendererParams,
  ReceivedChatAction,
  ChatActionPayload,
  CustomRendererNode,

  // Statement store
  Statement,
  SignedStatement,
  StatementProof,
  Topic,
  ProductAccountId,

  // Feature
  Feature,

  // Shared re-exports
  HexString,
  ConnectionStatus,
  Subscription,
  Transport,
} from './types.js';
