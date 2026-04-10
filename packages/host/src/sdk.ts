/**
 * Host SDK entry point.
 *
 * `createHostSdk(config)` composes all host components into a single
 * high-level API: auth manager, SSO pairing, remote signing, identity
 * resolution, statement store, and protocol handler wiring.
 */

import { createAuthManager } from './auth/authManager.js';
import type { UserSession, Identity } from './auth/authManager.js';
import { createHostFacade, bytesToHex } from '@polkadot/api-protocol';
import { wireAllHandlers } from './handlers/registry.js';
import type { HandlersConfig } from './handlers/registry.js';
import type { SigningResult } from '@polkadot/api-protocol';
import type { HostSdkConfig, HostSdk, EmbeddedProduct } from './types.js';

import { createChainClient } from './statementStore/chainClient.js';
import type { ChainClient } from './statementStore/chainClient.js';
import { createSsoManager } from './auth/sso/manager.js';
import type { SsoManager } from './auth/sso/manager.js';
import { createSsoSessionStore } from './auth/sso/sessionStore.js';
import { createSecretStore } from './auth/sso/secretStore.js';
import type { SecretStore } from './auth/sso/secretStore.js';
import { createPairingExecutor } from './auth/sso/pairingExecutor.js';
import { createSignRequestExecutor } from './auth/sso/signRequestExecutor.js';
import { createRemoteSigner } from './auth/sso/signing.js';
import type { RemoteSigner } from './auth/sso/signing.js';
import { createAccountId, deriveSr25519PublicKey, signWithSr25519 } from './auth/sso/crypto.js';
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
  let secretStoreInstance: SecretStore | undefined;
  let identityResolver: IdentityResolver | undefined;
  let remoteSigner: RemoteSigner | undefined;

  if (config.statementStoreProvider) {
    chainClient = createChainClient(config.statementStoreProvider);

    const storage = createLocalStorageAdapter(config.appId + ':sso:');
    const sessionStore = createSsoSessionStore(storage);
    secretStoreInstance = createSecretStore(storage);

    ssoManager = createSsoManager({
      statementStore: chainClient.statementStore,
      sessionStore,
      secretStore: secretStoreInstance,
      pairingExecutor: createPairingExecutor({
        metadata: config.pairingMetadata ?? '',
        getUnsafeApi: () => chainClient!.getUnsafeApi(),
      }),
    });

    identityResolver = createIdentityResolver(createChainIdentityProvider(() => chainClient!.getUnsafeApi()));

    // Auto-restore session and build remote signer
    void ssoManager.restoreSession().then(() => buildRemoteSignerAndSetAuth());

    // Sync SSO state changes to auth manager
    ssoManager.subscribe(state => {
      if (state.status === 'paired') {
        void buildRemoteSignerAndSetAuth();
      } else if (state.status === 'idle' && auth.getState().status === 'authenticated') {
        remoteSigner = undefined;
        auth.setState({ status: 'idle' });
      } else if (state.status === 'awaiting_scan') {
        auth.setState({ status: 'pairing', payload: state.qrPayload });
      } else if (state.status === 'failed') {
        auth.setState({ status: 'error', message: state.reason });
      }
    });
  }

  /**
   * Build a RemoteSigner from persisted secrets and set the auth state.
   * Called after pairing success or session restore.
   */
  async function buildRemoteSignerAndSetAuth(): Promise<void> {
    if (!ssoManager || !chainClient || !secretStoreInstance) return;

    const state = ssoManager.getState();
    if (state.status !== 'paired') return;

    const secrets = await ssoManager.getSecrets();
    if (!secrets) return;

    // Derive the signing key and shared secret from persisted secrets
    const ssPublicKey = deriveSr25519PublicKey(secrets.ssSecret);
    const localAccountId = createAccountId(ssPublicKey);

    // The session key is the P-256 shared secret between our encrSecret
    // and the remote's public key (stored in remotePublicKey field).
    // Note: remotePublicKey in PersistedSessionMeta IS the shared secret
    // (already derived during pairing), so we use it directly.
    const sessionKey = state.session.remotePublicKey;

    const signer = {
      publicKey: ssPublicKey,
      async sign(message: Uint8Array): Promise<Uint8Array> {
        return signWithSr25519(secrets.ssSecret, message);
      },
    };

    const executor = createSignRequestExecutor({
      sessionKey,
      signer,
      remoteAccountId: state.session.remoteAccountId,
      localAccountId,
    });

    remoteSigner = createRemoteSigner({
      manager: ssoManager,
      statementStore: chainClient.statementStore,
      executor,
    });

    // Build UserSession and resolve identity
    const session: UserSession = {
      rootPublicKey: state.session.remoteAccountId,
      displayName: state.session.displayName,
      remoteAccount: { accountId: state.session.remoteAccountId, ...state.session },
    };

    let identity: Identity | undefined;
    try {
      const hexId = bytesToHex(state.session.remoteAccountId);
      const resolved = await identityResolver?.getIdentity(hexId);
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

  // Helper: check approval gate, then route through remote signer
  async function approveAndRemoteSign(
    payload: unknown,
    doSign: () => Promise<{ signature: Uint8Array; signedTransaction?: Uint8Array | string }>,
  ): Promise<SigningResult> {
    if (config.onSignApproval) {
      const approved = await config.onSignApproval(payload as never);
      if (!approved) {
        throw new Error('Rejected');
      }
    }
    const result = await doSign();
    return {
      signature: bytesToHex(result.signature) as `0x${string}`,
      signedTransaction: result.signedTransaction
        ? result.signedTransaction instanceof Uint8Array
          ? (bytesToHex(result.signedTransaction) as `0x${string}`)
          : (result.signedTransaction as `0x${string}`)
        : undefined,
    };
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

      // Signing: use explicit callbacks if provided, otherwise fall back to remote signer
      // with optional approval gate
      onSignPayload: config.onSignPayload
        ? (_sessionInfo, payload) => {
            const session = auth.getSession();
            if (!session) throw new Error('No session');
            return config.onSignPayload!(session, payload);
          }
        : remoteSigner
          ? (_sessionInfo, payload) => {
              return approveAndRemoteSign(payload, () => remoteSigner!.signPayload(payload as never));
            }
          : undefined,

      onSignRaw: config.onSignRaw
        ? (_sessionInfo, payload) => {
            const session = auth.getSession();
            if (!session) throw new Error('No session');
            return config.onSignRaw!(session, payload);
          }
        : remoteSigner
          ? (_sessionInfo, payload) => {
              return approveAndRemoteSign(payload, () => remoteSigner!.signRaw(payload as never));
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
      remoteSigner = undefined;
      auth.setState({ status: 'idle' });
    },

    pair() {
      ssoManager?.pair();
    },

    cancelPairing() {
      ssoManager?.cancelPairing();
    },

    dispose() {
      for (const product of embeddedProducts) {
        product.dispose();
      }
      embeddedProducts.clear();
      ssoManager?.dispose();
      chainClient?.dispose();
      remoteSigner = undefined;
      auth.dispose();
    },
  };

  return sdk;
}
