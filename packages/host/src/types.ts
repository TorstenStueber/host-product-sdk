/**
 * Public types for @polkadot/host.
 */

import type { HexString, ResponseOk, RequestParams } from '@polkadot/api-protocol';
import type { JsonRpcProvider } from 'polkadot-api';
import type { StorageAdapter, ReactiveStorageAdapter } from './storage/types.js';
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
  /** Application identifier (e.g., 'dot.li'). Used for auth. */
  appId: string;

  /**
   * Reactive storage adapter for SSO session and secret persistence.
   *
   * Must support `subscribe()` for reactive session change notifications.
   * Typically `createLocalStorageAdapter(appId + ':sso:')`.
   */
  ssoStorage: ReactiveStorageAdapter;

  /**
   * Factory that returns a storage adapter for a given product ID.
   *
   * Called once per `embed()` invocation. The returned adapter is passed
   * to `HandlersConfig.storage` for that product's localStorage operations.
   * Typically `(productId) => createLocalStorageAdapter(appId + ':' + productId + ':')`.
   */
  productStorage: (productId: string) => StorageAdapter;

  // -- Statement store / SSO -------------------------------------------------
  /**
   * JSON-RPC provider for the People/statement-store parachain.
   *
   * Can be any `JsonRpcProvider` — a WebSocket connection (via
   * `getWsProvider` from `@polkadot-api/ws-provider`) or a Smoldot
   * light client (via `getSmProvider` from `@polkadot-api/sm-provider`).
   *
   * The SDK creates a StatementStoreClient and wires SSO pairing, remote signing,
   * identity resolution, and statement store handlers automatically.
   */
  statementStoreProvider: JsonRpcProvider;

  /** URL to the host metadata JSON (shown to the mobile wallet during pairing). */
  pairingMetadata?: string;

  // -- Chain connection -----------------------------------------------------
  /** Factory that returns a JSON-RPC provider for a given genesis hash. */
  chainProvider?: (genesisHash: HexString) => JsonRpcProvider | undefined;

  // -- Signing callbacks (optional — defaults to remote signing via SSO) -----

  /**
   * Handle signing a structured payload. If not set, uses remote signing via SSO.
   * If you set this, you are fully responsible for producing the signature.
   */
  onSignPayload?: (session: UserSession, payload: SigningPayloadRequest) => SigningResult | Promise<SigningResult>;

  /** Handle signing raw data. If not set, uses remote signing via SSO. */
  onSignRaw?: (session: UserSession, payload: SigningRawRequest) => SigningResult | Promise<SigningResult>;

  /**
   * Approval gate for remote signing.
   *
   * Called before the SDK routes a sign request through the RemoteSigner.
   * If this returns `true` (or resolves to `true`), the SDK proceeds with
   * remote signing. If `false`, the request is rejected.
   *
   * Use this to show a confirmation modal to the user. The SDK handles
   * the actual signing — this callback just gates whether to proceed.
   *
   * Only used when `onSignPayload` / `onSignRaw` are NOT set (i.e., when
   * the SDK uses remote signing as the default).
   */
  onSignApproval?: (payload: SigningPayloadRequest | SigningRawRequest) => boolean | Promise<boolean>;

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
   * @param productId - Unique identifier for this product (used for storage scoping).
   * @returns An EmbeddedProduct handle.
   */
  embed(iframe: HTMLIFrameElement, url: string, productId: string): EmbeddedProduct;

  /**
   * Set the authenticated session.
   * This is a convenience for hosts that manage auth externally.
   */
  setSession(session: UserSession, identity?: Identity): void;

  /**
   * Clear the authenticated session.
   */
  clearSession(): void;

  /**
   * Start QR-code-based pairing.
   * Requires statementStoreProvider to be configured.
   * No-op if already paired or pairing in progress.
   */
  pair(): void;

  /**
   * Cancel an in-progress pairing.
   * No-op if not pairing.
   */
  cancelPairing(): void;

  /** Dispose the SDK and all embedded products. */
  dispose(): void;
};

// ---------------------------------------------------------------------------
// Re-exports for convenience
// ---------------------------------------------------------------------------

export type { AuthState, AuthStatus, UserSession, Identity } from './auth/authManager.js';
export type { HostFacade } from '@polkadot/api-protocol';
export type { HandlersConfig, UserSessionInfo } from './handlers/registry.js';
export type { StorageAdapter, ReactiveStorageAdapter } from './storage/types.js';
