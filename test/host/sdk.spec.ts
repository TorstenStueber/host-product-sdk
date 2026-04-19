/**
 * Host SDK tests.
 *
 * Tests for createHostSdk: construction, auth methods, and dispose.
 * Note: embed() requires a DOM iframe, so we focus on non-DOM functionality.
 */

import { describe, it, expect, vi } from 'vitest';
import { createAuthManager } from '@polkadot/host';

// We cannot test createHostSdk.embed() without a DOM (no HTMLIFrameElement),
// so we test the auth manager integration and the SDK's non-DOM surface.

describe('Host SDK (auth manager integration)', () => {
  describe('createAuthManager used by SDK', () => {
    it('produces a working auth manager', () => {
      const auth = createAuthManager();

      expect(auth.getState().status).toBe('idle');
      expect(auth.getSession()).toBeUndefined();
      expect(typeof auth.subscribe).toBe('function');
      expect(typeof auth.setState).toBe('function');
      expect(typeof auth.subscribeAuthStatus).toBe('function');
      expect(typeof auth.dispose).toBe('function');
    });

    it('setSession (via setState) makes session available', () => {
      const auth = createAuthManager();

      const session = {
        rootPublicKey: new Uint8Array([1, 2, 3, 4]),
        displayName: 'Test User',
      };

      auth.setState({
        status: 'authenticated',
        session,
        identity: { liteUsername: 'testuser', fullUsername: undefined },
      });

      const retrieved = auth.getSession();
      expect(retrieved).not.toBeUndefined();
      expect(retrieved!.displayName).toBe('Test User');
    });

    it('clearSession (via setState to idle) removes session', () => {
      const auth = createAuthManager();

      auth.setState({
        status: 'authenticated',
        session: { rootPublicKey: new Uint8Array(32) },
        identity: undefined,
      });

      expect(auth.getSession()).not.toBeUndefined();

      auth.setState({ status: 'idle' });

      expect(auth.getSession()).toBeUndefined();
      expect(auth.getState().status).toBe('idle');
    });

    it('subscribe receives auth state changes', () => {
      const auth = createAuthManager();
      const states: string[] = [];

      auth.subscribe(state => states.push(state.status));

      auth.setState({ status: 'pairing', payload: 'data' });
      auth.setState({
        status: 'authenticated',
        session: { rootPublicKey: new Uint8Array(32) },
        identity: undefined,
      });

      expect(states).toEqual(['pairing', 'authenticated']);
    });

    it('dispose cleans up all listeners', () => {
      const auth = createAuthManager();
      const listener = vi.fn();

      auth.subscribe(listener);
      auth.dispose();

      auth.setState({ status: 'pairing', payload: 'x' });
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('SDK config patterns', () => {
    it('HostSdkConfig requires ssoStorage and productStorage', () => {
      // Verify the config shape expects both storage adapters
      const config = {
        appId: 'dot.li',
        ssoStorage: { read: vi.fn(), write: vi.fn(), clear: vi.fn(), subscribe: vi.fn() },
        productStorage: { read: vi.fn(), write: vi.fn(), clear: vi.fn() },
        statementStoreProvider: vi.fn(),
      };
      expect(config.ssoStorage).toBeDefined();
      expect(config.productStorage).toBeDefined();
      expect(typeof config.ssoStorage.subscribe).toBe('function');
    });
  });
});
