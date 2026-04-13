/**
 * SSO session store backed by a ReactiveStorageAdapter.
 *
 * Serializes PersistedSessionMeta to JSON + UTF-8 bytes for storage.
 * Subscribes to the underlying storage key for change notifications.
 */

import type { ReactiveStorageAdapter } from '../../storage/types.js';
import type { PersistedSessionMeta, SsoSessionStore } from './transport.js';

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

export function createSsoSessionStore(storage: ReactiveStorageAdapter): SsoSessionStore {
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
