/**
 * Public types for @polkadot/host.
 */

import type { HexString, ResponseOk, RequestParams } from '@polkadot/api-protocol';
import type { JsonRpcProvider } from '@polkadot-api/json-rpc-provider';
import type {
  SigningPayloadRequest,
  SigningRawRequest,
  SigningResult,
  Feature,
  DevicePermissionRequest,
  RemotePermissionRequest,
  PushNotification,
} from '@polkadot/api-protocol';

import type { HostFacade } from '@polkadot/api-protocol';
import type { AuthManager, UserSession, Identity } from './auth/authManager.js';

// ---------------------------------------------------------------------------
// SDK Config
// ---------------------------------------------------------------------------

export type HostSdkConfig = {
  /** Application identifier (e.g., 'dot.li'). Used for storage scoping and auth. */
  appId: string;

  /** Storage key prefix. Defaults to `${appId}:`. */
  storagePrefix?: string;

  // -- Statement store / SSO -------------------------------------------------
  /**
   * WebSocket endpoints for the People/statement-store parachain.
   * When provided, the SDK creates a ChainClient and wires SSO pairing,
   * remote signing, identity resolution, and statement store handlers
   * automatically.
   */
  statementStoreEndpoints?: string[];

  /** Heartbeat timeout for the statement store WebSocket. Default: 120000 (2 min). */
  statementStoreHeartbeatTimeout?: number;

  /** URL to the host metadata JSON (shown to the mobile wallet during pairing). */
  pairingMetadata?: string;

  // -- Chain connection -----------------------------------------------------
  /** Factory that returns a JSON-RPC provider for a given genesis hash. */
  chainProvider?: (genesisHash: HexString) => JsonRpcProvider | undefined;

  // -- Signing callbacks (optional — defaults to remote signing via SSO) -----
  /** Handle signing a structured payload. If not set, uses remote signing via SSO. */
  onSignPayload?: (session: UserSession, payload: SigningPayloadRequest) => SigningResult | Promise<SigningResult>;

  /** Handle signing raw data. If not set, uses remote signing via SSO. */
  onSignRaw?: (session: UserSession, payload: SigningRawRequest) => SigningResult | Promise<SigningResult>;

  /** Handle creating a transaction. Must return the signed transaction hex. */
  onCreateTransaction?: (
    session: UserSession,
    params: RequestParams<'host_create_transaction', 'v1'>,
  ) => ResponseOk<'host_create_transaction', 'v1'> | Promise<ResponseOk<'host_create_transaction', 'v1'>>;

  /** Handle creating a transaction with a non-product account. Must return the signed transaction hex. */
  onCreateTransactionWithNonProductAccount?: (
    session: UserSession,
    payload: RequestParams<'host_create_transaction_with_non_product_account', 'v1'>,
  ) =>
    | ResponseOk<'host_create_transaction_with_non_product_account', 'v1'>
    | Promise<ResponseOk<'host_create_transaction_with_non_product_account', 'v1'>>;

  // -- Permission callbacks -------------------------------------------------
  /** Custom feature support check. */
  onFeatureSupported?: (feature: Feature) => boolean;

  /** Custom device permission handler. */
  onDevicePermission?: (permission: DevicePermissionRequest) => boolean | Promise<boolean>;

  /** Custom remote permission handler. */
  onPermission?: (request: RemotePermissionRequest) => boolean | Promise<boolean>;

  /** Custom navigation handler. */
  onNavigateTo?: (url: string) => void;

  /** Custom push notification handler. */
  onPushNotification?: (notification: PushNotification) => void;
};

// ---------------------------------------------------------------------------
// Embedded product
// ---------------------------------------------------------------------------

export type EmbeddedProduct = {
  /** The container managing this product's protocol bridge. */
  readonly container: HostFacade;
  /** Dispose the embedded product and its container. */
  dispose(): void;
};

// ---------------------------------------------------------------------------
// Host SDK
// ---------------------------------------------------------------------------

export type HostSdk = {
  /** The auth manager for authentication state. */
  readonly auth: AuthManager;

  /**
   * Embed a product in an iframe.
   *
   * @param iframe - The iframe element to load the product into.
   * @param url - The URL to load in the iframe.
   * @returns An EmbeddedProduct handle.
   */
  embed(iframe: HTMLIFrameElement, url: string): EmbeddedProduct;

  /**
   * Set the authenticated session.
   * This is a convenience for hosts that manage auth externally.
   */
  setSession(session: UserSession, identity?: Identity): void;

  /**
   * Clear the authenticated session.
   */
  clearSession(): void;

  /** Dispose the SDK and all embedded products. */
  dispose(): void;
};

// ---------------------------------------------------------------------------
// Re-exports for convenience
// ---------------------------------------------------------------------------

export type { AuthState, UserSession, Identity } from './auth/authManager.js';
export type { HostFacade } from '@polkadot/api-protocol';
export type { HandlersConfig, UserSessionInfo } from './handlers/registry.js';
export type { StorageAdapter, ReactiveStorageAdapter } from './storage/types.js';
