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
  ProtocolHandler,
  HandlersConfig,
  UserSessionInfo,
  StorageAdapter,
} from './types.js';

// ---------------------------------------------------------------------------
// ProtocolHandler
// ---------------------------------------------------------------------------

export { createProtocolHandler } from '@polkadot/host-api';
export type { CreateProtocolHandlerOptions } from '@polkadot/host-api';

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

export { createChainConnectionManager } from '@polkadot/host-api';
export type { ChainConnectionManager } from '@polkadot/host-api';

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
// Nested bridge
// ---------------------------------------------------------------------------

export { setupNestedBridgeDetector } from './nested/detector.js';
export type { NestedBridgeDetectorOptions } from './nested/detector.js';
