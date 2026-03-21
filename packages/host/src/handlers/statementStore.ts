/**
 * No-op handlers for statement store methods.
 *
 * Returns unsupported errors by default.
 * Hosts that support statement store should override these.
 */

import type { ProtocolHandler } from '@polkadot/host-api';
import { errAsync } from '@polkadot/host-api';

export function wireStatementStoreHandlers(container: ProtocolHandler): VoidFunction[] {
  const cleanups: VoidFunction[] = [];

  cleanups.push(
    container.handleStatementStoreSubscribe((_params, _send, interrupt) => {
      interrupt();
      return () => {};
    }),
  );

  cleanups.push(
    container.handleStatementStoreCreateProof(_params => {
      return errAsync({ tag: 'Unknown', value: { reason: 'Statement store not supported' } });
    }),
  );

  cleanups.push(
    container.handleStatementStoreSubmit(_params => {
      return errAsync({ reason: 'Statement store not supported' });
    }),
  );

  return cleanups;
}
