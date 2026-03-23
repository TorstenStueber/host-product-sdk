/**
 * SSO secret persistence.
 *
 * Stores the cryptographic secrets (sr25519 secret, P-256 secret, entropy)
 * needed to re-establish the encrypted channel after page reload. Backed
 * by a ReactiveStorageAdapter.
 *
 * Triangle-js-sdks encrypts secrets before storage. For simplicity we
 * store them as JSON — the ReactiveStorageAdapter (typically backed by
 * localStorage) provides the same security level as triangle-js-sdks'
 * approach since both end up in browser storage.
 */

import type { ReactiveStorageAdapter } from '../../storage/types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PersistedSecrets = {
  /** Sr25519 secret key (64 bytes). */
  ssSecret: Uint8Array;
  /** P-256 encryption secret key (32 bytes). */
  encrSecret: Uint8Array;
  /** BIP-39 entropy (16 bytes). */
  entropy: Uint8Array;
};

export type SecretStore = {
  save(sessionId: string, secrets: PersistedSecrets): Promise<void>;
  load(sessionId: string): Promise<PersistedSecrets | undefined>;
  clear(sessionId: string): Promise<void>;
};

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

type SerializedSecrets = {
  ssSecret: number[];
  encrSecret: number[];
  entropy: number[];
};

function serialize(secrets: PersistedSecrets): Uint8Array {
  const obj: SerializedSecrets = {
    ssSecret: Array.from(secrets.ssSecret),
    encrSecret: Array.from(secrets.encrSecret),
    entropy: Array.from(secrets.entropy),
  };
  return new TextEncoder().encode(JSON.stringify(obj));
}

function deserialize(data: Uint8Array): PersistedSecrets | undefined {
  try {
    const obj = JSON.parse(new TextDecoder().decode(data)) as SerializedSecrets;
    return {
      ssSecret: new Uint8Array(obj.ssSecret),
      encrSecret: new Uint8Array(obj.encrSecret),
      entropy: new Uint8Array(obj.entropy),
    };
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createSecretStore(storage: ReactiveStorageAdapter): SecretStore {
  const keyFor = (sessionId: string) => `sso_secrets_${sessionId}`;

  return {
    async save(sessionId: string, secrets: PersistedSecrets): Promise<void> {
      await storage.write(keyFor(sessionId), serialize(secrets));
    },

    async load(sessionId: string): Promise<PersistedSecrets | undefined> {
      const data = await storage.read(keyFor(sessionId));
      if (data === undefined) return undefined;
      return deserialize(data);
    },

    async clear(sessionId: string): Promise<void> {
      await storage.clear(keyFor(sessionId));
    },
  };
}
