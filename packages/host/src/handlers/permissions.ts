/**
 * Default handlers for permission methods.
 *
 * Both devicePermission and permission return false by default.
 */

import type { HostFacade } from '@polkadot/api-protocol';
import type { HandlersConfig } from './registry.js';
import { okAsync, ResultAsync } from '@polkadot/api-protocol';

export function wirePermissionHandlers(container: HostFacade, config: HandlersConfig): (() => void)[] {
  const cleanups: (() => void)[] = [];

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
