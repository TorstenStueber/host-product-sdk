/**
 * Default handlers for core host methods:
 * - featureSupported
 * - navigateTo
 * - pushNotification
 */

import type { ProtocolHandler } from '@polkadot/host-api';
import type { HandlersConfig } from './registry.js';
import { okAsync } from '@polkadot/host-api';

export function wireHostHandlers(container: ProtocolHandler, config: HandlersConfig): (() => void)[] {
  const cleanups: (() => void)[] = [];

  // Feature supported - delegates to config callback or returns false
  cleanups.push(
    container.handleFeatureSupported(feature => {
      if (config.onFeatureSupported) {
        const result = config.onFeatureSupported(feature);
        return okAsync(result);
      }
      // Check chain support via chainProvider factory
      if (feature.tag === 'Chain' && config.chainProvider) {
        const provider = config.chainProvider(feature.value);
        const supported = provider !== null;
        // Do not hold the provider open; the connection manager will create it when needed
        return okAsync(supported);
      }
      return okAsync(false);
    }),
  );

  // Navigate to - opens URL in new tab by default
  cleanups.push(
    container.handleNavigateTo(url => {
      if (config.onNavigateTo) {
        config.onNavigateTo(url);
      } else if (typeof window !== 'undefined') {
        window.open(url, '_blank');
      }
      return okAsync(undefined);
    }),
  );

  // Push notification - logs by default
  cleanups.push(
    container.handlePushNotification(notification => {
      if (config.onPushNotification) {
        config.onPushNotification(notification);
      } else {
        console.warn('[host] Push notification:', notification.text);
      }
      return okAsync(undefined);
    }),
  );

  return cleanups;
}
