/**
 * SSO type stubs.
 *
 * These types will be fully defined when the SSO flow is ported
 * from host-papp. For now they provide the interface shape.
 */

export type SsoConfig = {
  /** The application identifier for SSO registration. */
  appId: string;
  /** URL to the host metadata JSON. */
  metadata: string;
  /** Optional: override the default SSO server URL. */
  serverUrl?: string;
};

export type SsoSession = {
  /** Paired remote public key. */
  remotePublicKey: Uint8Array;
  /** Shared secret derived during pairing. */
  sharedSecret: Uint8Array;
  /** Session expiry timestamp (epoch ms). */
  expiresAt: number;
};

export type SsoState =
  | { step: 'idle' }
  | { step: 'generating'; payload: string }
  | { step: 'waitingForPair'; payload: string }
  | { step: 'paired'; session: SsoSession }
  | { step: 'error'; message: string };
