/**
 * Handlers for localStorage methods.
 *
 * Delegates to the StorageAdapter provided in config.storage.
 */

import type { HostFacade } from '@polkadot/api-protocol';
import type { HandlersConfig } from './registry.js';
import { ResultAsync } from '@polkadot/api-protocol';

const storageError = (reason: string) => ({ tag: 'Unknown' as const, value: { reason } });

export function wireStorageHandlers(container: HostFacade, config: HandlersConfig): (() => void)[] {
  const cleanups: (() => void)[] = [];
  const storage = config.storage;

  cleanups.push(
    container.handleLocalStorageRead(key => {
      return ResultAsync.fromPromise(storage.read(key), () => storageError('Failed to read from storage'));
    }),
  );

  cleanups.push(
    container.handleLocalStorageWrite(([key, value]) => {
      return ResultAsync.fromPromise(
        storage.write(key, value).then(() => undefined),
        () => storageError('Failed to write to storage'),
      );
    }),
  );

  cleanups.push(
    container.handleLocalStorageClear(key => {
      return ResultAsync.fromPromise(
        storage.clear(key).then(() => undefined),
        () => storageError('Failed to clear storage'),
      );
    }),
  );

  return cleanups;
}
