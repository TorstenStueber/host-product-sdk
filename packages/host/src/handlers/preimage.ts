/**
 * No-op handlers for preimage methods.
 *
 * Returns unsupported errors by default.
 * Hosts that support preimage should override these.
 */

import type { Container } from '../container/types.js';

export function wirePreimageHandlers(container: Container): VoidFunction[] {
  const cleanups: VoidFunction[] = [];

  cleanups.push(
    container.handlePreimageLookupSubscribe((_params, _send, interrupt) => {
      interrupt();
      return () => {};
    }),
  );

  cleanups.push(
    container.handlePreimageSubmit((_params, ctx) => {
      return ctx.err({ tag: 'Unknown', value: { reason: 'Preimage not supported' } });
    }),
  );

  return cleanups;
}
