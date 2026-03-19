/**
 * Default handlers for core host methods:
 * - featureSupported
 * - navigateTo
 * - pushNotification
 */

import type { Container } from '../container/types.js';
import type { HandlersConfig } from './registry.js';

export function wireHostHandlers(container: Container, config: HandlersConfig): VoidFunction[] {
  const cleanups: VoidFunction[] = [];

  // Feature supported - delegates to config callback or returns false
  cleanups.push(
    container.handleFeatureSupported((feature, ctx) => {
      if (config.onFeatureSupported) {
        const result = config.onFeatureSupported(feature);
        return ctx.ok(result);
      }
      // Check chain support via chainProvider factory
      if (feature.tag === 'Chain' && config.chainProvider) {
        const provider = config.chainProvider(feature.value);
        const supported = provider !== null;
        // Do not hold the provider open; the connection manager will create it when needed
        return ctx.ok(supported);
      }
      return ctx.ok(false);
    }),
  );

  // Navigate to - opens URL in new tab by default
  cleanups.push(
    container.handleNavigateTo((url, ctx) => {
      if (config.onNavigateTo) {
        config.onNavigateTo(url);
      } else if (typeof window !== 'undefined') {
        window.open(url, '_blank');
      }
      return ctx.ok(undefined);
    }),
  );

  // Push notification - logs by default
  cleanups.push(
    container.handlePushNotification((notification, ctx) => {
      if (config.onPushNotification) {
        config.onPushNotification(notification);
      } else {
        console.warn('[host] Push notification:', notification.text);
      }
      return ctx.ok(undefined);
    }),
  );

  return cleanups;
}
