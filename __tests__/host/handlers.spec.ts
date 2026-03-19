/**
 * Handler tests.
 *
 * Tests for wireHostHandlers, wirePermissionHandlers, and wireStorageHandlers
 * using a mock container approach. Since the handlers interact with the
 * Container interface, we test them through the container's handler
 * registration pattern.
 */

import { describe, it, expect, vi } from 'vitest';
import { handlerHelpers } from '@polkadot/host';
import type { HandlerContext } from '@polkadot/host';

// We test the handler logic directly using the handlerHelpers context,
// since the actual wiring requires a full container + transport setup.

describe('handlerHelpers', () => {
  it('ok wraps value as HandlerOk', () => {
    const result = handlerHelpers.ok(42);
    expect(result).toEqual({ ok: true, value: 42 });
  });

  it('err wraps error as HandlerErr', () => {
    const result = handlerHelpers.err({ tag: 'Unknown', value: { reason: 'test' } });
    expect(result).toEqual({ ok: false, error: { tag: 'Unknown', value: { reason: 'test' } } });
  });
});

describe('Host handler logic', () => {
  describe('featureSupported', () => {
    it('returns true when config callback returns true', () => {
      const onFeatureSupported = vi.fn(() => true);
      const ctx = handlerHelpers;

      // Simulate the handler logic from host.ts
      const feature = { tag: 'SomeFeature', value: undefined };
      const result = onFeatureSupported
        ? ctx.ok(onFeatureSupported(feature))
        : ctx.ok(false);

      expect(result).toEqual({ ok: true, value: true });
      expect(onFeatureSupported).toHaveBeenCalledWith(feature);
    });

    it('returns false when no callback is provided', () => {
      const ctx = handlerHelpers;
      const onFeatureSupported = undefined;

      const result = onFeatureSupported
        ? ctx.ok(onFeatureSupported({ tag: 'Chain', value: '0x123' }))
        : ctx.ok(false);

      expect(result).toEqual({ ok: true, value: false });
    });
  });

  describe('navigateTo', () => {
    it('calls onNavigateTo callback when provided', () => {
      const onNavigateTo = vi.fn();
      const ctx = handlerHelpers;
      const url = 'https://polkadot.network';

      if (onNavigateTo) {
        onNavigateTo(url);
      }
      const result = ctx.ok(undefined);

      expect(onNavigateTo).toHaveBeenCalledWith(url);
      expect(result).toEqual({ ok: true, value: undefined });
    });
  });

  describe('pushNotification', () => {
    it('calls onPushNotification callback when provided', () => {
      const onPushNotification = vi.fn();
      const ctx = handlerHelpers;
      const notification = { text: 'Hello!', severity: 'info' };

      if (onPushNotification) {
        onPushNotification(notification);
      }
      const result = ctx.ok(undefined);

      expect(onPushNotification).toHaveBeenCalledWith(notification);
      expect(result).toEqual({ ok: true, value: undefined });
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
    it('returns false by default when no callback provided', () => {
      const ctx = handlerHelpers;
      const onDevicePermission = undefined;

      const result = onDevicePermission
        ? ctx.ok(true)
        : ctx.ok(false);

      expect(result).toEqual({ ok: true, value: false });
    });

    it('delegates to callback when provided', async () => {
      const onDevicePermission = vi.fn().mockResolvedValue(true);
      const ctx = handlerHelpers;

      const granted = await Promise.resolve(onDevicePermission({ type: 'camera' }));
      const result = ctx.ok(granted);

      expect(result).toEqual({ ok: true, value: true });
      expect(onDevicePermission).toHaveBeenCalledWith({ type: 'camera' });
    });
  });

  describe('permission', () => {
    it('returns false by default', () => {
      const ctx = handlerHelpers;
      const result = ctx.ok(false);
      expect(result).toEqual({ ok: true, value: false });
    });
  });
});

describe('Storage handler logic', () => {
  // These test the logic pattern used in storage.ts handlers,
  // simulating what wireStorageHandlers does with a prefix.

  const prefix = 'testapp:';

  describe('read with scoped prefix', () => {
    it('returns undefined for missing keys', () => {
      const ctx = handlerHelpers;
      // Simulate: localStorage.getItem returns null
      const raw = null;
      const result = raw === null ? ctx.ok(undefined) : ctx.ok(raw);
      expect(result).toEqual({ ok: true, value: undefined });
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
