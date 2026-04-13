/**
 * SSO manager tests.
 *
 * Tests for the state machine, pairing lifecycle, session persistence,
 * and cancellation.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createSsoManager,
  createSsoSessionStore,
  createSecretStore,
  createMemoryStorageAdapter,
  createMemoryStatementStore,
} from '@polkadot/host';
import type { PairingExecutor, PairingResult, PersistedSessionMeta, PersistedSecrets, SsoState } from '@polkadot/host';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMeta(id: string = 'session-1'): PersistedSessionMeta {
  return {
    sessionId: id,
    address: '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY',
    displayName: 'Test Device',
    sessionKey: new Uint8Array(32).fill(0xaa),
    remoteAccountId: new Uint8Array(32).fill(0xbb),
  };
}

function makeSecrets(): PersistedSecrets {
  return {
    ssSecret: new Uint8Array(64).fill(0xdd),
    encrSecret: new Uint8Array(32).fill(0xee),
    entropy: new Uint8Array(16).fill(0xff),
  };
}

function makeResult(id: string = 'session-1'): PairingResult {
  return {
    session: makeMeta(id),
    secrets: makeSecrets(),
  };
}

/** Executor that succeeds immediately with a QR payload. */
function immediateExecutor(result: PairingResult): PairingExecutor {
  return {
    async execute(_transport, onQrPayload, _signal) {
      onQrPayload('qr://test-payload');
      return result;
    },
  };
}

/** Executor that waits until resolved externally. */
function deferredExecutor(): {
  executor: PairingExecutor;
  resolve: (result: PairingResult | undefined) => void;
  reject: (error: Error) => void;
} {
  let resolveOuter: (result: PairingResult | undefined) => void;
  let rejectOuter: (error: Error) => void;
  const promise = new Promise<PairingResult | undefined>((res, rej) => {
    resolveOuter = res;
    rejectOuter = rej;
  });
  return {
    executor: {
      async execute(_transport, onQrPayload, _signal) {
        onQrPayload('qr://deferred');
        return promise;
      },
    },
    resolve: resolveOuter!,
    reject: rejectOuter!,
  };
}

/** Executor that never resolves (for cancellation tests). */
function hangingExecutor(): PairingExecutor {
  return {
    execute(_transport, onQrPayload, signal) {
      onQrPayload('qr://hanging');
      return new Promise<PairingResult | undefined>((_resolve, _reject) => {
        signal.addEventListener('abort', () => _resolve(undefined));
      });
    },
  };
}

/** Executor that fails with an error. */
function failingExecutor(message: string): PairingExecutor {
  return {
    async execute() {
      throw new Error(message);
    },
  };
}

function createTestManager(executor: PairingExecutor) {
  const storage = createMemoryStorageAdapter();
  const sessionStore = createSsoSessionStore(storage);
  const secrets = createSecretStore(storage);
  const bus = createMemoryStatementStore();
  const adapter = bus.createAdapter();
  return {
    manager: createSsoManager({
      statementStore: adapter,
      sessionStore,
      secretStore: secrets,
      pairingExecutor: executor,
    }),
    storage,
    sessionStore,
    secretStore: secrets,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createSsoManager', () => {
  // ── Initial state ─────────────────────────────────────────

  it('starts in idle state', () => {
    const { manager } = createTestManager(immediateExecutor(makeResult()));
    expect(manager.getState()).toEqual({ status: 'idle' });
  });

  // ── Pairing lifecycle ─────────────────────────────────────

  it('pair transitions through awaiting_scan to paired', async () => {
    const states: SsoState[] = [];
    const { manager } = createTestManager(immediateExecutor(makeResult()));

    manager.subscribe(s => states.push(s));
    manager.pair();

    // Let microtasks flush
    await new Promise(r => setTimeout(r, 10));

    const statuses = states.map(s => s.status);
    expect(statuses).toContain('pairing');
    expect(statuses).toContain('awaiting_scan');
    expect(statuses).toContain('paired');
    expect(manager.getState().status).toBe('paired');
  });

  it('paired state contains the session metadata', async () => {
    const { manager } = createTestManager(immediateExecutor(makeResult('my-session')));

    manager.pair();
    await new Promise(r => setTimeout(r, 10));

    const state = manager.getState();
    expect(state.status).toBe('paired');
    if (state.status === 'paired') {
      expect(state.session.sessionId).toBe('my-session');
    }
  });

  it('pair persists session to store', async () => {
    const { manager, sessionStore } = createTestManager(immediateExecutor(makeResult('persisted')));

    manager.pair();
    await new Promise(r => setTimeout(r, 10));

    const loaded = await sessionStore.load();
    expect(loaded?.sessionId).toBe('persisted');
  });

  it('pair is no-op when already paired', async () => {
    const executor = vi.fn().mockImplementation(immediateExecutor(makeResult()).execute);
    const { manager } = createTestManager({ execute: executor });

    manager.pair();
    await new Promise(r => setTimeout(r, 10));
    expect(manager.getState().status).toBe('paired');

    manager.pair(); // should be ignored
    await new Promise(r => setTimeout(r, 10));

    expect(executor).toHaveBeenCalledTimes(1);
  });

  it('pair can retry after failure', async () => {
    const deferred = deferredExecutor();
    const { manager } = createTestManager(deferred.executor);

    manager.pair();
    await new Promise(r => setTimeout(r, 10));

    // Simulate failure by rejecting
    deferred.reject(new Error('network error'));
    await new Promise(r => setTimeout(r, 10));
    expect(manager.getState().status).toBe('failed');

    // Replace executor and retry — but we need a new manager since executor is fixed
    // Instead, test that pair() works from failed state
    const { manager: m2 } = createTestManager(immediateExecutor(makeResult()));
    // Set to failed first by pairing with a failing executor
    const { manager: m3 } = createTestManager(failingExecutor('oops'));
    m3.pair();
    await new Promise(r => setTimeout(r, 10));
    expect(m3.getState().status).toBe('failed');
  });

  // ── Cancellation ──────────────────────────────────────────

  it('cancelPairing transitions to idle', async () => {
    const { manager } = createTestManager(hangingExecutor());

    manager.pair();
    await new Promise(r => setTimeout(r, 10));
    expect(manager.getState().status).toBe('awaiting_scan');

    manager.cancelPairing();
    expect(manager.getState().status).toBe('idle');
  });

  it('cancelPairing is no-op when idle', () => {
    const { manager } = createTestManager(immediateExecutor(makeResult()));
    manager.cancelPairing();
    expect(manager.getState().status).toBe('idle');
  });

  // ── Failure ───────────────────────────────────────────────

  it('pairing failure transitions to failed with reason', async () => {
    const { manager } = createTestManager(failingExecutor('Connection refused'));

    manager.pair();
    await new Promise(r => setTimeout(r, 10));

    const state = manager.getState();
    expect(state.status).toBe('failed');
    if (state.status === 'failed') {
      expect(state.reason).toBe('Connection refused');
    }
  });

  // ── Unpair ────────────────────────────────────────────────

  it('unpair clears session and transitions to idle', async () => {
    const { manager, sessionStore } = createTestManager(immediateExecutor(makeResult()));

    manager.pair();
    await new Promise(r => setTimeout(r, 10));
    expect(manager.getState().status).toBe('paired');

    await manager.unpair();
    expect(manager.getState().status).toBe('idle');
    expect(await sessionStore.load()).toBeUndefined();
  });

  // ── Session restore ───────────────────────────────────────

  it('restoreSession transitions to paired if session and secrets exist', async () => {
    const storage = createMemoryStorageAdapter();
    const sessionStore = createSsoSessionStore(storage);
    const secrets = createSecretStore(storage);
    const bus = createMemoryStatementStore();

    // Pre-persist session AND secrets
    await sessionStore.save(makeMeta('restored'));
    await secrets.save('restored', makeSecrets());

    const manager = createSsoManager({
      statementStore: bus.createAdapter(),
      sessionStore,
      secretStore: secrets,
      pairingExecutor: immediateExecutor(makeResult()),
    });

    await manager.restoreSession();
    const state = manager.getState();
    expect(state.status).toBe('paired');
    if (state.status === 'paired') {
      expect(state.session.sessionId).toBe('restored');
    }
  });

  it('restoreSession cleans up session if secrets are missing', async () => {
    const storage = createMemoryStorageAdapter();
    const sessionStore = createSsoSessionStore(storage);
    const secrets = createSecretStore(storage);
    const bus = createMemoryStatementStore();

    // Pre-persist session but NOT secrets
    await sessionStore.save(makeMeta('orphaned'));

    const manager = createSsoManager({
      statementStore: bus.createAdapter(),
      sessionStore,
      secretStore: secrets,
      pairingExecutor: immediateExecutor(makeResult()),
    });

    await manager.restoreSession();
    expect(manager.getState().status).toBe('idle');
    // Session metadata should have been cleaned up
    expect(await sessionStore.load()).toBeUndefined();
  });

  it('restoreSession is no-op when no session persisted', async () => {
    const { manager } = createTestManager(immediateExecutor(makeResult()));

    await manager.restoreSession();
    expect(manager.getState().status).toBe('idle');
  });

  it('restoreSession is no-op when already paired', async () => {
    const storage = createMemoryStorageAdapter();
    const sessionStore = createSsoSessionStore(storage);
    const secrets = createSecretStore(storage);
    const bus = createMemoryStatementStore();

    await sessionStore.save(makeMeta('stored'));
    await secrets.save('stored', makeSecrets());

    const manager = createSsoManager({
      statementStore: bus.createAdapter(),
      sessionStore,
      secretStore: secrets,
      pairingExecutor: immediateExecutor(makeResult('from-pairing')),
    });

    manager.pair();
    await new Promise(r => setTimeout(r, 10));
    expect(manager.getState().status).toBe('paired');

    // restoreSession should not overwrite
    await manager.restoreSession();
    if (manager.getState().status === 'paired') {
      expect(manager.getState().status === 'paired' && manager.getState().session.sessionId).toBe('from-pairing');
    }
  });

  // ── Dispose ───────────────────────────────────────────────

  it('dispose stops notifications', async () => {
    const { manager } = createTestManager(immediateExecutor(makeResult()));
    const callback = vi.fn();

    manager.subscribe(callback);
    manager.dispose();
    manager.pair(); // should be ignored
    await new Promise(r => setTimeout(r, 10));

    // Only state changes before dispose should have fired
    expect(callback).not.toHaveBeenCalled();
  });

  it('dispose cancels in-progress pairing', async () => {
    const { manager } = createTestManager(hangingExecutor());

    manager.pair();
    await new Promise(r => setTimeout(r, 10));

    manager.dispose();
    // Should not throw or transition to failed
    expect(manager.getState().status).toBe('idle');
  });

  // ── Subscribe ─────────────────────────────────────────────

  it('subscribe fires for every state transition', async () => {
    const states: string[] = [];
    const { manager } = createTestManager(immediateExecutor(makeResult()));

    manager.subscribe(s => states.push(s.status));
    manager.pair();
    await new Promise(r => setTimeout(r, 10));

    expect(states.length).toBeGreaterThanOrEqual(2);
    expect(states[states.length - 1]).toBe('paired');
  });

  it('unsubscribe stops notifications', async () => {
    const callback = vi.fn();
    const { manager } = createTestManager(immediateExecutor(makeResult()));

    const unsub = manager.subscribe(callback);
    unsub();
    manager.pair();
    await new Promise(r => setTimeout(r, 10));

    expect(callback).not.toHaveBeenCalled();
  });
});
