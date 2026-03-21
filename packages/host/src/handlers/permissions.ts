/**
 * Default handlers for permission methods.
 *
 * Both devicePermission and permission return false by default.
 */

import type { ProtocolHandler } from '@polkadot/host-api';
import type { HandlersConfig } from './registry.js';
import { okAsync, ResultAsync } from '@polkadot/host-api';

export function wirePermissionHandlers(container: ProtocolHandler, config: HandlersConfig): VoidFunction[] {
  const cleanups: VoidFunction[] = [];

  cleanups.push(
    container.handleDevicePermission(permission => {
      if (config.onDevicePermission) {
        return ResultAsync.fromSafePromise(Promise.resolve(config.onDevicePermission(permission)));
      }
      return okAsync(false);
    }),
  );

  cleanups.push(
    container.handlePermission(request => {
      if (config.onPermission) {
        return ResultAsync.fromSafePromise(Promise.resolve(config.onPermission(request)));
      }
      return okAsync(false);
    }),
  );

  return cleanups;
}
