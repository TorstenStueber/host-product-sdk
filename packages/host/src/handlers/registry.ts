/**
 * Handler registry.
 *
 * `wireAllHandlers(container, config)` registers ALL default handlers
 * based on a config object. This is the main orchestrator that wires up
 * all handler modules.
 */

import type { HexString, RequestParams } from '@polkadot/api-protocol';
import type { StatementStoreAdapter } from '../statementStore/types.js';
import type { SsoSigner } from '../auth/sso/types.js';
import type { StorageAdapter } from '../storage/types.js';
import type { AuthStatus } from '../auth/authManager.js';
import type {
  Feature,
  DevicePermissionRequest,
  RemotePermissionRequest,
  PushNotification,
  SigningPayloadRequest,
  SigningRawRequest,
  SigningResult,
  ResponseOk,
} from '@polkadot/api-protocol';
import type { JsonRpcProvider } from 'polkadot-api';

import type { HostFacade } from '@polkadot/api-protocol';
import { wireHostHandlers } from './host.js';
import { wirePermissionHandlers } from './permissions.js';
import { wireStorageHandlers } from './storage.js';
import { wireAccountHandlers } from './accounts.js';
import { wireSigningHandlers } from './signing.js';
import { wireChainHandlers } from './chain.js';
import { wireChatHandlers } from './chat.js';
import { wireStatementStoreHandlers } from './statementStore.js';
import { wirePreimageHandlers } from './preimage.js';

// ---------------------------------------------------------------------------
// Session type used by handlers
// ---------------------------------------------------------------------------

export type UserSessionInfo = {
  rootPublicKey: Uint8Array;
  displayName?: string;
};

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export type HandlersConfig = {
  /** Storage adapter for product-facing localStorage operations. */
  storage: StorageAdapter;

  // -- Session access -------------------------------------------------------
  /** Returns the current user session, or undefined if not authenticated. */
  getSession?: () => UserSessionInfo | undefined;

  /** Subscribe to auth state changes. Callback receives the auth status. */
  subscribeAuthState: (callback: (status: AuthStatus) => void) => () => void;

  // -- Feature support ------------------------------------------------------
  /** Custom feature support check. */
  onFeatureSupported?: (feature: Feature) => boolean;

  // -- Navigation -----------------------------------------------------------
  /** Custom navigation handler. */
  onNavigateTo?: (url: string) => void;

  // -- Push notification ----------------------------------------------------
  /** Custom push notification handler. */
  onPushNotification?: (notification: PushNotification) => void;

  // -- Permissions ----------------------------------------------------------
  /** Custom device permission handler. */
  onDevicePermission?: (permission: DevicePermissionRequest) => boolean | Promise<boolean>;

  /** Custom remote permission handler. */
  onPermission?: (request: RemotePermissionRequest) => boolean | Promise<boolean>;

  // -- Signing callbacks ----------------------------------------------------
  /** Handle signing a structured payload. Must return the signing result. */
  onSignPayload?: (session: UserSessionInfo, payload: SigningPayloadRequest) => SigningResult | Promise<SigningResult>;

  /** Handle signing raw data. Must return the signing result. */
  onSignRaw?: (session: UserSessionInfo, payload: SigningRawRequest) => SigningResult | Promise<SigningResult>;

  /** Handle creating a transaction. Must return the signed transaction hex. */
  onCreateTransaction?: (
    session: UserSessionInfo,
    params: RequestParams<'host_create_transaction', 'v1'>,
  ) => ResponseOk<'host_create_transaction', 'v1'> | Promise<ResponseOk<'host_create_transaction', 'v1'>>;

  /** Handle creating a transaction with a non-product account. Must return the signed transaction hex. */
  onCreateTransactionWithNonProductAccount?: (
    session: UserSessionInfo,
    payload: RequestParams<'host_create_transaction_with_non_product_account', 'v1'>,
  ) =>
    | ResponseOk<'host_create_transaction_with_non_product_account', 'v1'>
    | Promise<ResponseOk<'host_create_transaction_with_non_product_account', 'v1'>>;

  // -- Chain connection -----------------------------------------------------
  /** Factory that returns a JSON-RPC provider for a given genesis hash, or undefined if unsupported. */
  chainProvider?: (genesisHash: HexString) => JsonRpcProvider | undefined;

  // -- Statement store -------------------------------------------------------
  /** Statement store adapter for product-facing statement operations. */
  statementStore?: StatementStoreAdapter;

  /** Sr25519 signer for statement proofs. */
  ssoSigner?: SsoSigner;
};

// ---------------------------------------------------------------------------
// Wire everything
// ---------------------------------------------------------------------------

export function wireAllHandlers(container: HostFacade, config: HandlersConfig): () => void {
  const allCleanups: (() => void)[] = [];

  allCleanups.push(...wireHostHandlers(container, config));
  allCleanups.push(...wirePermissionHandlers(container, config));
  allCleanups.push(...wireStorageHandlers(container, config));
  allCleanups.push(...wireAccountHandlers(container, config));
  allCleanups.push(...wireSigningHandlers(container, config));
  allCleanups.push(...wireChainHandlers(container, config));
  allCleanups.push(...wireChatHandlers(container));
  allCleanups.push(
    ...wireStatementStoreHandlers(container, {
      statementStore: config.statementStore,
      signer: config.ssoSigner,
    }),
  );
  allCleanups.push(...wirePreimageHandlers(container));

  return () => {
    for (const cleanup of allCleanups) {
      cleanup();
    }
  };
}
