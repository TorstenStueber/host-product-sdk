/**
 * Default handlers for account methods.
 *
 * - accountGet: performs HDKD derivation from session
 * - getAlias: stub (requires ring VRF)
 * - createProof: stub (requires ring VRF)
 * - getNonProductAccounts: returns host accounts from config
 * - accountConnectionStatusSubscribe: tracks auth state
 */

import type { ProtocolHandler } from '@polkadot/host-api';
import type { HandlersConfig } from './registry.js';
import { deriveProductPublicKey } from '../auth/crypto.js';
import { okAsync, errAsync } from '@polkadot/host-api';

export function wireAccountHandlers(container: ProtocolHandler, config: HandlersConfig): (() => void)[] {
  const cleanups: (() => void)[] = [];

  // Account get - derives product-specific key from session
  cleanups.push(
    container.handleAccountGet(([dotNsIdentifier, derivationIndex]) => {
      const session = config.getSession?.();
      if (!session) {
        return errAsync({ tag: 'NotConnected', value: undefined });
      }

      const publicKey = deriveProductPublicKey(session.rootPublicKey, dotNsIdentifier, derivationIndex);

      return okAsync({ publicKey, name: undefined });
    }),
  );

  // Account get alias - requires ring VRF, not yet implemented
  cleanups.push(
    container.handleAccountGetAlias(_params => {
      // TODO: Implement ring VRF alias derivation
      return errAsync({ tag: 'Unknown', value: { reason: 'Ring VRF alias not yet implemented' } });
    }),
  );

  // Account create proof - requires ring VRF, not yet implemented
  cleanups.push(
    container.handleAccountCreateProof(_params => {
      // TODO: Implement ring VRF proof creation
      return errAsync({ tag: 'Unknown', value: { reason: 'Ring VRF proof not yet implemented' } });
    }),
  );

  // Get non-product accounts - returns root account from session
  cleanups.push(
    container.handleGetNonProductAccounts(_params => {
      const session = config.getSession?.();
      if (!session) {
        return okAsync([]);
      }
      return okAsync([
        {
          publicKey: session.rootPublicKey,
          name: session.displayName,
        },
      ]);
    }),
  );

  // Account connection status subscription
  cleanups.push(
    container.handleAccountConnectionStatusSubscribe((_params, send) => {
      if (!config.subscribeAuthState) {
        // No auth integration; report connected by default
        send('connected');
        return () => {};
      }

      return config.subscribeAuthState(state => {
        send(state === 'authenticated' ? 'connected' : 'disconnected');
      });
    }),
  );

  return cleanups;
}
