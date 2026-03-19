/**
 * Iframe-based provider.
 *
 * Thin wrapper around the window provider that handles iframe lifecycle:
 * sets `iframe.src` and passes a lazy `contentWindow` reference.
 * The window provider silently drops messages until the iframe loads;
 * the transport's handshake retry handles reconnection.
 */

import type { Provider, Logger } from '@polkadot/shared';
import { createWindowProvider } from './windowProvider.js';

export type CreateIframeProviderParams = {
  iframe: HTMLIFrameElement;
  url: string;
  logger?: Logger;
};

export function createIframeProvider({ iframe, url, logger }: CreateIframeProviderParams): Provider {
  iframe.src = url;

  const inner = createWindowProvider(() => iframe.contentWindow, logger);

  return {
    ...inner,
    dispose() {
      iframe.src = '';
      inner.dispose();
    },
  };
}
