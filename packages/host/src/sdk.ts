/**
 * Host SDK entry point.
 *
 * `createHostSdk(config)` composes the auth manager, container, and handlers
 * into a single high-level API. This is the main entry point for host
 * applications that want to embed Polkadot products.
 */

import { createAuthManager } from './auth/authManager.js';
import type { UserSession, Identity } from './auth/authManager.js';
import { createHostFacade } from '@polkadot/api-protocol';
import { wireAllHandlers } from './handlers/registry.js';
import type { HandlersConfig } from './handlers/registry.js';
import type { HostSdkConfig, HostSdk, EmbeddedProduct } from './types.js';

export function createHostSdk(config: HostSdkConfig): HostSdk {
  const auth = createAuthManager();
  const embeddedProducts = new Set<EmbeddedProduct>();

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
      auth.setState({ status: 'idle' });
    },

    dispose() {
      for (const product of embeddedProducts) {
        product.dispose();
      }
      embeddedProducts.clear();
      auth.dispose();
    },
  };

  return sdk;
}
