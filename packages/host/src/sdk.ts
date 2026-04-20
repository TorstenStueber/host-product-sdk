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
import type { StorageAdapter } from './storage/types.js';
import type { SigningResult } from '@polkadot/api-protocol';
import type { HostSdkConfig, HostSdk, EmbeddedProduct } from './types.js';

import { createClient } from 'polkadot-api';
import { createStatementStoreClient } from './statementStore/client.js';
import type { PeopleChainClient } from './statementStore/client.js';
import { createSsoManager } from './auth/sso/manager.js';
import { createSsoSessionStore } from './auth/sso/sessionStore.js';
import { createSecretStore } from './auth/sso/secretStore.js';
import { createPairingExecutor } from './auth/sso/pairingExecutor.js';
import { createSignRequestExecutor } from './auth/sso/signRequestExecutor.js';
import { createRemoteSigner } from './auth/sso/signing.js';
import type { RemoteSigner } from './auth/sso/signing.js';
import { createAccountId, deriveSr25519PublicKey, signWithSr25519 } from './auth/sso/crypto.js';
import { createIdentityResolver } from './auth/identity/resolver.js';
import { createChainIdentityProvider } from './auth/identity/chainProvider.js';

export function createHostSdk(config: HostSdkConfig): HostSdk {
  const auth = createAuthManager();
  const embeddedProducts = new Set<EmbeddedProduct>();

  // --- Lazy polkadot-api client for the People parachain ---
  let rawPeopleChainClient: ReturnType<typeof createClient> | undefined;
  function ensurePeopleChainClient(): ReturnType<typeof createClient> {
    if (!rawPeopleChainClient) {
      rawPeopleChainClient = createClient(config.peopleChainProvider);
    }
    return rawPeopleChainClient;
  }
  function getPeopleChainClient(): PeopleChainClient {
    return ensurePeopleChainClient() as unknown as PeopleChainClient;
  }
  function getPeopleChainUnsafeApi(): unknown {
    return ensurePeopleChainClient().getUnsafeApi();
  }

  // --- Statement store client ---
  const statementStoreClient = createStatementStoreClient(getPeopleChainClient());

  const sessionStore = createSsoSessionStore(config.ssoStorage);
  const secretStoreInstance = createSecretStore(config.ssoStorage);

  const ssoManager = createSsoManager({
    sessionStore,
    secretStore: secretStoreInstance,
    pairingExecutor: createPairingExecutor({
      statementStore: statementStoreClient.statementStore,
      metadata: config.pairingMetadata,
      getPeopleChainUnsafeApi,
    }),
  });

  const identityResolver = createIdentityResolver(createChainIdentityProvider(getPeopleChainUnsafeApi));

  let remoteSigner: RemoteSigner | undefined;

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

  /**
   * Build a RemoteSigner from persisted secrets and set the auth state.
   * Called after pairing success or session restore.
   */
  async function buildRemoteSignerAndSetAuth(): Promise<void> {
    const state = ssoManager.getState();
    if (state.status !== 'paired') return;

    const secrets = await ssoManager.getSecrets();
    if (!secrets) return;

    // Derive the signing key and shared secret from persisted secrets
    const ssPublicKey = deriveSr25519PublicKey(secrets.ssSecret);
    const localAccountId = createAccountId(ssPublicKey);

    // The session key is the P-256 shared secret derived during pairing.
    const sessionKey = state.session.sessionKey;

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
      statementStore: statementStoreClient.statementStore,
      executor,
    });

    // Build UserSession and resolve identity
    const session: UserSession = {
      rootPublicKey: state.session.remoteAccountId,
      displayName: state.session.displayName,
    };

    let identity: Identity | undefined;
    try {
      const hexId = bytesToHex(state.session.remoteAccountId);
      const resolved = await identityResolver.getIdentity(hexId);
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

  // Helper: check approval gate, then route through remote signer.
  // Bridges the executor's ResultAsync failure modes to the handler
  // callback contract (which throws on failure — see wireSigningHandlers).
  async function approveAndRemoteSign(
    payload: unknown,
    doSign: () => import('neverthrow').ResultAsync<
      { signature: Uint8Array; signedTransaction: Uint8Array | undefined },
      import('./auth/sso/signRequestExecutor.js').RemoteSignError
    >,
  ): Promise<SigningResult> {
    if (config.onSignApproval) {
      const approved = await config.onSignApproval(payload as never);
      if (!approved) {
        throw new Error('Rejected');
      }
    }
    return doSign().match(
      result => ({
        signature: bytesToHex(result.signature) as `0x${string}`,
        signedTransaction: result.signedTransaction
          ? (bytesToHex(result.signedTransaction) as `0x${string}`)
          : undefined,
      }),
      e => {
        switch (e.tag) {
          case 'Aborted':
            throw new Error('Aborted');
          case 'Timeout':
            throw new Error('Sign request timed out — the wallet did not respond');
          case 'NotPaired':
            throw new Error('Cannot sign: SSO manager is not paired');
          case 'Rejected':
            throw new Error(e.reason);
          case 'StatementStore':
            throw new Error(`Statement store failure: ${e.cause.tag}`);
          case 'Unknown':
            throw new Error(e.detail);
        }
      },
    );
  }

  // Build handler config from SDK config + auth manager
  function buildHandlersConfig(storage: StorageAdapter): HandlersConfig {
    return {
      storage,

      getSession() {
        return auth.getSession();
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
      statementStore: statementStoreClient.statementStore,
    };
  }

  const sdk: HostSdk = {
    auth,

    embed(messaging, productId): EmbeddedProduct {
      const container = createHostFacade({ messaging, allowCodecUpgrade: true });

      const handlersConfig = buildHandlersConfig(config.productStorage(productId));
      const cleanupHandlers = wireAllHandlers(container, handlersConfig);

      const product: EmbeddedProduct = {
        container,

        dispose() {
          cleanupHandlers();
          container.dispose();
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
      void ssoManager.unpair();
      remoteSigner = undefined;
      auth.setState({ status: 'idle' });
    },

    pair() {
      ssoManager.pair();
    },

    cancelPairing() {
      ssoManager.cancelPairing();
    },

    dispose() {
      for (const product of embeddedProducts) {
        product.dispose();
      }
      embeddedProducts.clear();
      ssoManager.dispose();
      rawPeopleChainClient?.destroy();
      rawPeopleChainClient = undefined;
      remoteSigner = undefined;
      auth.dispose();
    },
  };

  return sdk;
}
