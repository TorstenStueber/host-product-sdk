/**
 * SSO public types.
 *
 * Re-exports from the transport and manager modules for convenience.
 */

export type { SsoSigner, SsoSessionStore, PersistedSessionMeta } from './transport.js';

export type { SsoState, SsoManager, SsoManagerConfig, PairingExecutor, PairingResult } from './manager.js';

export type {
  RemoteSigner,
  RemoteSigningConfig,
  SignRequestExecutor,
  RemoteSignPayloadRequest,
  RemoteSignRawRequest,
  RemoteSignResult,
} from './signing.js';

export type { PairingExecutorConfig } from './pairingExecutor.js';
export type { SignRequestExecutorConfig } from './signRequestExecutor.js';
