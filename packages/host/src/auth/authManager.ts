/**
 * Auth state machine.
 *
 * Models the authentication lifecycle: idle -> pairing -> attesting -> authenticated.
 * Provides a pub-sub interface for state changes.
 *
 * Ported from dotli-clone/auth.ts, simplified to be adapter-agnostic.
 */

// ---------------------------------------------------------------------------
// Auth state
// ---------------------------------------------------------------------------

export type UserSession = {
  /** The user's root sr25519 public key (32 bytes). */
  rootPublicKey: Uint8Array;
  /** Optional display name resolved from identity. */
  displayName?: string;
  /** Raw remote account data (adapter-specific). */
  remoteAccount?: unknown;
};

export type Identity = {
  liteUsername: string;
  fullUsername: string | undefined;
  /** Additional identity fields are adapter-specific. */
  [key: string]: unknown;
};

export type AuthState =
  | { status: 'idle' }
  | { status: 'pairing'; payload: string }
  | { status: 'attesting'; username?: string }
  | { status: 'authenticated'; session: UserSession; identity: Identity | undefined }
  | { status: 'error'; message: string };

type AuthListener = (state: AuthState) => void;

// ---------------------------------------------------------------------------
// Auth manager
// ---------------------------------------------------------------------------

export type AuthManager = {
  getState(): AuthState;
  setState(state: AuthState): void;
  subscribe(listener: AuthListener): () => void;
  getSession(): UserSession | undefined;
  subscribeAuthStatus(callback: (status: string) => void): () => void;
  dispose(): void;
};

export function createAuthManager(): AuthManager {
  let currentState: AuthState = { status: 'idle' };
  const listeners = new Set<AuthListener>();

  function setState(state: AuthState): void {
    currentState = state;
    for (const fn of listeners) {
      fn(state);
    }
  }

  function getState(): AuthState {
    return currentState;
  }

  function subscribe(listener: AuthListener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function getSession(): UserSession | undefined {
    return currentState.status === 'authenticated' ? currentState.session : undefined;
  }

  function subscribeAuthStatus(callback: (status: string) => void): () => void {
    callback(currentState.status);
    return subscribe(state => callback(state.status));
  }

  function dispose(): void {
    listeners.clear();
  }

  return {
    getState,
    setState,
    subscribe,
    getSession,
    subscribeAuthStatus,
    dispose,
  };
}
