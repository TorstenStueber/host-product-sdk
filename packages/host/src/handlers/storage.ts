/**
 * Default handlers for localStorage methods.
 *
 * Uses a scoped key prefix (config.storagePrefix or `${appId}:`) to
 * isolate storage per product.
 */

import type { Container } from '../container/types.js';
import type { HandlersConfig } from './registry.js';

export function wireStorageHandlers(container: Container, config: HandlersConfig): VoidFunction[] {
  const cleanups: VoidFunction[] = [];
  const prefix = config.storagePrefix ?? `${config.appId ?? 'host'}:`;

  cleanups.push(
    container.handleLocalStorageRead((key, ctx) => {
      try {
        const raw = localStorage.getItem(prefix + key);
        if (raw === null) {
          return ctx.ok(undefined);
        }
        const bytes = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
        return ctx.ok(bytes);
      } catch {
        return ctx.err({ tag: 'Unknown', value: { reason: 'Failed to read from storage' } });
      }
    }),
  );

  cleanups.push(
    container.handleLocalStorageWrite(([key, value], ctx) => {
      try {
        const b64 = btoa(String.fromCharCode(...value));
        localStorage.setItem(prefix + key, b64);
        return ctx.ok(undefined);
      } catch {
        return ctx.err({ tag: 'Unknown', value: { reason: 'Failed to write to storage' } });
      }
    }),
  );

  cleanups.push(
    container.handleLocalStorageClear((key, ctx) => {
      try {
        localStorage.removeItem(prefix + key);
        return ctx.ok(undefined);
      } catch {
        return ctx.err({ tag: 'Unknown', value: { reason: 'Failed to clear storage' } });
      }
    }),
  );

  return cleanups;
}
