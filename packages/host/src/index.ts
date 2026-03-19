/**
 * @polkadot/host -- Public API.
 *
 * Main entry point for the host package. Exports the SDK factory,
 * container, providers, handlers, storage, chain, auth, and nested bridge.
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
  Container,
  HandlersConfig,
  UserSessionInfo,
  StorageAdapter,
} from './types.js';

// ---------------------------------------------------------------------------
// Container
// ---------------------------------------------------------------------------

export { createContainer } from './container/container.js';
export type { CreateContainerOptions } from './container/container.js';
export { handlerHelpers } from './container/types.js';
export type {
  HandlerOk,
  HandlerErr,
  HandlerResult,
  HandlerContext,
} from './container/types.js';

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

export { createIframeProvider } from './container/iframeProvider.js';
export type { CreateIframeProviderParams } from './container/iframeProvider.js';

export { createWebviewProvider } from './container/webviewProvider.js';
export type { CreateWebviewProviderParams, WebviewTag } from './container/webviewProvider.js';

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

export { createChainConnectionManager } from './chain/connectionManager.js';
export type { ChainConnectionManager } from './chain/connectionManager.js';

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

export { deriveProductPublicKey } from './auth/crypto.js';

export { createPappAdapterStub } from './auth/pappAdapter.js';
export type {
  PappAdapter,
  PappAdapterConfig,
  PairingStatus,
  AttestationStatus,
} from './auth/pappAdapter.js';

// ---------------------------------------------------------------------------
// Nested bridge
// ---------------------------------------------------------------------------

export { setupNestedBridgeDetector } from './nested/detector.js';
export type { NestedBridgeDetectorOptions } from './nested/detector.js';

export { createWindowProvider } from './container/windowProvider.js';
