/**
 * Papp adapter stub.
 *
 * This module will be filled when porting the host-papp package.
 * For now, it defines the interface that the auth manager expects.
 */

import type { UserSession, Identity } from './authManager.js';

// ---------------------------------------------------------------------------
// Papp adapter interface
// ---------------------------------------------------------------------------

export type PappAdapterConfig = {
  appId: string;
  metadata: string;
  /** Statement store endpoints for identity resolution. */
  statementStoreEndpoints?: string[];
};

export type PairingStatus =
  | { step: 'none' }
  | { step: 'initial' }
  | { step: 'pairing'; payload: string }
  | { step: 'pairingError'; message: string }
  | { step: 'attestation' }
  | { step: 'finished' };

export type AttestationStatus =
  | { step: 'none' }
  | { step: 'attestation'; username?: string }
  | { step: 'attestationError'; message: string }
  | { step: 'finished' };

export type PappAdapter = {
  authenticate(): Promise<UserSession | undefined>;
  abortAuthentication(): void;
  disconnect(session: UserSession): Promise<void>;
  getStoredSessions(): UserSession[];
  resolveIdentity(publicKey: Uint8Array): Promise<Identity | undefined>;
  subscribePairingStatus(callback: (status: PairingStatus) => void): () => void;
  subscribeAttestationStatus(callback: (status: AttestationStatus) => void): () => void;
  dispose(): void;
};

// ---------------------------------------------------------------------------
// Stub factory
// ---------------------------------------------------------------------------

/**
 * Creates a stub papp adapter.
 *
 * TODO: Replace with real implementation when porting host-papp.
 */
export function createPappAdapterStub(_config: PappAdapterConfig): PappAdapter {
  return {
    async authenticate() {
      // TODO: Implement QR-code-based pairing flow
      return undefined;
    },

    abortAuthentication() {
      // TODO: Implement abort
    },

    async disconnect(_session) {
      // TODO: Implement session disconnect
    },

    getStoredSessions() {
      return [];
    },

    async resolveIdentity(_publicKey) {
      // TODO: Implement identity resolution via statement store
      return undefined;
    },

    subscribePairingStatus(callback) {
      callback({ step: 'none' });
      return () => {};
    },

    subscribeAttestationStatus(callback) {
      callback({ step: 'none' });
      return () => {};
    },

    dispose() {
      // no-op
    },
  };
}
