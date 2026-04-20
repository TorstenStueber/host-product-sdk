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
  AuthStatus,
  UserSession,
  Identity,
  HostFacade,
  HandlersConfig,
  StorageAdapter,
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

export { deriveProductPublicKey } from './auth/crypto.js';

export { sr25519DeriveSecret, sr25519DerivePublicKey } from './auth/hdkd.js';

export { createPappAdapterStub } from './auth/pappAdapter.js';
export type { PappAdapter, PappAdapterConfig, PairingStatus, AttestationStatus } from './auth/pappAdapter.js';

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

export type { IdentityProvider, ResolvedIdentity } from './auth/identity/chainProvider.js';
export type { IdentityResolver } from './auth/identity/resolver.js';
export { createIdentityResolver } from './auth/identity/resolver.js';
export { createChainIdentityProvider } from './auth/identity/chainProvider.js';

// ---------------------------------------------------------------------------
// Statement store
// ---------------------------------------------------------------------------

export type { StatementStoreAdapter, Statement, SignedStatement, StatementProof } from './statementStore/types.js';
export type { StatementStoreClient, PeopleChainClient } from './statementStore/client.js';
export { createStatementStoreClient } from './statementStore/client.js';
export { PEOPLE_PARACHAIN_ENDPOINTS } from './constants.js';

// ---------------------------------------------------------------------------
// SSO
// ---------------------------------------------------------------------------

export type {
  SsoSigner,
  SsoSessionStore,
  PersistedSessionMeta,
  SsoState,
  SsoManager,
  SsoManagerConfig,
  PairingExecutor,
  PairingResult,
  SecretStore,
  PersistedSecrets,
  RemoteSigner,
  RemoteSigningConfig,
  SignRequestExecutor,
  RemoteSignPayloadRequest,
  RemoteSignRawRequest,
  RemoteSignResult,
  PairingExecutorConfig,
  SignRequestExecutorConfig,
} from './auth/sso/types.js';

export { createSsoManager } from './auth/sso/manager.js';
export { createSecretStore } from './auth/sso/secretStore.js';
export { createRemoteSigner } from './auth/sso/signing.js';
export { createSsoSessionStore } from './auth/sso/sessionStore.js';
export { createPairingExecutor } from './auth/sso/pairingExecutor.js';
export { createSignRequestExecutor } from './auth/sso/signRequestExecutor.js';

// ---------------------------------------------------------------------------
// Nested bridge
// ---------------------------------------------------------------------------

export { setupNestedBridgeDetector } from './nested/detector.js';
export type { NestedBridgeDetectorOptions } from './nested/detector.js';

// ---------------------------------------------------------------------------
// Testing utilities
// ---------------------------------------------------------------------------

export { createMemoryStatementStore } from './testing/memoryStatementStore.js';
