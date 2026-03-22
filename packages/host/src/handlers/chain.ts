/**
 * Default handler for chain connection.
 *
 * Uses config.chainProvider factory, delegates to container.handleChainConnection
 * which wraps all chain_* methods via the ChainConnectionManager.
 */

import type { HostFacade } from '@polkadot/api-protocol';
import type { HandlersConfig } from './registry.js';

export function wireChainHandlers(container: HostFacade, config: HandlersConfig): (() => void)[] {
  const cleanups: (() => void)[] = [];

  if (config.chainProvider) {
    cleanups.push(container.handleChainConnection(config.chainProvider));
  }

  return cleanups;
}
