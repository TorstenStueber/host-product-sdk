/**
 * Host SDK entry point.
 *
 * `createHostSdk(config)` composes all host components into a single
 * high-level API: auth manager, SSO pairing, remote signing, identity
 * resolution, statement store, and protocol handler wiring.
 */

import { createAuthManager } from './auth/authManager.js';
import type { UserSession, Identity } from './auth/authManager.js';
import { createHostFacade } from '@polkadot/api-protocol';
import { wireAllHandlers } from './handlers/registry.js';
import type { HandlersConfig } from './handlers/registry.js';
import type { HostSdkConfig, HostSdk, EmbeddedProduct } from './types.js';

import { createChainClient } from './statementStore/chainClient.js';
import type { ChainClient } from './statementStore/chainClient.js';
import { createSsoManager } from './auth/sso/manager.js';
import type { SsoManager } from './auth/sso/manager.js';
import { createSsoSessionStore } from './auth/sso/sessionStore.js';
import { createSecretStore } from './auth/sso/secretStore.js';
import { createPairingExecutor } from './auth/sso/pairingExecutor.js';
import { createLocalStorageAdapter } from './storage/localStorage.js';
import { createIdentityResolver } from './auth/identity/resolver.js';
import { createChainIdentityProvider } from './auth/identity/chainProvider.js';
import type { IdentityResolver } from './auth/identity/resolver.js';

export function createHostSdk(config: HostSdkConfig): HostSdk {
  const auth = createAuthManager();
  const embeddedProducts = new Set<EmbeddedProduct>();

  // --- Optional: chain client for statement store + identity ---
  let chainClient: ChainClient | undefined;
  let ssoManager: SsoManager | undefined;
  let identityResolver: IdentityResolver | undefined;

  if (config.statementStoreEndpoints && config.statementStoreEndpoints.length > 0) {
    chainClient = createChainClient(config.statementStoreEndpoints, {
      heartbeatTimeout: config.statementStoreHeartbeatTimeout ?? 120_000,
    });

    const storage = createLocalStorageAdapter(config.appId + ':sso:');
    const sessionStore = createSsoSessionStore(storage);
    const secretStore = createSecretStore(storage);

    ssoManager = createSsoManager({
      statementStore: chainClient.statementStore,
      sessionStore,
      secretStore,
      pairingExecutor: createPairingExecutor({
        metadata: config.pairingMetadata ?? '',
      }),
    });

    identityResolver = createIdentityResolver(createChainIdentityProvider(() => chainClient!.getUnsafeApi()));

    // Auto-restore session on creation
    void ssoManager.restoreSession().then(async () => {
      const state = ssoManager!.getState();
      if (state.status === 'paired') {
        const session: UserSession = {
          rootPublicKey: state.session.remoteAccountId,
          displayName: state.session.displayName,
          remoteAccount: state.session,
        };
        // Try to resolve identity
        let identity: Identity | undefined;
        try {
          const hexId = bytesToHex(state.session.remoteAccountId);
          const resolved = await identityResolver!.getIdentity(hexId);
          if (resolved) {
            identity = {
              liteUsername: resolved.liteUsername,
              fullUsername: resolved.fullUsername,
            };
          }
        } catch {
          // Identity resolution failure is non-fatal
        }
        auth.setState({ status: 'authenticated', session, identity });
      }
    });

    // Sync SSO state changes to auth manager
    ssoManager.subscribe(state => {
      if (state.status === 'paired') {
        const session: UserSession = {
          rootPublicKey: state.session.remoteAccountId,
          displayName: state.session.displayName,
          remoteAccount: state.session,
        };
        auth.setState({ status: 'authenticated', session, identity: undefined });
      } else if (state.status === 'idle' && auth.getState().status === 'authenticated') {
        auth.setState({ status: 'idle' });
      } else if (state.status === 'awaiting_scan') {
        auth.setState({ status: 'pairing', payload: state.qrPayload });
      } else if (state.status === 'failed') {
        auth.setState({ status: 'error', message: state.reason });
      }
    });
  }

  // Build handler config from SDK config + auth manager
  function buildHandlersConfig(storagePrefix: string): HandlersConfig {
    return {
      appId: config.appId,
      storagePrefix,

      getSession() {
        const session = auth.getSession();
        if (!session) return undefined;
        return {
          rootPublicKey: session.rootPublicKey,
          displayName: session.displayName,
        };
      },

      subscribeAuthState(callback) {
        return auth.subscribeAuthStatus(callback);
      },

      onFeatureSupported: config.onFeatureSupported,
      onNavigateTo: config.onNavigateTo,
      onPushNotification: config.onPushNotification,
      onDevicePermission: config.onDevicePermission,
      onPermission: config.onPermission,

      onSignPayload: config.onSignPayload
        ? (_sessionInfo, payload) => {
            const session = auth.getSession();
            if (!session) throw new Error('No session');
            return config.onSignPayload!(session, payload);
          }
        : undefined,

      onSignRaw: config.onSignRaw
        ? (_sessionInfo, payload) => {
            const session = auth.getSession();
            if (!session) throw new Error('No session');
            return config.onSignRaw!(session, payload);
          }
        : undefined,

      onCreateTransaction: config.onCreateTransaction
        ? (_sessionInfo, params) => {
            const session = auth.getSession();
            if (!session) throw new Error('No session');
            return config.onCreateTransaction!(session, params);
          }
        : undefined,

      onCreateTransactionWithNonProductAccount: config.onCreateTransactionWithNonProductAccount
        ? (_sessionInfo, payload) => {
            const session = auth.getSession();
            if (!session) throw new Error('No session');
            return config.onCreateTransactionWithNonProductAccount!(session, payload);
          }
        : undefined,

      chainProvider: config.chainProvider,
      statementStore: chainClient?.statementStore,
    };
  }

  const sdk: HostSdk = {
    auth,

    embed(iframe: HTMLIFrameElement, url: string): EmbeddedProduct {
      iframe.src = url;
      const storagePrefix = config.storagePrefix ?? `${config.appId}:`;
      const container = createHostFacade({
        messaging: { type: 'window', target: iframe.contentWindow! },
      });

      const handlersConfig = buildHandlersConfig(storagePrefix);
      const cleanupHandlers = wireAllHandlers(container, handlersConfig);

      const product: EmbeddedProduct = {
        container,

        dispose() {
          cleanupHandlers();
          container.dispose();
          iframe.src = '';
          embeddedProducts.delete(product);
        },
      };

      embeddedProducts.add(product);
      return product;
    },

    setSession(session: UserSession, identity?: Identity) {
      auth.setState({
        status: 'authenticated',
        session,
        identity,
      });
    },

    clearSession() {
      if (ssoManager) {
        void ssoManager.unpair();
      }
      auth.setState({ status: 'idle' });
    },

    dispose() {
      for (const product of embeddedProducts) {
        product.dispose();
      }
      embeddedProducts.clear();
      ssoManager?.dispose();
      chainClient?.dispose();
      auth.dispose();
    },
  };

  return sdk;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function bytesToHex(bytes: Uint8Array): string {
  let hex = '0x';
  for (const b of bytes) {
    hex += b.toString(16).padStart(2, '0');
  }
  return hex;
}
