/**
 * SSO session store.
 *
 * Defines the session metadata and session store types, and provides a
 * concrete implementation backed by a StorageAdapter. Serializes
 * PersistedSessionMeta to JSON + UTF-8 bytes for storage.
 */

import type { StorageAdapter } from '../../storage/types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Minimal session metadata that survives across page reloads.
 *
 * The AES session key is NOT stored here — it is either re-derived
 * during re-pairing or held in a platform-specific secure store.
 */
export type PersistedSessionMeta = {
  /** Opaque session identifier shared with the mobile wallet. */
  sessionId: string;
  /** SS58 address of the paired mobile account. */
  address: string;
  /** Human-readable name shown during pairing (e.g. device name). */
  displayName: string;
  /** AES session key (32 bytes) — the P-256 ECDH shared secret derived during pairing. */
  sessionKey: Uint8Array;
  /** The mobile wallet's sr25519 account ID (32 bytes). */
  remoteAccountId: Uint8Array;
};

/**
 * Persistence adapter for SSO session metadata.
 *
 * Implementations store session metadata so the user does not need to
 * re-pair on every page load. Backed by the StorageAdapter.
 */
export type SsoSessionStore = {
  /** Save session metadata, overwriting any existing entry. */
  save(session: PersistedSessionMeta): Promise<void>;
  /** Load the previously saved session, or undefined if none. */
  load(): Promise<PersistedSessionMeta | undefined>;
  /** Remove any saved session. */
  clear(): Promise<void>;
  /** Subscribe to session changes. */
  subscribe(callback: (session: PersistedSessionMeta | undefined) => void): () => void;
};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

const SESSION_KEY = 'sso_session';

type SerializedMeta = {
  sessionId: string;
  address: string;
  displayName: string;
  sessionKey: number[];
  remoteAccountId: number[];
};

function serialize(meta: PersistedSessionMeta): Uint8Array {
  const obj: SerializedMeta = {
    sessionId: meta.sessionId,
    address: meta.address,
    displayName: meta.displayName,
    sessionKey: Array.from(meta.sessionKey),
    remoteAccountId: Array.from(meta.remoteAccountId),
  };
  return new TextEncoder().encode(JSON.stringify(obj));
}

function deserialize(data: Uint8Array): PersistedSessionMeta | undefined {
  try {
    const obj = JSON.parse(new TextDecoder().decode(data)) as SerializedMeta;
    return {
      sessionId: obj.sessionId,
      address: obj.address,
      displayName: obj.displayName,
      sessionKey: new Uint8Array(obj.sessionKey),
      remoteAccountId: new Uint8Array(obj.remoteAccountId),
    };
  } catch {
    return undefined;
  }
}

export function createSsoSessionStore(storage: StorageAdapter): SsoSessionStore {
  return {
    async save(session: PersistedSessionMeta): Promise<void> {
      await storage.write(SESSION_KEY, serialize(session));
    },

    async load(): Promise<PersistedSessionMeta | undefined> {
      const data = await storage.read(SESSION_KEY);
      if (data === undefined) return undefined;
      return deserialize(data);
    },

    async clear(): Promise<void> {
      await storage.clear(SESSION_KEY);
    },

    subscribe(callback: (session: PersistedSessionMeta | undefined) => void): () => void {
      return storage.subscribe(SESSION_KEY, value => {
        callback(value === undefined ? undefined : deserialize(value));
      });
    },
  };
}
