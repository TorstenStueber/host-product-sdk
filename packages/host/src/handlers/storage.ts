/**
 * Default handlers for localStorage methods.
 *
 * Uses a scoped key prefix (config.storagePrefix or `${appId}:`) to
 * isolate storage per product.
 */

import type { HostFacade } from '@polkadot/api-protocol';
import type { HandlersConfig } from './registry.js';
import { okAsync, errAsync } from '@polkadot/api-protocol';

export function wireStorageHandlers(container: HostFacade, config: HandlersConfig): (() => void)[] {
  const cleanups: (() => void)[] = [];
  const prefix = config.storagePrefix ?? `${config.appId ?? 'host'}:`;

  cleanups.push(
    container.handleLocalStorageRead(key => {
      try {
        const raw = localStorage.getItem(prefix + key);
        if (raw === null) {
          return okAsync(undefined);
        }
        const bytes = Uint8Array.from(atob(raw), c => c.charCodeAt(0));
        return okAsync(bytes);
      } catch {
        return errAsync({ tag: 'Unknown', value: { reason: 'Failed to read from storage' } });
      }
    }),
  );

  cleanups.push(
    container.handleLocalStorageWrite(([key, value]) => {
      try {
        const b64 = btoa(String.fromCharCode(...value));
        localStorage.setItem(prefix + key, b64);
        return okAsync(undefined);
      } catch {
        return errAsync({ tag: 'Unknown', value: { reason: 'Failed to write to storage' } });
      }
    }),
  );

  cleanups.push(
    container.handleLocalStorageClear(key => {
      try {
        localStorage.removeItem(prefix + key);
        return okAsync(undefined);
      } catch {
        return errAsync({ tag: 'Unknown', value: { reason: 'Failed to clear storage' } });
      }
    }),
  );

  return cleanups;
}
