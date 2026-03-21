/**
 * No-op handlers for preimage methods.
 *
 * Returns unsupported errors by default.
 * Hosts that support preimage should override these.
 */

import type { ProtocolHandler } from '@polkadot/host-api';
import { errAsync } from '@polkadot/host-api';

export function wirePreimageHandlers(container: ProtocolHandler): VoidFunction[] {
  const cleanups: VoidFunction[] = [];

  cleanups.push(
    container.handlePreimageLookupSubscribe((_params, _send, interrupt) => {
      interrupt();
      return () => {};
    }),
  );

  cleanups.push(
    container.handlePreimageSubmit(_params => {
      return errAsync({ tag: 'Unknown', value: { reason: 'Preimage not supported' } });
    }),
  );

  return cleanups;
}
