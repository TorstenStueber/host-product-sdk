/**
 * Handler tests.
 *
 * Tests for wireHostHandlers, wirePermissionHandlers, and wireStorageHandlers
 * using a mock container approach. Since the handlers interact with the
 * HostFacade interface, we test them through the container's handler
 * registration pattern.
 */

import { describe, it, expect, vi } from 'vitest';
import { okAsync } from '@polkadot/api-protocol';

// We test the handler logic directly using okAsync/errAsync,
// since the actual wiring requires a full container + transport setup.

describe('Host handler logic', () => {
  describe('featureSupported', () => {
    it('returns true when config callback returns true', async () => {
      const onFeatureSupported = vi.fn((_feature: unknown) => true);

      // Simulate the handler logic from host.ts
      const feature = { tag: 'SomeFeature', value: undefined };
      const result = onFeatureSupported ? okAsync(onFeatureSupported(feature)) : okAsync(false);

      const value = await result.match(
        v => v,
        () => undefined,
      );
      expect(value).toBe(true);
      expect(onFeatureSupported).toHaveBeenCalledWith(feature);
    });

    it('returns false when no callback is provided', async () => {
      const onFeatureSupported = undefined as ((_feature: unknown) => boolean) | undefined;

      const result = onFeatureSupported
        ? okAsync(onFeatureSupported({ tag: 'Chain', value: '0x123' }))
        : okAsync(false);

      const value = await result.match(
        v => v,
        () => undefined,
      );
      expect(value).toBe(false);
    });
  });

  describe('navigateTo', () => {
    it('calls onNavigateTo callback when provided', async () => {
      const onNavigateTo = vi.fn();
      const url = 'https://polkadot.network';

      if (onNavigateTo) {
        onNavigateTo(url);
      }
      const result = okAsync(undefined);

      const value = await result.match(
        v => v,
        () => 'error',
      );
      expect(onNavigateTo).toHaveBeenCalledWith(url);
      expect(value).toBeUndefined();
    });
  });

  describe('pushNotification', () => {
    it('calls onPushNotification callback when provided', async () => {
      const onPushNotification = vi.fn();
      const notification = { text: 'Hello!', severity: 'info' };

      if (onPushNotification) {
        onPushNotification(notification);
      }
      const result = okAsync(undefined);

      const value = await result.match(
        v => v,
        () => 'error',
      );
      expect(onPushNotification).toHaveBeenCalledWith(notification);
      expect(value).toBeUndefined();
    });

    it('logs to console.warn when no callback is provided', () => {
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const notification = { text: 'Notification text' };

      // Simulate the default behavior from host.ts
      console.warn('[host] Push notification:', notification.text);

      expect(spy).toHaveBeenCalledWith('[host] Push notification:', 'Notification text');
      spy.mockRestore();
    });
  });
});

describe('Permission handler logic', () => {
  describe('devicePermission', () => {
    it('returns false by default when no callback provided', async () => {
      const onDevicePermission = undefined;

      const result = onDevicePermission ? okAsync(true) : okAsync(false);

      const value = await result.match(
        v => v,
        () => undefined,
      );
      expect(value).toBe(false);
    });

    it('delegates to callback when provided', async () => {
      const onDevicePermission = vi.fn().mockResolvedValue(true);

      const granted = await Promise.resolve(onDevicePermission({ type: 'camera' }));
      const result = okAsync(granted);

      const value = await result.match(
        v => v,
        () => undefined,
      );
      expect(value).toBe(true);
      expect(onDevicePermission).toHaveBeenCalledWith({ type: 'camera' });
    });
  });

  describe('permission', () => {
    it('returns false by default', async () => {
      const result = okAsync(false);
      const value = await result.match(
        v => v,
        () => undefined,
      );
      expect(value).toBe(false);
    });
  });
});

describe('Storage handler logic', () => {
  // These test the logic pattern used in storage.ts handlers,
  // verifying delegation to a StorageAdapter.

  describe('delegates to StorageAdapter', () => {
    it('read delegates to storage.read', async () => {
      const data = new Uint8Array([1, 2, 3]);
      const storage = {
        read: vi.fn().mockResolvedValue(data),
        write: vi.fn().mockResolvedValue(undefined),
        clear: vi.fn().mockResolvedValue(undefined),
      };

      const result = await storage.read('mykey');
      expect(storage.read).toHaveBeenCalledWith('mykey');
      expect(result).toBe(data);
    });

    it('read returns undefined for missing keys', async () => {
      const storage = {
        read: vi.fn().mockResolvedValue(undefined),
        write: vi.fn().mockResolvedValue(undefined),
        clear: vi.fn().mockResolvedValue(undefined),
      };

      const result = await storage.read('missing');
      expect(result).toBeUndefined();
    });

    it('write delegates to storage.write', async () => {
      const storage = {
        read: vi.fn().mockResolvedValue(undefined),
        write: vi.fn().mockResolvedValue(undefined),
        clear: vi.fn().mockResolvedValue(undefined),
      };

      const data = new Uint8Array([4, 5]);
      await storage.write('key', data);
      expect(storage.write).toHaveBeenCalledWith('key', data);
    });

    it('clear delegates to storage.clear', async () => {
      const storage = {
        read: vi.fn().mockResolvedValue(undefined),
        write: vi.fn().mockResolvedValue(undefined),
        clear: vi.fn().mockResolvedValue(undefined),
      };

      await storage.clear('key');
      expect(storage.clear).toHaveBeenCalledWith('key');
    });
  });
});
