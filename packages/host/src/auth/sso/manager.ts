/**
 * SSO manager.
 *
 * Drives the QR-based pairing lifecycle between a host application and a
 * mobile wallet. Manages state transitions, session persistence, secret
 * persistence, and event dispatch. The actual cryptographic pairing
 * handshake is delegated to an injected PairingExecutor.
 */

import type { SsoSessionStore, PersistedSessionMeta } from './sessionStore.js';
import type { SecretStore, PersistedSecrets } from './secretStore.js';
import type { PairingExecutor } from './pairingExecutor.js';

// ---------------------------------------------------------------------------
// SSO state
// ---------------------------------------------------------------------------

export type SsoState =
  | { status: 'idle' }
  | { status: 'awaiting_scan'; qrPayload: string }
  | { status: 'pairing' }
  | { status: 'paired'; session: PersistedSessionMeta }
  | { status: 'failed'; reason: string };

// ---------------------------------------------------------------------------
// Manager config
// ---------------------------------------------------------------------------

export type SsoManagerConfig = {
  /** Session metadata persistence. */
  sessionStore: SsoSessionStore;
  /** Cryptographic secret persistence. */
  secretStore: SecretStore;
  /** Pairing protocol implementation. */
  pairingExecutor: PairingExecutor;
};

// ---------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------

export type SsoManager = {
  /** Current state snapshot. */
  getState(): SsoState;
  /** Subscribe to state changes. Returns an unsubscribe function. */
  subscribe(callback: (state: SsoState) => void): () => void;

  /**
   * Start pairing. Transitions idle -> awaiting_scan -> pairing -> paired.
   * No-op if already paired or pairing in progress.
   */
  pair(): void;

  /**
   * Cancel an in-progress pairing. Transitions to idle.
   * No-op if not pairing.
   */
  cancelPairing(): void;

  /**
   * Disconnect the current session. Clears persisted session and secrets.
   * Transitions paired -> idle.
   */
  unpair(): Promise<void>;

  /**
   * Try to restore a persisted session.
   * Loads session metadata and secrets, transitions to paired if both exist.
   */
  restoreSession(): Promise<void>;

  /**
   * Get the persisted secrets for the current session.
   * Returns undefined if not paired or secrets not available.
   */
  getSecrets(): Promise<PersistedSecrets | undefined>;

  /** Tear down the manager and release resources. */
  dispose(): void;
};

export function createSsoManager(config: SsoManagerConfig): SsoManager {
  const { sessionStore, secretStore, pairingExecutor } = config;

  let currentState: SsoState = { status: 'idle' };
  const listeners = new Set<(state: SsoState) => void>();
  let abortController: AbortController | undefined;
  let disposed = false;

  function setState(state: SsoState): void {
    if (disposed) return;
    currentState = state;
    for (const fn of listeners) {
      fn(state);
    }
  }

  function getState(): SsoState {
    return currentState;
  }

  function subscribe(callback: (state: SsoState) => void): () => void {
    listeners.add(callback);
    return () => listeners.delete(callback);
  }

  function pair(): void {
    if (disposed) return;
    if (currentState.status !== 'idle' && currentState.status !== 'failed') return;

    abortController = new AbortController();
    const signal = abortController.signal;

    setState({ status: 'pairing' });

    void pairingExecutor
      .execute(qrPayload => {
        if (!signal.aborted) {
          setState({ status: 'awaiting_scan', qrPayload });
        }
      }, signal)
      .then(
        async result => {
          if (signal.aborted || disposed) return;
          if (result === undefined) {
            setState({ status: 'idle' });
            return;
          }
          await sessionStore.save(result.session);
          await secretStore.save(result.session.sessionId, result.secrets);
          setState({ status: 'paired', session: result.session });
        },
        error => {
          if (signal.aborted || disposed) return;
          setState({
            status: 'failed',
            reason: error instanceof Error ? error.message : String(error),
          });
        },
      );
  }

  function cancelPairing(): void {
    if (abortController) {
      abortController.abort();
      abortController = undefined;
    }
    if (currentState.status === 'pairing' || currentState.status === 'awaiting_scan') {
      setState({ status: 'idle' });
    }
  }

  async function unpair(): Promise<void> {
    const sessionId = currentState.status === 'paired' ? currentState.session.sessionId : undefined;
    cancelPairing();
    if (sessionId) {
      await secretStore.clear(sessionId);
    }
    await sessionStore.clear();
    setState({ status: 'idle' });
  }

  async function restoreSession(): Promise<void> {
    if (disposed) return;
    if (currentState.status !== 'idle') return;
    const meta = await sessionStore.load();
    if (meta === undefined) return;
    // Verify secrets exist — without them signing won't work
    const secrets = await secretStore.load(meta.sessionId);
    if (secrets === undefined) {
      // Session metadata without secrets is useless — clean up
      await sessionStore.clear();
      return;
    }
    setState({ status: 'paired', session: meta });
  }

  async function getSecrets(): Promise<PersistedSecrets | undefined> {
    if (currentState.status !== 'paired') return undefined;
    return secretStore.load(currentState.session.sessionId);
  }

  function dispose(): void {
    cancelPairing();
    disposed = true;
    listeners.clear();
  }

  return {
    getState,
    subscribe,
    pair,
    cancelPairing,
    unpair,
    restoreSession,
    getSecrets,
    dispose,
  };
}
