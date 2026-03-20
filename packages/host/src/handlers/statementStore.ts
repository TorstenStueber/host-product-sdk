/**
 * No-op handlers for statement store methods.
 *
 * Returns unsupported errors by default.
 * Hosts that support statement store should override these.
 */

import type { Container } from '../container/types.js';
import { errAsync } from '@polkadot/shared';

export function wireStatementStoreHandlers(container: Container): VoidFunction[] {
  const cleanups: VoidFunction[] = [];

  cleanups.push(
    container.handleStatementStoreSubscribe((_params, _send, interrupt) => {
      interrupt();
      return () => {};
    }),
  );

  cleanups.push(
    container.handleStatementStoreCreateProof((_params) => {
      return errAsync({ tag: 'Unknown', value: { reason: 'Statement store not supported' } });
    }),
  );

  cleanups.push(
    container.handleStatementStoreSubmit((_params) => {
      return errAsync({ reason: 'Statement store not supported' });
    }),
  );

  return cleanups;
}
