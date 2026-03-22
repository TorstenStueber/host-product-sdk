/**
 * SSO public types.
 *
 * Re-exports from the transport and manager modules for convenience.
 */

export type {
  SsoTransport,
  SsoSubscription,
  SsoSigner,
  SsoSessionStore,
  PersistedSessionMeta,
  Statement,
  SignedStatement,
} from './transport.js';

export type { SsoState, SsoManager, SsoManagerConfig, PairingExecutor, PairingResult } from './manager.js';
