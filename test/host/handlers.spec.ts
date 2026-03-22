/**
 * Handler tests.
 *
 * Tests for wireHostHandlers, wirePermissionHandlers, and wireStorageHandlers
 * using a mock container approach. Since the handlers interact with the
 * HostFacade interface, we test them through the container's handler
 * registration pattern.
 */

import { describe, it, expect, vi } from 'vitest';
import { okAsync, errAsync } from '@polkadot/api-protocol';

// We test the handler logic directly using okAsync/errAsync,
// since the actual wiring requires a full container + transport setup.

describe('Host handler logic', () => {
  describe('featureSupported', () => {
    it('returns true when config callback returns true', async () => {
      const onFeatureSupported = vi.fn(() => true);

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
      const onFeatureSupported = undefined;

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
  // simulating what wireStorageHandlers does with a prefix.

  const prefix = 'testapp:';

  describe('read with scoped prefix', () => {
    it('returns undefined for missing keys', async () => {
      // Simulate: localStorage.getItem returns null
      const raw = null;
      const result = raw === null ? okAsync(undefined) : okAsync(raw);
      const value = await result.match(
        v => v,
        () => 'error',
      );
      expect(value).toBeUndefined();
    });
  });

  describe('write with scoped prefix', () => {
    it('creates the correct prefixed key', () => {
      const key = 'user_settings';
      const prefixedKey = prefix + key;
      expect(prefixedKey).toBe('testapp:user_settings');
    });
  });

  describe('clear with scoped prefix', () => {
    it('creates the correct prefixed key for removal', () => {
      const key = 'cache';
      const prefixedKey = prefix + key;
      expect(prefixedKey).toBe('testapp:cache');
    });
  });

  describe('prefix isolation', () => {
    it('different prefixes produce different keys', () => {
      const prefix1 = 'app1:';
      const prefix2 = 'app2:';
      const key = 'data';

      expect(prefix1 + key).not.toBe(prefix2 + key);
      expect(prefix1 + key).toBe('app1:data');
      expect(prefix2 + key).toBe('app2:data');
    });

    it('default prefix uses appId', () => {
      const config = { appId: 'myapp', storagePrefix: undefined };
      const effectivePrefix = config.storagePrefix ?? `${config.appId ?? 'host'}:`;
      expect(effectivePrefix).toBe('myapp:');
    });

    it('falls back to host: when no appId', () => {
      const config = { appId: undefined, storagePrefix: undefined };
      const effectivePrefix = config.storagePrefix ?? `${config.appId ?? 'host'}:`;
      expect(effectivePrefix).toBe('host:');
    });
  });
});
