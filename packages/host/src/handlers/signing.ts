/**
 * Default handlers for signing and transaction methods.
 *
 * Delegates to config callbacks (onSignPayload, onSignRaw, onCreateTransaction).
 * Returns PermissionDenied when no session is available.
 */

import type { Container } from '../container/types.js';
import type { HandlersConfig } from './registry.js';

export function wireSigningHandlers(container: Container, config: HandlersConfig): VoidFunction[] {
  const cleanups: VoidFunction[] = [];

  cleanups.push(
    container.handleSignPayload((payload, ctx) => {
      const session = config.getSession?.();
      if (!session) {
        return ctx.err({ tag: 'PermissionDenied', value: undefined });
      }

      if (!config.onSignPayload) {
        return ctx.err({ tag: 'Unknown', value: { reason: 'Signing not configured' } });
      }

      return Promise.resolve(config.onSignPayload(session, payload)).then(
        (result) => ctx.ok(result),
        () => ctx.err({ tag: 'Rejected', value: undefined }),
      );
    }),
  );

  cleanups.push(
    container.handleSignRaw((payload, ctx) => {
      const session = config.getSession?.();
      if (!session) {
        return ctx.err({ tag: 'PermissionDenied', value: undefined });
      }

      if (!config.onSignRaw) {
        return ctx.err({ tag: 'Unknown', value: { reason: 'Raw signing not configured' } });
      }

      return Promise.resolve(config.onSignRaw(session, payload)).then(
        (result) => ctx.ok(result),
        () => ctx.err({ tag: 'Rejected', value: undefined }),
      );
    }),
  );

  cleanups.push(
    container.handleCreateTransaction((params, ctx) => {
      const session = config.getSession?.();
      if (!session) {
        return ctx.err({ tag: 'PermissionDenied', value: undefined });
      }

      if (!config.onCreateTransaction) {
        return ctx.err({ tag: 'NotSupported', value: 'Transaction creation not configured' });
      }

      return Promise.resolve(config.onCreateTransaction(session, params)).then(
        (result) => ctx.ok(result),
        () => ctx.err({ tag: 'Rejected', value: undefined }),
      );
    }),
  );

  cleanups.push(
    container.handleCreateTransactionWithNonProductAccount((payload, ctx) => {
      const session = config.getSession?.();
      if (!session) {
        return ctx.err({ tag: 'PermissionDenied', value: undefined });
      }

      if (!config.onCreateTransactionWithNonProductAccount) {
        return ctx.err({ tag: 'NotSupported', value: 'Transaction creation with non-product account not configured' });
      }

      return Promise.resolve(config.onCreateTransactionWithNonProductAccount(session, payload)).then(
        (result) => ctx.ok(result),
        () => ctx.err({ tag: 'Rejected', value: undefined }),
      );
    }),
  );

  return cleanups;
}
