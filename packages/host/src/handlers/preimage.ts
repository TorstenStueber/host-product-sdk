/**
 * No-op handlers for preimage methods.
 *
 * Returns unsupported errors by default.
 * Hosts that support preimage should override these.
 */

import type { HostFacade } from '@polkadot/api-protocol';
import { errAsync } from '@polkadot/api-protocol';

export function wirePreimageHandlers(container: HostFacade): (() => void)[] {
  const cleanups: (() => void)[] = [];

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
