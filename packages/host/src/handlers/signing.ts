/**
 * Default handlers for signing and transaction methods.
 *
 * Delegates to config callbacks (onSignPayload, onSignRaw, onCreateTransaction).
 * Returns PermissionDenied when no session is available.
 */

import type { ProtocolHandler } from '@polkadot/host-api';
import type { HandlersConfig } from './registry.js';
import { errAsync, ResultAsync } from '@polkadot/host-api';

export function wireSigningHandlers(container: ProtocolHandler, config: HandlersConfig): VoidFunction[] {
  const cleanups: VoidFunction[] = [];

  cleanups.push(
    container.handleSignPayload(payload => {
      const session = config.getSession?.();
      if (!session) {
        return errAsync({ tag: 'PermissionDenied', value: undefined });
      }

      if (!config.onSignPayload) {
        return errAsync({ tag: 'Unknown', value: { reason: 'Signing not configured' } });
      }

      return ResultAsync.fromPromise(Promise.resolve(config.onSignPayload(session, payload)), () => ({
        tag: 'Rejected' as const,
        value: undefined,
      }));
    }),
  );

  cleanups.push(
    container.handleSignRaw(payload => {
      const session = config.getSession?.();
      if (!session) {
        return errAsync({ tag: 'PermissionDenied', value: undefined });
      }

      if (!config.onSignRaw) {
        return errAsync({ tag: 'Unknown', value: { reason: 'Raw signing not configured' } });
      }

      return ResultAsync.fromPromise(Promise.resolve(config.onSignRaw(session, payload)), () => ({
        tag: 'Rejected' as const,
        value: undefined,
      }));
    }),
  );

  cleanups.push(
    container.handleCreateTransaction(params => {
      const session = config.getSession?.();
      if (!session) {
        return errAsync({ tag: 'PermissionDenied', value: undefined });
      }

      if (!config.onCreateTransaction) {
        return errAsync({ tag: 'NotSupported', value: 'Transaction creation not configured' });
      }

      return ResultAsync.fromPromise(Promise.resolve(config.onCreateTransaction(session, params)), () => ({
        tag: 'Rejected' as const,
        value: undefined,
      }));
    }),
  );

  cleanups.push(
    container.handleCreateTransactionWithNonProductAccount(payload => {
      const session = config.getSession?.();
      if (!session) {
        return errAsync({ tag: 'PermissionDenied', value: undefined });
      }

      if (!config.onCreateTransactionWithNonProductAccount) {
        return errAsync({ tag: 'NotSupported', value: 'Transaction creation with non-product account not configured' });
      }

      return ResultAsync.fromPromise(
        Promise.resolve(config.onCreateTransactionWithNonProductAccount(session, payload)),
        () => ({ tag: 'Rejected' as const, value: undefined }),
      );
    }),
  );

  return cleanups;
}
