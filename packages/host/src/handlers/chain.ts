/**
 * Default handler for chain connection.
 *
 * Uses config.chainProvider factory, delegates to container.handleChainConnection
 * which wraps all chain_* methods via the ChainConnectionManager.
 */

import type { ProtocolHandler } from '@polkadot/host-api';
import type { HandlersConfig } from './registry.js';

export function wireChainHandlers(container: ProtocolHandler, config: HandlersConfig): VoidFunction[] {
  const cleanups: VoidFunction[] = [];

  if (config.chainProvider) {
    cleanups.push(container.handleChainConnection(config.chainProvider));
  }

  return cleanups;
}
