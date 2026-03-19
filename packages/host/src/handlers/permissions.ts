/**
 * Default handlers for permission methods.
 *
 * Both devicePermission and permission return false by default.
 */

import type { Container } from '../container/types.js';
import type { HandlersConfig } from './registry.js';

export function wirePermissionHandlers(container: Container, config: HandlersConfig): VoidFunction[] {
  const cleanups: VoidFunction[] = [];

  cleanups.push(
    container.handleDevicePermission((permission, ctx) => {
      if (config.onDevicePermission) {
        return Promise.resolve(config.onDevicePermission(permission)).then(
          (result) => ctx.ok(result),
        );
      }
      return ctx.ok(false);
    }),
  );

  cleanups.push(
    container.handlePermission((request, ctx) => {
      if (config.onPermission) {
        return Promise.resolve(config.onPermission(request)).then(
          (result) => ctx.ok(result),
        );
      }
      return ctx.ok(false);
    }),
  );

  return cleanups;
}
