/**
 * Product-side provider and transport.
 *
 * Detects whether the current window is running inside an iframe or a
 * native webview and creates the appropriate Provider + Transport pair.
 *
 * - **iframe**: delegates to the shared `createWindowProvider(window.top)`.
 * - **webview**: delegates to `createMessagePortProvider(getWebviewPort())`.
 *
 * After the handshake, the transport automatically attempts a codec
 * upgrade to structured clone.  If the host supports it both sides swap;
 * otherwise the connection stays on SCALE.
 */

import type { Provider } from '../shared/transport/provider.js';
import type { Transport } from '../shared/transport/transport.js';
import { scaleCodecAdapter } from '../shared/codec/scale/protocol.js';
import { structuredCloneCodecAdapter } from '../shared/codec/structured/index.js';
import { requestCodecUpgrade } from '../shared/codec/negotiation.js';
import { createTransport } from '../shared/transport/transport.js';
import { createWindowProvider } from '../shared/transport/windowProvider.js';
import { createMessagePortProvider } from '../shared/transport/messagePortProvider.js';
// ---------------------------------------------------------------------------
// Global augmentation for webview
// ---------------------------------------------------------------------------

declare global {
  interface Window {
    __HOST_API_PORT__?: MessagePort;
    __HOST_WEBVIEW_MARK__?: boolean;
  }
}

// ---------------------------------------------------------------------------
// Environment detection
// ---------------------------------------------------------------------------

/**
 * Returns `true` when running in a context that has a `window` object.
 */
export function hasWindow(): boolean {
  return typeof window !== 'undefined';
}

/**
 * Returns `true` when the current window is an iframe (has a different parent).
 */
export function isIframe(): boolean {
  try {
    return hasWindow() && window !== window.top;
  } catch {
    return false;
  }
}

/**
 * Returns `true` when the current window is embedded via a native webview
 * and the host has injected `__HOST_WEBVIEW_MARK__`.
 */
export function isWebview(): boolean {
  try {
    return hasWindow() && window['__HOST_WEBVIEW_MARK__'] === true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Webview port acquisition
// ---------------------------------------------------------------------------

function delay(ms: number): Promise<void> {
  return new Promise<void>(resolve => setTimeout(resolve, ms));
}

/**
 * Poll for the MessagePort injected by the host webview provider.
 * Retries up to ~20 seconds (200 iterations x 100ms).
 */
async function getWebviewPort(iteration = 200): Promise<MessagePort> {
  if (iteration === 0) {
    throw new Error('No webview port found');
  }
  if (typeof window !== 'undefined' && window['__HOST_API_PORT__']) {
    return window['__HOST_API_PORT__'];
  }
  await delay(100);
  return getWebviewPort(iteration - 1);
}

// ---------------------------------------------------------------------------
// Provider factory
// ---------------------------------------------------------------------------

function getParentWindow(): Window {
  if (typeof window !== 'undefined' && window.top) {
    return window.top;
  }
  throw new Error('No parent window found');
}

/**
 * Create the default product-side provider.
 *
 * - **iframe**: reuses the shared `createWindowProvider` targeting `window.top`.
 * - **webview**: uses `createProductWebviewProvider` (polls for a MessagePort).
 * - **other**: returns a no-op provider (`isCorrectEnvironment` = false).
 */
export function createDefaultProductProvider(): Provider {
  if (isIframe()) {
    return createWindowProvider(getParentWindow());
  }

  if (isWebview()) {
    return createMessagePortProvider(getWebviewPort());
  }

  // Not in a supported environment — return a no-op provider.
  return {
    isCorrectEnvironment: () => false,
    postMessage: () => {},
    subscribe: () => () => {},
    dispose: () => {},
  };
}

// ---------------------------------------------------------------------------
// Singletons
// ---------------------------------------------------------------------------

/**
 * Default product-side provider singleton.
 */
export const sandboxProvider: Provider = createDefaultProductProvider();

/**
 * Default product-side transport singleton.
 *
 * Starts with the SCALE codec adapter for backwards compatibility.
 * After handshake, automatically attempts a codec upgrade to
 * structured clone. If the host supports it, both sides swap;
 * otherwise the connection stays on SCALE.
 */
export const sandboxTransport: Transport = wrapWithAutoCodecUpgrade(
  createTransport({
    provider: sandboxProvider,
    idPrefix: 'p:',
  }),
);

/**
 * Wraps a transport so that the first successful `isReady()` call
 * automatically triggers a codec upgrade attempt before resolving.
 */
function wrapWithAutoCodecUpgrade(transport: Transport): Transport {
  let upgradePromise: Promise<boolean> | undefined;

  return {
    ...transport,
    isReady(): Promise<boolean> {
      if (upgradePromise) return upgradePromise;

      upgradePromise = transport.isReady().then(async ready => {
        if (!ready) return false;

        await requestCodecUpgrade(transport, {
          scale: scaleCodecAdapter,
          structured_clone: structuredCloneCodecAdapter,
        });

        return true;
      });

      return upgradePromise;
    },
  };
}
