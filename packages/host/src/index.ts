/**
 * @polkadot/host -- Public API.
 *
 * Main entry point for the host package. Exports the SDK factory,
 * protocol handler, handlers, storage, chain, auth, and nested bridge.
 */

// ---------------------------------------------------------------------------
// SDK (main entry point)
// ---------------------------------------------------------------------------

export { createHostSdk } from './sdk.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type {
  HostSdkConfig,
  HostSdk,
  EmbeddedProduct,
  AuthState,
  UserSession,
  Identity,
  HostFacade,
  HandlersConfig,
  UserSessionInfo,
  StorageAdapter,
  ReactiveStorageAdapter,
} from './types.js';

// ---------------------------------------------------------------------------
// HostFacade
// ---------------------------------------------------------------------------

export { createHostFacade } from '@polkadot/api-protocol';
export type { CreateHostFacadeOptions } from '@polkadot/api-protocol';

// ---------------------------------------------------------------------------
// Webview port acquisition
// ---------------------------------------------------------------------------

export { acquireWebviewPort } from './webviewPort.js';
export type { AcquireWebviewPortOptions, WebviewTag } from './webviewPort.js';

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export { wireAllHandlers } from './handlers/registry.js';

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

export { createMemoryStorageAdapter } from './storage/memory.js';
export { createLocalStorageAdapter } from './storage/localStorage.js';

// ---------------------------------------------------------------------------
// Chain
// ---------------------------------------------------------------------------

export { createRateLimiter, RATE_LIMITED_MESSAGE } from './chain/rateLimiter.js';
export type {
  RateLimiter,
  RateLimiterConfig,
  RateLimiterStrategy,
  CreateRateLimiterConfig,
} from './chain/rateLimiter.js';

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export { createAuthManager } from './auth/authManager.js';
export type { AuthManager } from './auth/authManager.js';

export { deriveProductPublicKey, injectHDKD } from './auth/crypto.js';

export { createPappAdapterStub } from './auth/pappAdapter.js';
export type { PappAdapter, PappAdapterConfig, PairingStatus, AttestationStatus } from './auth/pappAdapter.js';

// ---------------------------------------------------------------------------
// SSO transport
// ---------------------------------------------------------------------------

export type {
  SsoTransport,
  SsoSubscription,
  SsoSigner,
  SsoSessionStore,
  PersistedSessionMeta,
  Statement,
  SignedStatement,
  SsoState,
  SsoManager,
  SsoManagerConfig,
  PairingExecutor,
  PairingResult,
} from './auth/sso/types.js';

export { createSsoManager } from './auth/sso/manager.js';
export { createSsoSessionStore } from './auth/sso/sessionStore.js';
export { createMemoryTransportBus } from './auth/sso/memoryTransport.js';

// ---------------------------------------------------------------------------
// Nested bridge
// ---------------------------------------------------------------------------

export { setupNestedBridgeDetector } from './nested/detector.js';
export type { NestedBridgeDetectorOptions } from './nested/detector.js';
