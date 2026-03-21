/**
 * AuthManager tests.
 *
 * Tests for the auth state machine: state transitions, subscriptions,
 * and cleanup.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createAuthManager } from '@polkadot/host';
import type { AuthManager } from '@polkadot/host';

describe('createAuthManager', () => {
  let auth: AuthManager;

  beforeEach(() => {
    auth = createAuthManager();
  });

  // -----------------------------------------------------------------------
  // Initial state
  // -----------------------------------------------------------------------

  it('initial state is idle', () => {
    const state = auth.getState();
    expect(state.status).toBe('idle');
  });

  it('getSession returns undefined when idle', () => {
    expect(auth.getSession()).toBeUndefined();
  });

  // -----------------------------------------------------------------------
  // State transitions
  // -----------------------------------------------------------------------

  it('transitions from idle to pairing', () => {
    auth.setState({ status: 'pairing', payload: 'qr-code-data' });

    const state = auth.getState();
    expect(state.status).toBe('pairing');
    if (state.status === 'pairing') {
      expect(state.payload).toBe('qr-code-data');
    }
  });

  it('transitions from pairing to attesting', () => {
    auth.setState({ status: 'pairing', payload: 'data' });
    auth.setState({ status: 'attesting', username: 'alice' });

    const state = auth.getState();
    expect(state.status).toBe('attesting');
    if (state.status === 'attesting') {
      expect(state.username).toBe('alice');
    }
  });

  it('transitions from attesting to authenticated', () => {
    auth.setState({ status: 'attesting' });
    auth.setState({
      status: 'authenticated',
      session: {
        rootPublicKey: new Uint8Array(32),
        displayName: 'Alice',
      },
      identity: {
        liteUsername: 'alice',
        fullUsername: 'alice@polkadot',
      },
    });

    const state = auth.getState();
    expect(state.status).toBe('authenticated');

    if (state.status === 'authenticated') {
      expect(state.session.displayName).toBe('Alice');
      expect(state.session.rootPublicKey).toBeInstanceOf(Uint8Array);
      expect(state.identity?.liteUsername).toBe('alice');
    }
  });

  it('getSession returns session when authenticated', () => {
    const session = {
      rootPublicKey: new Uint8Array([1, 2, 3]),
      displayName: 'Bob',
    };

    auth.setState({
      status: 'authenticated',
      session,
      identity: undefined,
    });

    const retrieved = auth.getSession();
    expect(retrieved).not.toBeUndefined();
    expect(retrieved!.displayName).toBe('Bob');
    expect(retrieved!.rootPublicKey).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('transitions to error state', () => {
    auth.setState({ status: 'error', message: 'Connection failed' });

    const state = auth.getState();
    expect(state.status).toBe('error');
    if (state.status === 'error') {
      expect(state.message).toBe('Connection failed');
    }
  });

  it('disconnect returns to idle', () => {
    auth.setState({
      status: 'authenticated',
      session: { rootPublicKey: new Uint8Array(32) },
      identity: undefined,
    });

    auth.setState({ status: 'idle' });

    expect(auth.getState().status).toBe('idle');
    expect(auth.getSession()).toBeUndefined();
  });

  // -----------------------------------------------------------------------
  // subscribe
  // -----------------------------------------------------------------------

  it('subscribe receives all state changes', () => {
    const states: string[] = [];
    auth.subscribe(state => states.push(state.status));

    auth.setState({ status: 'pairing', payload: 'data' });
    auth.setState({ status: 'attesting' });
    auth.setState({
      status: 'authenticated',
      session: { rootPublicKey: new Uint8Array(32) },
      identity: undefined,
    });

    expect(states).toEqual(['pairing', 'attesting', 'authenticated']);
  });

  it('unsubscribe stops notifications', () => {
    const states: string[] = [];
    const unsub = auth.subscribe(state => states.push(state.status));

    auth.setState({ status: 'pairing', payload: 'x' });
    expect(states).toHaveLength(1);

    unsub();

    auth.setState({ status: 'attesting' });
    expect(states).toHaveLength(1); // Should not increase
  });

  it('multiple subscribers all receive updates', () => {
    const listener1 = vi.fn();
    const listener2 = vi.fn();
    const listener3 = vi.fn();

    auth.subscribe(listener1);
    auth.subscribe(listener2);
    auth.subscribe(listener3);

    auth.setState({ status: 'pairing', payload: 'test' });

    expect(listener1).toHaveBeenCalledTimes(1);
    expect(listener2).toHaveBeenCalledTimes(1);
    expect(listener3).toHaveBeenCalledTimes(1);

    // All should receive the same state
    const expectedState = { status: 'pairing', payload: 'test' };
    expect(listener1).toHaveBeenCalledWith(expectedState);
    expect(listener2).toHaveBeenCalledWith(expectedState);
    expect(listener3).toHaveBeenCalledWith(expectedState);
  });

  // -----------------------------------------------------------------------
  // subscribeAuthStatus
  // -----------------------------------------------------------------------

  it('subscribeAuthStatus fires immediately with current status', () => {
    const statuses: string[] = [];

    auth.subscribeAuthStatus(status => statuses.push(status));

    // Should have received the initial 'idle' status immediately
    expect(statuses).toEqual(['idle']);
  });

  it('subscribeAuthStatus receives status string on changes', () => {
    const statuses: string[] = [];

    auth.subscribeAuthStatus(status => statuses.push(status));

    auth.setState({ status: 'pairing', payload: 'data' });
    auth.setState({ status: 'attesting' });

    expect(statuses).toEqual(['idle', 'pairing', 'attesting']);
  });

  // -----------------------------------------------------------------------
  // dispose
  // -----------------------------------------------------------------------

  it('dispose clears all listeners', () => {
    const listener = vi.fn();
    auth.subscribe(listener);

    auth.dispose();

    auth.setState({ status: 'pairing', payload: 'data' });
    expect(listener).not.toHaveBeenCalled();
  });
});
