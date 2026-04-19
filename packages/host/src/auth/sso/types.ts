/**
 * SSO public types.
 */

/**
 * Sr25519 signer for statement proofs.
 *
 * The SSO manager needs to sign statements before submitting them to the
 * statement store. The host app provides a signer derived at the appropriate
 * path (e.g. `//wallet//sso`).
 */
export type SsoSigner = {
  /** The sr25519 public key (32 bytes). */
  publicKey: Uint8Array;

  /**
   * Sign a message with the sr25519 private key.
   *
   * @param message - The payload to sign.
   * @returns The 64-byte sr25519 signature.
   */
  sign(message: Uint8Array): Promise<Uint8Array>;
};

export type { SsoSessionStore, PersistedSessionMeta } from './sessionStore.js';

export type { SsoState, SsoManager, SsoManagerConfig, PairingExecutor, PairingResult } from './manager.js';

export type { SecretStore, PersistedSecrets } from './secretStore.js';

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
