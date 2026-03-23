/**
 * SSO manager.
 *
 * Drives the QR-based pairing lifecycle between a host application and a
 * mobile wallet. Manages state transitions, session persistence, and event
 * dispatch. The actual cryptographic pairing handshake is delegated to an
 * injected PairingExecutor.
 *
 * Modelled after the Rust host-sdk's SsoManager with trait-injection,
 * adapted for TypeScript's async/callback model.
 */

import type { StatementStoreAdapter } from '../../statementStore/types.js';
import type { SsoSessionStore, PersistedSessionMeta } from './transport.js';

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
// Pairing executor (injected crypto protocol)
// ---------------------------------------------------------------------------

/**
 * Result of a successful pairing handshake.
 */
export type PairingResult = {
  /** Session metadata to persist. */
  session: PersistedSessionMeta;
  /** AES session key for encrypting sign requests (not persisted). */
  sessionKey: Uint8Array;
};

/**
 * Pluggable pairing protocol.
 *
 * Implementations handle the cryptographic handshake (mnemonic generation,
 * P-256 ECDH, statement-store based key exchange, attestation). The SSO
 * manager drives the state machine and calls the executor at the right time.
 */
export type PairingExecutor = {
  /**
   * Start the pairing handshake.
   *
   * @param statementStore - The statement store adapter for messaging.
   * @param onQrPayload - Called when the QR payload is ready for display.
   * @param signal - Abort signal for cancellation.
   * @returns The pairing result, or undefined if the pairing was aborted.
   */
  execute(
    statementStore: StatementStoreAdapter,
    onQrPayload: (payload: string) => void,
    signal: AbortSignal,
  ): Promise<PairingResult | undefined>;
};

// ---------------------------------------------------------------------------
// Manager config
// ---------------------------------------------------------------------------

export type SsoManagerConfig = {
  /** Statement store adapter for messaging. */
  statementStore: StatementStoreAdapter;
  /** Session persistence. */
  sessionStore: SsoSessionStore;
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
   * Disconnect the current session. Clears persisted session.
   * Transitions paired -> idle.
   */
  unpair(): Promise<void>;

  /**
   * Try to restore a persisted session.
   * If a session exists in the store, transitions directly to paired.
   */
  restoreSession(): Promise<void>;

  /** Tear down the manager and release resources. */
  dispose(): void;
};

export function createSsoManager(config: SsoManagerConfig): SsoManager {
  const { statementStore, sessionStore, pairingExecutor } = config;

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
      .execute(
        statementStore,
        qrPayload => {
          if (!signal.aborted) {
            setState({ status: 'awaiting_scan', qrPayload });
          }
        },
        signal,
      )
      .then(
        async result => {
          if (signal.aborted || disposed) return;
          if (result === undefined) {
            setState({ status: 'idle' });
            return;
          }
          await sessionStore.save(result.session);
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
    cancelPairing();
    await sessionStore.clear();
    setState({ status: 'idle' });
  }

  async function restoreSession(): Promise<void> {
    if (disposed) return;
    if (currentState.status !== 'idle') return;
    const meta = await sessionStore.load();
    if (meta !== undefined) {
      setState({ status: 'paired', session: meta });
    }
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
    dispose,
  };
}
